// ---------------------------------------------------------------------------
// CropFraction — a fractional crop rectangle, expressed as fractions of the
// container dimensions. Plain data with no React dependency, so the hook and
// pipeline layers can consume it without importing the CropBoxOverlay
// component (which would invert the framework boundary).
//
// components/capture/CropBoxOverlay.tsx re-exports these for component callers.
// ---------------------------------------------------------------------------

/**
 * Crop region expressed as fractions of the container dimensions.
 * All values are in [0, 1] relative to the image/video natural dimensions.
 */
export interface CropFraction {
  /** Left edge fraction [0, 1] */
  x: number;
  /** Top edge fraction [0, 1] */
  y: number;
  /** Width fraction [0, 1] */
  w: number;
  /** Height fraction [0, 1] */
  h: number;
}

/** Default crop box: slight inset from edges. */
export const DEFAULT_CROP: CropFraction = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
