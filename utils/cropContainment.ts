// ---------------------------------------------------------------------------
// Climber/route crop geometry — pure, React-free.
//
// The detection step shows two crops at once: the inner **Climber** crop (the
// MediaPipe seed region) and the outer **Route** crop (the ORB wall region).
// The two boxes are **independent** — each is dragged and resized freely,
// clamped only to the frame. The Route is no longer forced to contain the
// Climber: requiring containment padded the Route with floor / spectators /
// neighbouring rock that is not the target face, starving route-photo matching.
// The Route only *starts* framed around the Climber (see
// `defaultRouteAroundClimber`); from there the User sizes it to the rock face.
// See ADR 0016.
// ---------------------------------------------------------------------------

import { type CropFraction } from "@/utils/cropFraction";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Inset (frac) of the default Route from the frame edges so it is grabbable. */
const ROUTE_EDGE_PAD = 0.05;

/** Clamp a crop rect into the frame [0, 1], keeping a non-negative size. */
export function frameClampCrop(c: CropFraction): CropFraction {
  const x = clamp01(c.x);
  const y = clamp01(c.y);
  const w = Math.max(0, Math.min(c.w, 1 - x));
  const h = Math.max(0, Math.min(c.h, 1 - y));
  return { x, y, w, h };
}

/**
 * Default Route crop the moment the Climber is identified: inset from the frame
 * edges by {@link ROUTE_EDGE_PAD} so the box reads as grabbable (never flush
 * against the edge), widened as needed to frame the Climber, with the **bottom
 * pulled up to the Climber's bottom** so the floor / pad below (ORB noise, not
 * wall texture) is excluded. This is only the starting frame — the User is free
 * to resize it to anything from here.
 */
export function defaultRouteAroundClimber(climber: CropFraction): CropFraction {
  const x = Math.min(ROUTE_EDGE_PAD, climber.x);
  const y = Math.min(ROUTE_EDGE_PAD, climber.y);
  const right = Math.max(1 - ROUTE_EDGE_PAD, climber.x + climber.w);
  const bottom = clamp01(climber.y + climber.h);
  return frameClampCrop({ x, y, w: right - x, h: bottom - y });
}

/**
 * Half-size (fraction of the frame) of the seed acquisition box on each side of
 * the Seed tap. A tap yields a square of twice this per side, clamped to the
 * frame — the region the downloader gates the ViTPose seed against in place of
 * the Climber Crop (harness-setup-calibrate-split).
 */
export const SEED_REGION_HALF = 0.15;

/**
 * The acquisition box the downloader gates the ViTPose seed against, centered on
 * the Seed tap and clamped to the frame. Because the tap is always the box
 * center, the seed is independent of the Climber Crop (which no longer gates
 * it). A null tap yields the full frame, so an untapped job acquires the
 * strongest pose rather than nothing.
 */
export function deriveSeedRegion(point: { x: number; y: number } | null): CropFraction {
  if (!point) return { x: 0, y: 0, w: 1, h: 1 };
  return frameClampCrop({
    x: point.x - SEED_REGION_HALF,
    y: point.y - SEED_REGION_HALF,
    w: SEED_REGION_HALF * 2,
    h: SEED_REGION_HALF * 2,
  });
}
