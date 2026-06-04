/**
 * Main-thread ORB feature extraction and BFMatcher matching.
 *
 * Uses the OpenCV `cv` object that is already loaded on the main thread via
 * useOpenCV — no worker, no separate WASM initialisation race conditions.
 *
 * Both functions are synchronous and block the main thread briefly (~50–200 ms
 * per image at typical video resolutions). This is acceptable for one-shot
 * reference-frame extraction and single-image query matching.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

import { cropImageData } from "@/utils/cvHelpers";

// Higher feature count improves homography quality when only a single
// reference frame is available — the increased descriptor pool gives more
// candidate matches, which helps RANSAC find an accurate transform.
const ORB_FEATURES = 3000;
const ORB_DESCRIPTOR_BYTES = 32;
const LOWE_RATIO = 0.75;

export interface OrbKeypoint {
  pt: { x: number; y: number };
  size: number;
  angle: number;
  response: number;
  octave: number;
}

/**
 * Axis-aligned bounding box (in full-frame pixel coordinates) that was used
 * when cropping a reference frame before ORB extraction. Stored alongside the
 * features so the matcher can apply a corresponding crop to the query image
 * when attempting a re-anchor pass.
 */
export interface OrbCropBox {
  /** Left edge in full-frame pixels. */
  x: number;
  /** Top edge in full-frame pixels. */
  y: number;
  /** Width of the crop in pixels. */
  width: number;
  /** Height of the crop in pixels. */
  height: number;
  /** Original frame width — used to re-map coordinates. */
  srcWidth: number;
  /** Original frame height — used to re-map coordinates. */
  srcHeight: number;
}

export interface OrbFeatures {
  keypoints: OrbKeypoint[];
  /** Binary ORB descriptors. Shape: (nKeypoints × 32) bytes, flattened row-major. */
  descriptors: Uint8Array;
  /**
   * Crop applied before extraction, if any. Keypoints are always stored in
   * full-frame pixel coordinates regardless of whether a crop was applied.
   */
  cropBox?: OrbCropBox;
}

export interface OrbMatch {
  /** Index into the reference keypoints array. */
  queryIdx: number;
  /** Index into the query keypoints array. */
  trainIdx: number;
  /** Hamming distance — lower is a better match. */
  distance: number;
}

/**
 * ORB features extracted from a single **Keyframe** of a **Panning Capture**,
 * tagged with the video timestamp the keyframe was sampled at.
 *
 * A Panning Capture stores an ordered array of these (Wall Crop features at
 * ~0.5–1 s intervals) so each section of the pan can be matched to the Route
 * Photo independently. Fixed Capture stores none — it relies on the single
 * frame-0 `orbFeatures` instead.
 */
export interface KeyframeFeatures {
  /** Video timestamp (seconds) of the frame this ORB set was extracted from. */
  timestamp: number;
  /** Wall Crop ORB features for this keyframe (full-frame pixel coordinates). */
  features: OrbFeatures;
}

/**
 * Extract ORB keypoints and descriptors from an ImageData on the main thread.
 * Requires the OpenCV `cv` object (from useOpenCV) to already be initialised.
 *
 * All intermediate WASM allocations are freed before returning.
 *
 * @param normalizePixels - When true (default), applies histogram equalisation
 *   to the grayscale image before detection. This equalises the descriptor
 *   intensity scale between the video reference frame and an uploaded photo,
 *   improving match count across different lighting conditions. Set to false
 *   only when the caller has already normalised the input.
 */
