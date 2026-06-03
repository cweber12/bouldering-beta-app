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
  return { width: `min(100%, calc(${maxH} * ${ratio}))`, maxHeight: maxH, aspectRatio: `${w} / ${h}` };
}

/**
 * Fullscreen variant — no nav-bar offset, just 8rem for close/toolbar UI.
 */
export function fsMediaContainerStyle(w: number, h: number): CSSProperties {
  const ratio = (w / h).toFixed(6);
  const maxH = "calc(100dvh - 8rem)";
  return { width: `min(100%, calc(${maxH} * ${ratio}))`, maxHeight: maxH, aspectRatio: `${w} / ${h}` };
}

// ---------------------------------------------------------------------------
// Square-bounded sizing
//
// Bounds the media's *longer* edge to `s` (the available vertical space) — i.e.
// fits it inside an `s × s` square. Portrait clips (ratio < 1) fill the full
// height `s` with a narrower width; landscape clips (ratio > 1) are capped to
// `s` wide with a shorter height, so wide videos never sprawl across desktop
// viewports. This is the only difference from the plain viewport-fit style:
// the width term uses `min(1, ratio)` instead of `ratio`.
// ---------------------------------------------------------------------------

/**
 * Width term for square-bounded media from a *measured* available-space value
 * `s` (px). Returns `"100%"` before measurement (`s <= 0`). Reused to align the
 * transport bar to the media width.
 */
export function squareMediaWidth(w: number, h: number, s: number): string {
  if (!(s > 0)) return "100%";
  const cappedRatio = Math.min(1, w / h);
  return `min(100%, ${(s * cappedRatio).toFixed(2)}px)`;
}

/**
 * Square-bounded container style from a *measured* available-space value `s`
 * (px). The container is the media bounds (use `object-fill`) so CropBoxOverlay
 * fractions map 1:1.
 */
export function squareMediaStyle(w: number, h: number, s: number): CSSProperties {
  return {
    width: squareMediaWidth(w, h, s),
    maxHeight: s > 0 ? `${s.toFixed(2)}px` : undefined,
    aspectRatio: `${w} / ${h}`,
  };
}

/**
 * Square-bounded max-width from a dvh-based available height — for surfaces that
 * keep a flow layout (e.g. the Step 3 review column) rather than a measured
 * stage. `offset` is subtracted alongside `--nav-h`.
 */
export function squareMediaMaxWidth(w: number, h: number, offset: string): string {
  const cappedRatio = Math.min(1, w / h).toFixed(4);
  return `min(100%, calc((100dvh - var(--nav-h) - ${offset}) * ${cappedRatio}))`;
}
