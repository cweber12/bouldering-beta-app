/**
 * Automatic image analysis for adaptive frame preprocessing.
 *
 * Analyses pixel statistics for the full frame and optional crop regions, then
 * derives preprocessing parameters used by applyOrbPreprocessing and
 * applyPosePreprocessing.  No user input is required.
 *
 * Sharpness is estimated via high-frequency energy (GaussianBlur residual)
 * rather than a Laplacian filter, relying only on functions confirmed to exist
 * in the @techstark/opencv-js WASM build.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

import { cropImageData } from "@/utils/cvHelpers";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RegionStats {
  /** Mean pixel brightness 0–255. */
  mean: number;
  /** Standard deviation of pixel intensities. */
  stdDev: number;
  /**
   * High-frequency energy — variance of the GaussianBlur residual.
   * Higher values indicate a sharper, less blurry image.
   */
  sharpness: number;
}

export interface FrameAnalysis {
  /** Stats computed over the entire frame. */
  overall: RegionStats;
  /** Stats for the climber crop region (null when no crop was provided). */
  climber: RegionStats | null;
  /** Stats for the wall / ORB crop region (null when no crop was provided). */
  wall: RegionStats | null;

  /** Mean brightness well above the neutral range (> 195). */
  isOverexposed: boolean;
  /** Mean brightness well below the neutral range (< 60). */
  isUnderexposed: boolean;
  /**
   * Climber region is substantially darker than the overall frame,
   * indicating back-lighting. Only set when climber stats are available.
   */
  isBacklit: boolean;
  /** Low histogram spread — inadequate contrast between climber and wall. */
  isLowContrast: boolean;
  /** High-frequency energy is low — motion blur or dusty lens. */
  isBlurry: boolean;

  /**
   * Suggested gamma exponent for pose-canvas gamma correction.
   *   < 1.0  → compress highlights (overexposed)
   *   > 1.0  → lift midtones   (backlit / underexposed)
   *   = 1.0  → no change
   */
  suggestedGamma: number;
  /**
   * Blend weight (0–1) for mixing equalizeHist output with the original
   * in pose preprocessing.  0 = skip equalization entirely.
   */
  contrastAlpha: number;
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const OVEREXPOSED_MEAN    = 195;
const UNDEREXPOSED_MEAN   = 60;
/** Minimum brightness delta (overall − climber) to classify as backlit. */
const BACKLIT_DELTA       = 65;
const LOW_CONTRAST_STDDEV = 30;
/** High-frequency energy below this value is classified as blurry. */
const BLURRY_SHARPNESS    = 60;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyse an ImageData and optional crop regions to produce a FrameAnalysis.
 *
 * Crop coordinates must be in full-frame pixel space.  All OpenCV allocations
 * are freed before returning.
 *
 * @param cv             - Initialised OpenCV runtime.
 * @param imageData      - Full-frame RGBA ImageData.
 * @param climberCropPx  - Optional climber crop in pixel coordinates.
 * @param wallCropPx     - Optional wall / ORB crop in pixel coordinates.
 */
export function analyzeFrame(
  cv: CV,
  imageData: ImageData,
  climberCropPx?: { x: number; y: number; width: number; height: number },
  wallCropPx?: { x: number; y: number; width: number; height: number },
): FrameAnalysis {
  const overall = computeRegionStats(cv, imageData);

  const climber = climberCropPx
    ? computeRegionStats(cv, cropImageData(imageData, climberCropPx))
    : null;

  const wall = wallCropPx
    ? computeRegionStats(cv, cropImageData(imageData, wallCropPx))
    : null;

  const isOverexposed  = overall.mean > OVEREXPOSED_MEAN;
  const isUnderexposed = overall.mean < UNDEREXPOSED_MEAN;
  const isBacklit      = climber !== null
    && (overall.mean - climber.mean) > BACKLIT_DELTA;
  const isLowContrast  = overall.stdDev < LOW_CONTRAST_STDDEV;
  const isBlurry       = overall.sharpness < BLURRY_SHARPNESS;

  // --- Suggested gamma -------------------------------------------------------
  let suggestedGamma = 1.0;

  if (isBacklit && climber) {
    // Progressive lift: every extra 10 points of backlighting adds ~0.05γ
    // Clamped to [1.35, 1.80].
    const severity = Math.min(1, (overall.mean - climber.mean - BACKLIT_DELTA) / 80);
    suggestedGamma = 1.35 + severity * 0.45;
  } else if (isUnderexposed) {
    // Gentle lift proportional to how far below the floor the frame is.
    suggestedGamma = 1.30 + Math.min(0.30, (UNDEREXPOSED_MEAN - overall.mean) / 80);
  } else if (isOverexposed) {
    // Compress highlights — stronger compression for more severe overexposure.
    const severity = Math.min(1, (overall.mean - OVEREXPOSED_MEAN) / 60);
    suggestedGamma = Math.max(0.55, 1.0 - severity * 0.45);
  }

  // --- Contrast blend alpha --------------------------------------------------
  let contrastAlpha = 0;

  if (overall.stdDev < 20) {
    contrastAlpha = 0.65;                         // very flat histogram
  } else if (overall.stdDev < LOW_CONTRAST_STDDEV) {
    contrastAlpha = 0.45;                         // moderately flat
  } else if (isOverexposed || isUnderexposed) {
    contrastAlpha = 0.30;                         // global shift, light assist
  }

  return {
    overall, climber, wall,
    isOverexposed, isUnderexposed, isBacklit, isLowContrast, isBlurry,
    suggestedGamma, contrastAlpha,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute RegionStats from an RGBA ImageData.
 *
 * Converts to grayscale, then measures mean, stdDev (via cv.meanStdDev), and
 * high-frequency energy (blur residual variance as a sharpness proxy).
 */
function computeRegionStats(cv: CV, imageData: ImageData): RegionStats {
  let src: CV | null     = null;
  let gray: CV | null    = null;
  let blurred: CV | null = null;
  let hf: CV | null      = null;
  let meanM: CV | null   = null;
  let stdM: CV | null    = null;
  let hfMean: CV | null  = null;
  let hfStd: CV | null   = null;

  try {
    src  = cv.matFromImageData(imageData);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Mean and standard deviation
    meanM = new cv.Mat();
    stdM  = new cv.Mat();
    cv.meanStdDev(gray, meanM, stdM);
    const mean   = (meanM.data64F as Float64Array)[0];
    const stdDev = (stdM.data64F as Float64Array)[0];

    // High-frequency energy: residual of subtracting a smooth illumination
    // estimate.  Variance of the residual approximates Laplacian variance.
    blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(0, 0), 2.0);
    hf = new cv.Mat();
    cv.addWeighted(gray, 1.0, blurred, -1.0, 128, hf);

    hfMean = new cv.Mat();
    hfStd  = new cv.Mat();
    cv.meanStdDev(hf, hfMean, hfStd);
    const sharpness = ((hfStd.data64F as Float64Array)[0]) ** 2;

    return { mean, stdDev, sharpness };
  } finally {
    hfStd?.delete();
    hfMean?.delete();
    hf?.delete();
    blurred?.delete();
    stdM?.delete();
    meanM?.delete();
    gray?.delete();
    src?.delete();
  }
}
