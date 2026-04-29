/**
 * Frame preprocessing for pose detection and ORB feature extraction.
 *
 * Two specialised paths:
 *   applyOrbPreprocessing  — Local Illumination Normalisation (retinex
 *                            approximation) + histogram equalisation.  Goal:
 *                            cross-condition descriptor stability so features
 *                            detected on a video frame match those on a route
 *                            photo taken under different lighting.
 *
 *   applyPosePreprocessing — Adaptive gamma + optional equalisation blend.
 *                            Goal: maximise body-keypoint visibility for
 *                            MediaPipe.  Parameters are driven by a
 *                            FrameAnalysis so every detection frame adjusts
 *                            automatically.
 *
 * The legacy applyFramePreprocessing (user-condition driven) is retained for
 * backward compatibility.
 *
 * Only the canvas passed explicitly is modified.
 * This module is framework-agnostic — no React imports. Keep it that way.
 *
 * NOTE: The `@techstark/opencv-js` WASM build does NOT expose `cv.createCLAHE`.
 * All local contrast enhancement is done via `cv.equalizeHist` + `cv.addWeighted`
 * blending, relying only on functions confirmed to exist in the bundle.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

import type { FrameAnalysis } from "@/pipeline/frameAnalyzer";

/**
 * Apply in-place preprocessing to a canvas based on user-selected lighting
 * conditions. If no relevant conditions are selected the function is a no-op.
 *
 * Conditions and their effect:
 *   washed_out  — equalizeHist blended at 40 %: restores global contrast in
 *                 overexposed regions.
 *   backlit     — equalizeHist blend (40 %) + gamma boost (γ=1.4): improves
 *                 contrast then lifts midtones to reduce silhouette effect.
 *   shadows     — equalizeHist blended at 60 %: stronger enhancement for
 *                 heavily shadowed regions.
 *   blends      — equalizeHist blended at 40 %: improves edge separation
 *                 between climber and wall.
 *   indoor_gym  — GaussianBlur (σ=3) + equalizeHist blended at 40 %: evens
 *                 out large fluorescent hot-spots before boosting contrast.
 *   dusty       — Unsharp masking (Gaussian σ=1.5, weight 1.5/−0.5): restores
 *                 edge clarity lost to lens fog, chalk dust, or condensation.
 *
 * When both an equalize condition and dusty are selected, sharpening is
 * applied to the contrast-enhanced image.
 */
export function applyFramePreprocessing(
  cv: CV,
  canvas: HTMLCanvasElement,
  conditions: ReadonlySet<string>,
): void {
  if (conditions.size === 0) return;

  const useEqualize =
    conditions.has("washed_out") ||
    conditions.has("backlit") ||
    conditions.has("shadows") ||
    conditions.has("blends") ||
    conditions.has("indoor_gym");
  const useGamma = conditions.has("backlit");
  const useDusty = conditions.has("dusty");

  if (!useEqualize && !useDusty) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let src: CV | null        = null;
  let gray: CV | null       = null;
  let eqOut: CV | null      = null;
  let blendOut: CV | null   = null;
  let preBlur: CV | null    = null;
  let gammaOut: CV | null   = null;
  let blurred: CV | null    = null;
  let sharpened: CV | null  = null;

  try {
    src  = cv.matFromImageData(imageData);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // `current` always points to whichever Mat holds the latest result.
    // We never free `gray` via this alias — it is freed in the finally block.
    let current: CV = gray;

    // --- Contrast enhancement (equalizeHist + blend) -------------------------
    if (useEqualize) {
      // For indoor_gym, pre-blur to even out large hotspots before equalising.
      if (conditions.has("indoor_gym")) {
        preBlur = new cv.Mat();
        cv.GaussianBlur(current, preBlur, new cv.Size(0, 0), 3);
        current = preBlur;
      }

      eqOut = new cv.Mat();
      cv.equalizeHist(current, eqOut);

      // Blend ratio: shadows → stronger (60 %), others → moderate (40 %).
      const alpha = conditions.has("shadows") ? 0.6 : 0.4;
      blendOut = new cv.Mat();
      cv.addWeighted(eqOut, alpha, current, 1 - alpha, 0, blendOut);
      current = blendOut;
    }

    // --- Gamma boost (backlit only) ------------------------------------------
    if (useGamma) {
      const lut = buildGammaLut(cv, 1.4);
      gammaOut = new cv.Mat();
      try {
        cv.LUT(current, lut, gammaOut);
      } finally {
        lut.delete();
      }
      current = gammaOut;
    }

    // --- Unsharp masking (dusty lens) -----------------------------------------
    if (useDusty) {
      blurred   = new cv.Mat();
      sharpened = new cv.Mat();
      cv.GaussianBlur(current, blurred, new cv.Size(0, 0), 1.5);
      cv.addWeighted(current, 1.5, blurred, -0.5, 0, sharpened);
      current = sharpened;
    }

    // Write the processed grayscale image back to the canvas.
    cv.imshow(canvas, current);
  } finally {
    sharpened?.delete();
    blurred?.delete();
    gammaOut?.delete();
    blendOut?.delete();
    eqOut?.delete();
    preBlur?.delete();
    gray?.delete();
    src?.delete();
  }
}

