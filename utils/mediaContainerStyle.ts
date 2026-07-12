import type { CSSProperties } from "react";

/**
 * Viewport-fit container style for aspect-ratio-constrained media with overlays.
 *
 * The container fills as much horizontal space as possible while never exceeding
 * the available viewport height, so that CropBoxOverlay fraction coordinates
 * always map 1:1 to the visible media area.
 *
 * `navOffset` is the additional bottom padding subtracted from the viewport
 * height alongside the nav bar height (default `"1rem"`).
 */
export function mediaContainerStyle(w: number, h: number, navOffset = "1rem"): CSSProperties {
  const ratio = (w / h).toFixed(6);
  const maxH = `calc(100dvh - var(--nav-h) - ${navOffset})`;
  return {
    width: `min(100%, calc(${maxH} * ${ratio}))`,
    maxHeight: maxH,
    aspectRatio: `${w} / ${h}`,
  };
}

/**
 * Fullscreen variant — no nav-bar offset, just 8rem for close/toolbar UI.
 */
export function fsMediaContainerStyle(w: number, h: number): CSSProperties {
  const ratio = (w / h).toFixed(6);
  const maxH = "calc(100dvh - 8rem)";
  return {
    width: `min(100%, calc(${maxH} * ${ratio}))`,
    maxHeight: maxH,
    aspectRatio: `${w} / ${h}`,
  };
}

// ---------------------------------------------------------------------------
// Height-filling sizing
//
// Fills the available vertical space `s` with the media; the width follows the
// aspect ratio and is capped to the container width (`100%`). Both orientations
// reach the full height on wide-enough viewports — portrait fills the height
// with a narrower width, and landscape fills the height too (capping to the
// viewport width only on narrow screens). This keeps the media flush against
// the footer instead of leaving a vertical gap below a height-capped clip.
// ---------------------------------------------------------------------------

/**
 * Width term for height-filling media from a *measured* available-space value
 * `s` (px). Returns `"100%"` before measurement (`s <= 0`). Reused to align the
 * transport bar to the media width.
 */
export function fitMediaWidth(w: number, h: number, s: number): string {
  if (!(s > 0)) return "100%";
  return `min(100%, ${(s * (w / h)).toFixed(2)}px)`;
}

/**
 * Height-filling container style from a *measured* available-space value `s`
 * (px). The container is the media bounds (use `object-fill`) so CropBoxOverlay
 * fractions map 1:1.
 */
export function fitMediaStyle(w: number, h: number, s: number): CSSProperties {
  return {
    width: fitMediaWidth(w, h, s),
    maxHeight: s > 0 ? `${s.toFixed(2)}px` : undefined,
    aspectRatio: `${w} / ${h}`,
  };
}

/**
 * Height-filling max-width from a dvh-based available height — for surfaces that
 * keep a flow layout (e.g. the Step 3 review column) rather than a measured
 * stage. `offset` is subtracted alongside `--nav-h`.
 */
export function fitMediaMaxWidth(w: number, h: number, offset: string): string {
  const ratio = (w / h).toFixed(4);
  return `min(100%, calc((100dvh - var(--nav-h) - ${offset}) * ${ratio}))`;
}
