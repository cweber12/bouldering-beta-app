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