/**
 * Build a 1×256 look-up table for gamma correction.
 * γ > 1 brightens (lifts underexposed / backlit frames).
 * γ < 1 darkens  (compresses overexposed highlights).
 * Caller is responsible for calling .delete() on the returned Mat.
 */
function buildGammaLut(cv: CV, gamma: number): CV {
  const lut = new cv.Mat(1, 256, cv.CV_8UC1);
  for (let i = 0; i < 256; i++) {
    lut.data[i] = Math.min(255, Math.round(Math.pow(i / 255.0, 1.0 / gamma) * 255));
  }
  return lut;
}

// ---------------------------------------------------------------------------
// ORB preprocessing
// ---------------------------------------------------------------------------

/**
 * Preprocess a canvas for ORB feature extraction.
 *
 * Goal: cross-condition descriptor stability — keypoints detected on this
 * video frame should reliably match those on a route photo taken under
 * different lighting (indoor gym vs outdoor daylight, etc.).
 *
 * Algorithm:
 *   1. Grayscale conversion.
 *   2. Large-σ Gaussian blur (σ=30) → coarse illumination estimate.
 *   3. Retinex approximation: subtract 75 % of illumination, re-centre at 96.
 *      This removes global and regional lighting gradients while preserving
 *      local texture contrast.
 *   4. Histogram equalisation on the LCN image to align intensity scales.
 *   5. Blend: 55 % equalised + 45 % LCN — preserves texture while normalising.
 *   6. Light unsharp mask (σ=1.5, weight 1.6/−0.6) when the frame is blurry.
 *
 * The large-σ blur is only applied once (ORB runs on a single reference frame),
 * so the added cost (~60–200 ms at typical video resolutions) is acceptable.
 */