export function extractFeatures(cv: CV, imageData: ImageData, normalizePixels = true): OrbFeatures {
  let src = null,
    gray = null,
    normalized = null,
    mask = null,
    keypoints = null,
    descriptors = null,
    orb = null;

  try {
    src = cv.matFromImageData(imageData);

    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Histogram equalisation aligns intensity distributions between the video
    // reference frame and the uploaded photo so ORB descriptors are comparable
    // regardless of whether the two images were captured under different light.
    if (normalizePixels) {
      normalized = new cv.Mat();
      cv.equalizeHist(gray, normalized);
    }

    keypoints = new cv.KeyPointVector();
    descriptors = new cv.Mat();
    mask = new cv.Mat(); // empty Mat = no spatial mask
    orb = new cv.ORB(ORB_FEATURES);

    // Use the normalised image when available; fall back to raw grayscale.
    const detect = normalized ?? gray;
    orb.detectAndCompute(detect, mask, keypoints, descriptors);

    const kpArray: OrbKeypoint[] = [];
    for (let i = 0; i < keypoints.size(); i++) {
      const kp = keypoints.get(i);
      kpArray.push({
        pt: { x: kp.pt.x, y: kp.pt.y },
        size: kp.size,
        angle: kp.angle,
        response: kp.response,
        octave: kp.octave,
      });
    }

    // Copy descriptor data out of WASM heap before the Mat is deleted.
    const descCopy = new Uint8Array(descriptors.data);

    return { keypoints: kpArray, descriptors: descCopy };
  } finally {
    orb?.delete();
    descriptors?.delete();
    keypoints?.delete();
    mask?.delete();
    normalized?.delete();
    gray?.delete();
    src?.delete();
  }
}

/**
 * Extract ORB features from a sub-region of an ImageData.
 *
 * Crops `imageData` to `cropBox`, runs ORB detection inside that region, then
 * offsets all returned keypoints by (+cropBox.x, +cropBox.y) so they are
 * expressed in full-frame pixel coordinates. This means the returned OrbFeatures
 * can be used directly with computeHomography without any coordinate adjustment.
 *
 * The crop box is stored on the returned OrbFeatures as `cropBox`.
 */
export function extractFeaturesFromCrop(
  cv: CV,
  imageData: ImageData,
  cropBox: OrbCropBox,
  normalizePixels = true,
): OrbFeatures {
  const cropped = cropImageData(imageData, cropBox);
  const features = extractFeatures(cv, cropped, normalizePixels);
  const adjustedKp = features.keypoints.map(kp => ({
    ...kp,
    pt: { x: kp.pt.x + cropBox.x, y: kp.pt.y + cropBox.y },
  }));
  return { ...features, keypoints: adjustedKp, cropBox };
}

// ---------------------------------------------------------------------------
// Query-photo downscaling
// ---------------------------------------------------------------------------

/** Hard upper bound (px) on the longest edge of a query photo fed to ORB. */
export const QUERY_MAX_EDGE = 1600;

/**
 * Floor (px) below which the query photo is never downscaled. Guards against
 * destroying matchable detail when the reference frame is unusually small
 * (e.g. a tightly-cropped video).
 */
export const QUERY_MIN_EDGE = 720;

export interface DownscaleResult {
  /** The (possibly) downscaled image. Same reference as the input when scale === 1. */
  imageData: ImageData;
  /** Linear scale applied to reach `imageData` (newEdge / origEdge), in (0, 1]. */
  scale: number;
}

/**
 * Compute the longest-edge target for a query photo given the reference frame's
 * dimensions. Targets the reference resolution (matching finer detail than the
 * reference carries is wasted work) clamped to [{@link QUERY_MIN_EDGE},
 * {@link QUERY_MAX_EDGE}].
 */
export function queryMaxEdgeFor(refWidth: number, refHeight: number): number {
  const refLongest = Math.max(refWidth, refHeight);
  return Math.min(QUERY_MAX_EDGE, Math.max(QUERY_MIN_EDGE, refLongest));
}

/**
 * Downscale an ImageData so its longest edge does not exceed `maxEdge`, using
 * OpenCV area interpolation. Returns the input untouched (scale = 1) when it
 * already fits or `maxEdge` is non-positive. All WASM allocations are freed
 * before returning.
 */
export function downscaleImageData(cv: CV, imageData: ImageData, maxEdge: number): DownscaleResult {
  const longest = Math.max(imageData.width, imageData.height);
  if (maxEdge <= 0 || longest <= maxEdge) return { imageData, scale: 1 };

  const scale = maxEdge / longest;
  const newW = Math.max(1, Math.round(imageData.width * scale));
  const newH = Math.max(1, Math.round(imageData.height * scale));

  let src = null,
    dst = null;
  try {
    src = cv.matFromImageData(imageData);
    dst = new cv.Mat();
    cv.resize(src, dst, new cv.Size(newW, newH), 0, 0, cv.INTER_AREA);
    // Copy pixels out of the WASM heap before the Mat is freed.
    const out = new Uint8ClampedArray(dst.data);
    return { imageData: new ImageData(out, newW, newH), scale };
  } finally {
    dst?.delete();
    src?.delete();
  }
}

