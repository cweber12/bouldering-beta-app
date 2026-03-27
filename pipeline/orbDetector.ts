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

const ORB_FEATURES = 500;
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
 * Extract ORB keypoints and descriptors from an ImageData on the main thread.
 * Requires the OpenCV `cv` object (from useOpenCV) to already be initialised.
 *
 * All intermediate WASM allocations are freed before returning.
 */
export function extractFeatures(cv: CV, imageData: ImageData): OrbFeatures {
  let src = null,
    gray = null,
    mask = null,
    keypoints = null,
    descriptors = null,
    orb = null;

  try {
    src = cv.matFromImageData(imageData);

    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    keypoints = new cv.KeyPointVector();
    descriptors = new cv.Mat();
    mask = new cv.Mat(); // empty Mat = no spatial mask
    orb = new cv.ORB(ORB_FEATURES);

    orb.detectAndCompute(gray, mask, keypoints, descriptors);

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
): OrbFeatures {
  const cropped = cropImageData(imageData, cropBox);
  const features = extractFeatures(cv, cropped);
  const adjustedKp = features.keypoints.map(kp => ({
    ...kp,
    pt: { x: kp.pt.x + cropBox.x, y: kp.pt.y + cropBox.y },
  }));
  return { ...features, keypoints: adjustedKp, cropBox };
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
