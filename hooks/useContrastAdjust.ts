"use client";

import { useEffect, useState } from "react";
import { computeContrastAdjust, type ContrastAdjust } from "@/pipeline/overlay/contrastAdapter";
import { sampleBackdropLuma } from "@/utils/backdropLuma";
import type { CropFraction } from "@/utils/cropFraction";

// ---------------------------------------------------------------------------
// useContrastAdjust — resolve a per-surface ContrastAdjust from a backdrop image.
//
// Decodes the backdrop once (memoised by File identity + crop rect), samples its
// luminance band via the cv-free DOM sampler, and returns a ContrastAdjust the
// overlay draw modules can thread down. Returns undefined when no backdrop is
// available or sampling fails.
//
// It always samples (not gated by the user's opt-in), so callers can *detect*
// poor contrast — `paletteContrastIsPoor(adjust)` — and offer the boost even
// while adaptation is off. The caller decides whether to actually apply the
// returned adjust. The model is static-per-surface, so this recomputes only when
// the photo or crop changes — never per frame (that would shimmer and waste work).
// ---------------------------------------------------------------------------

/** Round a crop rect into a stable dependency key so tiny drags don't re-sample. */
function cropKey(crop?: CropFraction): string {
  if (!crop) return "full";
  const q = (n: number) => Math.round(n * 1000);
  return `${q(crop.x)},${q(crop.y)},${q(crop.w)},${q(crop.h)}`;
}

/**
 * @param backdrop - The image the overlay is drawn over (route photo or wall crop
 *                   source). Null disables sampling.
 * @param crop     - Optional fractional rect to sample (e.g. the wall crop).
 */
export function useContrastAdjust(
  backdrop: File | null,
  crop?: CropFraction,
): ContrastAdjust | undefined {
  const [adjust, setAdjust] = useState<ContrastAdjust | undefined>(undefined);
  const key = cropKey(crop);

  useEffect(() => {
    if (!backdrop) {
      setAdjust(undefined);
      return;
    }

    let cancelled = false;
    createImageBitmap(backdrop)
      .then((bmp) => {
        if (cancelled) {
          bmp.close();
          return;
        }
        const stats = sampleBackdropLuma(bmp, bmp.width, bmp.height, crop);
        bmp.close();
        if (!cancelled) setAdjust(stats ? computeContrastAdjust(stats) : undefined);
      })
      .catch(() => {
        if (!cancelled) setAdjust(undefined);
      });

    return () => {
      cancelled = true;
    };
    // `key` captures the crop rect; `backdrop` identity captures the photo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backdrop, key]);

  return adjust;
}