export function applyOrbPreprocessing(
  cv: CV,
  canvas: HTMLCanvasElement,
  analysis: FrameAnalysis,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let src: CV | null      = null;
  let gray: CV | null     = null;
  let illum: CV | null    = null;
  let lcn: CV | null      = null;
  let equalized: CV | null = null;
  let blended: CV | null  = null;
  let blurBuf: CV | null  = null;
  let sharpened: CV | null = null;

  try {
    src  = cv.matFromImageData(imageData);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Illumination estimate via large-σ blur
    illum = new cv.Mat();
    cv.GaussianBlur(gray, illum, new cv.Size(0, 0), 30);

    // Retinex approximation: remove 75 % of illumination, re-centre at 96
    lcn = new cv.Mat();
    cv.addWeighted(gray, 1.0, illum, -0.75, 96, lcn);

    // Histogram equalisation on the LCN image
    equalized = new cv.Mat();
    cv.equalizeHist(lcn, equalized);

    // Blend equalised and LCN
    blended = new cv.Mat();
    cv.addWeighted(equalized, 0.55, lcn, 0.45, 0, blended);

    let current: CV = blended;

    // Unsharp mask for blurry / dusty frames
    if (analysis.isBlurry) {
      blurBuf   = new cv.Mat();
      sharpened = new cv.Mat();
      cv.GaussianBlur(current, blurBuf, new cv.Size(0, 0), 1.5);
      cv.addWeighted(current, 1.6, blurBuf, -0.6, 0, sharpened);
      current = sharpened;
    }

    cv.imshow(canvas, current);
  } finally {
    sharpened?.delete();
    blurBuf?.delete();
    blended?.delete();
    equalized?.delete();
    lcn?.delete();
    illum?.delete();
    gray?.delete();
    src?.delete();
  }
}

// ---------------------------------------------------------------------------
// Pose preprocessing
// ---------------------------------------------------------------------------

/**
 * Preprocess a canvas for MediaPipe pose detection.
 *
 * Goal: maximise body-keypoint confidence by adapting to the frame's specific
 * lighting conditions as measured by analyzeFrame().
 *
 * Steps (each only applied when the analysis indicates it is needed):
 *   1. Grayscale conversion.
 *   2. Gamma correction — darken if overexposed (γ<1), brighten if backlit
 *      or underexposed (γ>1).  The exponent is adaptive (analysis.suggestedGamma).
 *   3. Histogram equalisation blend — weight from analysis.contrastAlpha (0=skip).
 *   4. Unsharp mask (σ=1.5) when the frame is blurry.
 *
 * Returns immediately without any WASM allocation if no correction is needed
 * (gamma==1.0, contrastAlpha==0, not blurry) — no performance cost for
 * well-exposed frames.
 */
export function applyPosePreprocessing(
  cv: CV,
  canvas: HTMLCanvasElement,
  analysis: FrameAnalysis,
): void {
  const { suggestedGamma, contrastAlpha, isBlurry } = analysis;
  if (suggestedGamma === 1.0 && contrastAlpha === 0 && !isBlurry) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let src: CV | null      = null;
  let gray: CV | null     = null;
  let gammaOut: CV | null = null;
  let eqOut: CV | null    = null;
  let blendOut: CV | null = null;
  let blurred: CV | null  = null;
  let sharpened: CV | null = null;

  try {
    src  = cv.matFromImageData(imageData);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    let current: CV = gray;

    // Adaptive gamma correction
    if (suggestedGamma !== 1.0) {
      const lut = buildGammaLut(cv, suggestedGamma);
      gammaOut = new cv.Mat();
      try {
        cv.LUT(current, lut, gammaOut);
      } finally {
        lut.delete();
      }
      current = gammaOut;
    }

    // Adaptive histogram equalisation blend
    if (contrastAlpha > 0) {
      eqOut    = new cv.Mat();
      blendOut = new cv.Mat();
      cv.equalizeHist(current, eqOut);
      cv.addWeighted(eqOut, contrastAlpha, current, 1 - contrastAlpha, 0, blendOut);
      current = blendOut;
    }

    // Unsharp mask for blurry / dusty frames
    if (isBlurry) {
      blurred   = new cv.Mat();
      sharpened = new cv.Mat();
      cv.GaussianBlur(current, blurred, new cv.Size(0, 0), 1.5);
      cv.addWeighted(current, 1.5, blurred, -0.5, 0, sharpened);
      current = sharpened;
    }

    cv.imshow(canvas, current);
  } finally {
    sharpened?.delete();
    blurred?.delete();
    blendOut?.delete();
    eqOut?.delete();
    gammaOut?.delete();
    gray?.delete();
    src?.delete();
  }
}
