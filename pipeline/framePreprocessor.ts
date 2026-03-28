/**
 * Lighting-condition-specific preprocessing applied to the pose-detection
 * canvas before each frame is analysed by MoveNet.
 *
 * Only the canvas passed explicitly is modified — the ORB reference canvas
 * and any other surfaces are left untouched.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 *
 * NOTE: The `@techstark/opencv-js` WASM build does NOT expose `cv.createCLAHE`.
 * All local contrast enhancement is therefore done via `cv.equalizeHist` +
 * `cv.addWeighted` blending — a lighter-weight approximation that uses only
 * functions available in the prebuilt WASM bundle.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

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
 * Caller is responsible for calling .delete() on the returned Mat.
 */
function buildGammaLut(cv: CV, gamma: number): CV {
  const lut = new cv.Mat(1, 256, cv.CV_8UC1);
  for (let i = 0; i < 256; i++) {
    lut.data[i] = Math.min(255, Math.round(Math.pow(i / 255.0, 1.0 / gamma) * 255));
  }
  return lut;
}
