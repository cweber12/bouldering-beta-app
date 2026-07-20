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
 * The downloader's seed crop gate, mirrored: a ViTPose seed candidate's box
 * center must fall inside the Climber Crop expanded by this fraction of its
 * size on each side (`_CROP_GATE_EXPAND` in the downloader's vitpose_job.py),
 * and there is deliberately no un-crop fallback. A Climber tap outside that
 * region can therefore never seed — every job returns `seedFound: false`.
 */
export const SEED_CROP_GATE_EXPAND = 0.1;

/**
 * True when a Climber tap sits outside the expanded Climber Crop — i.e. a
 * ViTPose job seeded from it is structurally unable to match any track.
 * Surfaced as a calibration warning before the job is ever submitted.
 */
export function tapOutsideSeedGate(
  point: { x: number; y: number } | null,
  crop: CropFraction,
): boolean {
  if (!point) return false;
  const padX = crop.w * SEED_CROP_GATE_EXPAND;
  const padY = crop.h * SEED_CROP_GATE_EXPAND;
  return (
    point.x < crop.x - padX ||
    point.x > crop.x + crop.w + padX ||
    point.y < crop.y - padY ||
    point.y > crop.y + crop.h + padY
  );
}