/**
 * Map ORB features detected in a downscaled image back to native (full
 * resolution) coordinates by dividing keypoint positions by `scale`. A `cropBox`,
 * if present, is rescaled too. Returns the input unchanged when scale === 1.
 *
 * Descriptors are scale-invariant (ORB scale pyramid) so only coordinates move.
 */
export function rescaleFeaturesToNative(features: OrbFeatures, scale: number): OrbFeatures {
  if (scale === 1) return features;
  const inv = 1 / scale;
  const out: OrbFeatures = {
    ...features,
    keypoints: features.keypoints.map(kp => ({
      ...kp,
      pt: { x: kp.pt.x * inv, y: kp.pt.y * inv },
    })),
  };
  if (features.cropBox) {
    out.cropBox = {
      ...features.cropBox,
      x: features.cropBox.x * inv,
      y: features.cropBox.y * inv,
      width: features.cropBox.width * inv,
      height: features.cropBox.height * inv,
      srcWidth: features.cropBox.srcWidth * inv,
      srcHeight: features.cropBox.srcHeight * inv,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Climber exclusion mask
// ---------------------------------------------------------------------------

/** Dilation radius (pixels) around the climber convex hull. */
const CLIMBER_MASK_DILATION = 30;

/**
 * Normalised landmark point used for mask generation.
 * Coordinates are in [0, 1] relative to the image dimensions.
 */
export interface NormalizedPoint {
  x: number;
  y: number;
}

/**
 * Build an inverted binary mask that excludes the climber region.
 *
 * Uses the convex hull of the supplied pose landmarks (in normalised [0,1]
 * space), dilated by {@link CLIMBER_MASK_DILATION} pixels, to produce a mask
 * where the climber region is black (0 = exclude) and the rest is white
 * (255 = include). This can be passed as the `mask` parameter to
 * `ORB.detectAndCompute` so keypoints are only detected on the wall surface.
 *
 * All OpenCV allocations are freed before returning except the result Mat,
 * which the caller MUST delete when done.
 *
 * @param cv        - Initialised OpenCV runtime.
 * @param width     - Image width in pixels.
 * @param height    - Image height in pixels.
 * @param landmarks - Pose landmarks in normalised [0,1] coordinates.
 * @returns An 8-bit single-channel Mat (CV_8UC1) with the exclusion mask.
 */
export function buildClimberExclusionMask(
  cv: CV,
  width: number,
  height: number,
  landmarks: NormalizedPoint[],
): ReturnType<typeof Object> {
  // Need at least 3 points for a meaningful convex hull.
  if (landmarks.length < 3) {
    // Return a fully white mask (no exclusion).
    const allWhite = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(255));
    return allWhite;
  }

  let points = null;
  let hull = null;
  let maskBlack = null;
  let dilateKernel = null;
  let dilated = null;

  try {
    // Convert normalised landmarks to pixel coordinates.
    const pixelCoords: number[] = [];
    for (const lm of landmarks) {
      pixelCoords.push(
        Math.round(lm.x * width),
        Math.round(lm.y * height),
      );
    }

    points = cv.matFromArray(landmarks.length, 1, cv.CV_32SC2, pixelCoords);
    hull = new cv.Mat();
    cv.convexHull(points, hull, false, true);

    // Draw filled convex hull on a black canvas (white = climber area).
    maskBlack = new cv.Mat.zeros(height, width, cv.CV_8UC1);
    const hullContour = new cv.MatVector();
    hullContour.push_back(hull);
    cv.drawContours(maskBlack, hullContour, 0, new cv.Scalar(255), cv.FILLED);
    hullContour.delete();

    // Dilate the climber region to cover limbs & edges.
    dilateKernel = cv.getStructuringElement(
      cv.MORPH_ELLIPSE,
      new cv.Size(CLIMBER_MASK_DILATION * 2 + 1, CLIMBER_MASK_DILATION * 2 + 1),
    );
    dilated = new cv.Mat();
    cv.dilate(maskBlack, dilated, dilateKernel);

    // Invert: white = wall (detect here), black = climber (exclude).
    const result = new cv.Mat();
    cv.bitwise_not(dilated, result);
    return result;
  } finally {
    dilated?.delete();
    dilateKernel?.delete();
    maskBlack?.delete();
    hull?.delete();
    points?.delete();
  }
}

/**
 * Extract ORB features while excluding the climber region.
 *
 * Works like {@link extractFeatures} but accepts an array of normalised pose
 * landmarks used to build an exclusion mask. Keypoints on the climber body
 * are suppressed so the resulting features focus on the wall/route surface.
 *
 * Falls back to standard extraction when no landmarks are provided.
 */
export function extractFeaturesExcludingClimber(
  cv: CV,
  imageData: ImageData,
  landmarks: NormalizedPoint[],
  normalizePixels = true,
): OrbFeatures {
  if (landmarks.length < 3) {
    return extractFeatures(cv, imageData, normalizePixels);
  }

  let src = null,
    gray = null,
    normalized = null,
    climberMask = null,
    keypoints = null,
    descriptors = null,
    orb = null;

  try {
    src = cv.matFromImageData(imageData);

    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    if (normalizePixels) {
      normalized = new cv.Mat();
      cv.equalizeHist(gray, normalized);
    }

    climberMask = buildClimberExclusionMask(cv, imageData.width, imageData.height, landmarks);

    keypoints = new cv.KeyPointVector();
    descriptors = new cv.Mat();
    orb = new cv.ORB(ORB_FEATURES);

    const detect = normalized ?? gray;
    orb.detectAndCompute(detect, climberMask, keypoints, descriptors);

    const kpArray: OrbKeypoint[] = [];
    for (let i = 0; i < keypoints.size(); i++) {
      const kp = keypoints.get(i);
      kpArray.push({
        pt: { x: kp.pt.x, y: kp.pt.y },
        size: kp.size,
        angle: kp.angle,
        response: kp.response,
        octave: kp.octave,
      });
    }

    const descCopy = new Uint8Array(descriptors.data);
    return { keypoints: kpArray, descriptors: descCopy };
  } finally {
    orb?.delete();
    descriptors?.delete();
    keypoints?.delete();
    climberMask?.delete();
    normalized?.delete();
    gray?.delete();
    src?.delete();
  }
}

/**
 * Match two sets of ORB descriptors using BFMatcher (NORM_HAMMING) with
 * Lowe ratio test (k=2, ratio=0.75). Runs synchronously on the main thread.
 *
 * Returns an empty array immediately when either feature set is empty or
 * too small for knnMatch (requires at least 2 query rows).
 */
export function matchOrbFeatures(
  cv: CV,
  ref: OrbFeatures,
  query: OrbFeatures,
): OrbMatch[] {
  const refRows = ref.descriptors.length / ORB_DESCRIPTOR_BYTES;
  const queryRows = query.descriptors.length / ORB_DESCRIPTOR_BYTES;

  // knnMatch(k=2) requires at least 2 rows in the train set.
  if (refRows === 0 || queryRows < 2) return [];

  let refMat = null,
    queryMat = null,
    bf = null,
    knnMatches = null;

  try {
    refMat = new cv.Mat(refRows, ORB_DESCRIPTOR_BYTES, cv.CV_8UC1);
    refMat.data.set(ref.descriptors.subarray(0, refRows * ORB_DESCRIPTOR_BYTES));

    queryMat = new cv.Mat(queryRows, ORB_DESCRIPTOR_BYTES, cv.CV_8UC1);
    queryMat.data.set(query.descriptors.subarray(0, queryRows * ORB_DESCRIPTOR_BYTES));

    bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
    knnMatches = new cv.DMatchVectorVector();
    bf.knnMatch(refMat, queryMat, knnMatches, 2);

    const results: OrbMatch[] = [];
    for (let i = 0; i < knnMatches.size(); i++) {
      const pair = knnMatches.get(i);
      if (pair.size() < 2) continue;
      const m = pair.get(0);
      const n = pair.get(1);
      if (m.distance < LOWE_RATIO * n.distance) {
        results.push({
          queryIdx: m.queryIdx,
          trainIdx: m.trainIdx,
          distance: m.distance,
        });
      }
    }

    return results;
  } finally {
    knnMatches?.delete();
    bf?.delete();
    queryMat?.delete();
    refMat?.delete();
  }
}
