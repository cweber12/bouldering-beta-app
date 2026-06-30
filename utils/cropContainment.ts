// ---------------------------------------------------------------------------
// Nested climber/route crop containment — pure, React-free geometry.
//
// The detection step shows two crops at once: the inner **Climber** crop (the
// MediaPipe seed region) and the outer **Route** crop (the ORB wall region).
// The Climber is dominant — moving/resizing it pushes the Route out so the Route
// always contains it. The Route is subordinate — editing it can never cross
// inside the Climber. The push is grow-only: a Route edge stays where it was
// pushed when the Climber later retreats (it does not spring back).
//
// All three rules collapse to one operation — grow the Route (clamped to frame)
// so it covers the Climber — because a min/max union never shrinks a Route that
// already contains the Climber. See ADR 0014.
// ---------------------------------------------------------------------------

import { type CropFraction } from "@/utils/cropFraction";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Clamp a crop rect into the frame [0, 1], keeping a non-negative size. */
export function frameClampCrop(c: CropFraction): CropFraction {
  const x = clamp01(c.x);
  const y = clamp01(c.y);
  const w = Math.max(0, Math.min(c.w, 1 - x));
  const h = Math.max(0, Math.min(c.h, 1 - y));
  return { x, y, w, h };
}

/**
 * Grow `route` (grow-only) so it fully contains `climber`, then clamp to frame.
 *
 * Serves every containment rule:
 *  - **climber pushes route out** — when the climber spills past a route edge,
 *    that edge expands to cover it;
 *  - **route can't cross inside the climber** — re-applying this after a route
 *    edit pins any edge dragged past the climber back to the climber's edge;
 *  - **grow-only** — a climber already inside leaves the route untouched, so the
 *    route never auto-shrinks when the climber retreats.
 */
export function containRoute(route: CropFraction, climber: CropFraction): CropFraction {
  const x0 = Math.min(route.x, climber.x);
  const y0 = Math.min(route.y, climber.y);
  const x1 = Math.max(route.x + route.w, climber.x + climber.w);
  const y1 = Math.max(route.y + route.h, climber.y + climber.h);
  return frameClampCrop({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

/**
 * Default Route crop the moment the Climber is identified: near full-frame, but
 * the **bottom edge pulled up to the Climber's bottom** so the floor / pad below
 * the climber (ORB noise, not wall texture) is excluded. Always contains the
 * Climber.
 */
export function defaultRouteAroundClimber(climber: CropFraction): CropFraction {
  const base: CropFraction = { x: 0, y: 0, w: 1, h: clamp01(climber.y + climber.h) };
  return containRoute(base, climber);
}
