import { describe, expect, it } from "vitest";
import {
  HANDOFF_MS,
  PHASE_1_END,
  PHASE_1_MID,
  PHASE_2_END,
  PHASE_3_END,
  clipProgress,
  composePlaylistLayers,
  composeReplayFrame,
  containRect,
  morphKeypoints,
  sampleReplayPose,
  toStage,
} from "@/pipeline/overlay/landingReplayFrame";
import type { ReplayPose } from "@/pipeline/overlay/landingReplayItem";

const DURATION = 8000;

/** Elapsed ms landing on a given clip progress. */
const at = (progress: number) => progress * DURATION;

describe("clipProgress", () => {
  it("maps elapsed time onto [0,1] within one clip", () => {
    expect(clipProgress(0, DURATION)).toBe(0);
    expect(clipProgress(2000, DURATION)).toBeCloseTo(0.25, 6);
    expect(clipProgress(6000, DURATION)).toBeCloseTo(0.75, 6);
  });

  it("wraps past the clip length so a single clock can loop", () => {
    expect(clipProgress(10_000, DURATION)).toBeCloseTo(0.25, 6);
  });

  it("reads a whole number of clips as the end of a clip, not the start", () => {
    // This is what lets the reduced-motion clock park on the duration and show
    // the finished Route Overlay rather than snapping back to the starfield.
    expect(clipProgress(DURATION, DURATION)).toBe(1);
    expect(clipProgress(2 * DURATION, DURATION)).toBe(1);
  });

  it("is inert for a zero-length clip", () => {
    expect(clipProgress(1234, 0)).toBe(0);
  });
});

describe("composeReplayFrame", () => {
  it("opens on the dark stage and raises the wall still behind the figure", () => {
    const open = composeReplayFrame(0, DURATION);
    expect(open.phase).toBe(1);
    expect(open.frameAlpha).toBe(0); // the cold open is still dark
    expect(open.starfieldAlpha).toBe(0);
    expect(open.trailAlpha).toBe(1);

    const rising = composeReplayFrame(at(PHASE_1_MID / 2), DURATION);
    expect(rising.frameAlpha).toBeCloseTo(0.5, 6);
    expect(rising.starfieldAlpha).toBe(0); // nothing ignites until the still lands
  });

  it("ignites the starfield on the still across the rest of phase 1", () => {
    const landed = composeReplayFrame(at(PHASE_1_MID), DURATION);
    expect(landed.frameAlpha).toBe(1);
    expect(landed.starfieldAlpha).toBe(0);

    const half = composeReplayFrame(at((PHASE_1_MID + PHASE_1_END) / 2), DURATION);
    expect(half.frameAlpha).toBe(1);
    expect(half.starfieldAlpha).toBeCloseTo(0.5, 6);

    const full = composeReplayFrame(at(PHASE_1_END), DURATION);
    expect(full.starfieldAlpha).toBeCloseTo(1, 6);
    expect(full.matchAlpha).toBeCloseTo(0, 6);
    expect(full.photoAlpha).toBe(0);
    expect(full.morph).toBe(0);
    expect(full.trailAlpha).toBe(1);
  });

  it("cross-dissolves the still into the Route Photo across phase 3", () => {
    const mid = composeReplayFrame(at((PHASE_2_END + PHASE_3_END) / 2), DURATION);
    expect(mid.frameAlpha).toBeCloseTo(0.5, 3);
    // The two real photographs hand over without the stage ever showing through.
    expect(mid.frameAlpha + mid.photoAlpha).toBeCloseTo(1, 6);

    const done = composeReplayFrame(at(PHASE_3_END), DURATION);
    expect(done.frameAlpha).toBeCloseTo(0, 6);
    expect(done.photoAlpha).toBe(1);
  });

  it("crosses into phase 2 with no visible step", () => {
    const before = composeReplayFrame(at(PHASE_1_END - 0.0001), DURATION);
    const boundary = composeReplayFrame(at(PHASE_1_END), DURATION);
    expect(before.phase).toBe(1);
    expect(boundary.phase).toBe(2);
    expect(boundary.starfieldAlpha).toBeCloseTo(1, 3);
    expect(boundary.matchAlpha).toBeCloseTo(0, 3);
    expect(boundary.photoAlpha).toBe(0);
    expect(boundary.morph).toBe(0);
  });

  it("fades the starfield out as the matched points come up through phase 2", () => {
    const mid = composeReplayFrame(at((PHASE_1_END + PHASE_2_END) / 2), DURATION);
    expect(mid.phase).toBe(2);
    expect(mid.starfieldAlpha).toBeCloseTo(0.5, 3);
    expect(mid.matchAlpha).toBeCloseTo(0.5, 3);
    expect(mid.photoAlpha).toBe(0);
    expect(mid.morph).toBe(0); // the figure is still in source space
  });

  it("crosses into phase 3 with the starfield gone, matches up, morph not started", () => {
    const f = composeReplayFrame(at(PHASE_2_END), DURATION);
    expect(f.phase).toBe(3);
    expect(f.starfieldAlpha).toBeCloseTo(0, 6);
    expect(f.matchAlpha).toBeCloseTo(1, 6);
    expect(f.photoAlpha).toBe(0);
    expect(f.morph).toBe(0);
  });

  it("raises the photo and carries the morph across phase 3", () => {
    const mid = composeReplayFrame(at((PHASE_2_END + PHASE_3_END) / 2), DURATION);
    expect(mid.phase).toBe(3);
    expect(mid.photoAlpha).toBeCloseTo(0.5, 3);
    expect(mid.morph).toBeGreaterThan(0);
    expect(mid.morph).toBeLessThan(1);
    expect(mid.matchAlpha).toBeCloseTo(1, 6); // still fully present
    expect(mid.trailAlpha).toBeCloseTo(0.5, 3);
  });

  it("crosses into phase 4 with the morph complete and the photo full", () => {
    const f = composeReplayFrame(at(PHASE_3_END), DURATION);
    expect(f.phase).toBe(4);
    expect(f.morph).toBe(1);
    expect(f.photoAlpha).toBe(1);
    expect(f.matchAlpha).toBeCloseTo(1, 6);
    expect(f.trailAlpha).toBeCloseTo(0, 6);
  });

  it("retires the matched points across phase 4 so the Route Overlay stands alone", () => {
    const mid = composeReplayFrame(at((PHASE_3_END + 1) / 2), DURATION);
    expect(mid.matchAlpha).toBeCloseTo(0.5, 3);

    const end = composeReplayFrame(DURATION, DURATION);
    expect(end.phase).toBe(4);
    expect(end.progress).toBe(1);
    expect(end.frameAlpha).toBe(0);
    expect(end.starfieldAlpha).toBe(0);
    expect(end.matchAlpha).toBe(0);
    expect(end.trailAlpha).toBe(0);
    expect(end.photoAlpha).toBe(1);
    expect(end.morph).toBe(1);
  });

  it("reports clip-relative seconds that advance with the clock", () => {
    expect(composeReplayFrame(0, DURATION).clipSeconds).toBe(0);
    expect(composeReplayFrame(2000, DURATION).clipSeconds).toBeCloseTo(2, 6);
    expect(composeReplayFrame(DURATION, DURATION).clipSeconds).toBeCloseTo(8, 6);
  });

  it("plays a wider capture window across the same screen window", () => {
    // 14 captured seconds over an 8s animation: the figure runs at 1.75×.
    const rate = 14 / 8;
    expect(composeReplayFrame(0, DURATION, 14).clipSeconds).toBe(0);
    expect(composeReplayFrame(2000, DURATION, 14).clipSeconds).toBeCloseTo(2 * rate, 6);
    // The clip still lands exactly on its own last captured second at the end.
    expect(composeReplayFrame(DURATION, DURATION, 14).clipSeconds).toBeCloseTo(14, 6);
  });

  it("leaves the phase windows on screen time, whatever the capture rate", () => {
    for (const capture of [4, 8, 14, 30]) {
      const f = composeReplayFrame(at(PHASE_2_END), DURATION, capture);
      expect(f.phase).toBe(3);
      expect(f.morph).toBe(0);
      expect(f.progress).toBeCloseTo(PHASE_2_END, 6);
      // Only the captured seconds move with the rate.
      expect(f.clipSeconds).toBeCloseTo(PHASE_2_END * capture, 6);
    }
  });

  it("keeps every alpha and the morph inside [0,1] across the whole clip", () => {
    for (let ms = 0; ms <= DURATION; ms += 25) {
      const f = composeReplayFrame(ms, DURATION);
      for (const v of [
        f.frameAlpha,
        f.starfieldAlpha,
        f.matchAlpha,
        f.photoAlpha,
        f.trailAlpha,
        f.morph,
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("composePlaylistLayers", () => {
  const COUNT = 3;
  const layers = (elapsed: number) => composePlaylistLayers(elapsed, COUNT, DURATION);
  /** The layer actually carrying the stage at this instant. */
  const showing = (elapsed: number) => layers(elapsed).reduce((a, b) => (b.alpha >= a.alpha ? b : a));

  it("starts on the first item rather than fading in from the last", () => {
    expect(layers(0)).toEqual([{ index: 0, elapsedMs: 0, alpha: 1 }]);
    expect(layers(HANDOFF_MS / 2)).toEqual([
      { index: 0, elapsedMs: HANDOFF_MS / 2, alpha: 1 },
    ]);
  });

  it("plays items in file order, one clip-length slot each", () => {
    expect(showing(1000).index).toBe(0);
    expect(showing(DURATION + 1000).index).toBe(1);
    expect(showing(2 * DURATION + 1000).index).toBe(2);
  });

  it("advances each item's own clip within its slot", () => {
    expect(layers(2000)).toEqual([{ index: 0, elapsedMs: 2000, alpha: 1 }]);
    expect(layers(DURATION + 2000)).toEqual([{ index: 1, elapsedMs: 2000, alpha: 1 }]);
  });

  it("shows exactly one item at full opacity away from a handoff", () => {
    for (let ms = HANDOFF_MS; ms < DURATION; ms += 100) {
      expect(layers(ms)).toEqual([{ index: 0, elapsedMs: ms, alpha: 1 }]);
    }
  });

  it("crossfades the handoff over ~300ms, back to front, alphas summing to 1", () => {
    const mid = layers(DURATION + HANDOFF_MS / 2);
    expect(mid).toHaveLength(2);
    // Outgoing first (painted beneath), incoming second.
    expect(mid[0].index).toBe(0);
    expect(mid[1].index).toBe(1);
    expect(mid[0].alpha).toBeCloseTo(0.5, 6);
    expect(mid[1].alpha).toBeCloseTo(0.5, 6);
    expect(mid[0].alpha + mid[1].alpha).toBeCloseTo(1, 6);

    // The outgoing item holds its own final frame; the incoming one starts at 0.
    expect(mid[0].elapsedMs).toBe(DURATION);
    expect(mid[1].elapsedMs).toBeCloseTo(HANDOFF_MS / 2, 6);
  });

  it("completes the handoff exactly at the crossfade width", () => {
    expect(layers(DURATION + HANDOFF_MS - 1)).toHaveLength(2);
    expect(layers(DURATION + HANDOFF_MS)).toEqual([
      { index: 1, elapsedMs: HANDOFF_MS, alpha: 1 },
    ]);
  });

  it("opens each slot on the previous item's finished Route Overlay", () => {
    // Also the reduced-motion park: elapsed = one clip shows item 0's last frame.
    expect(layers(DURATION)).toEqual([{ index: 0, elapsedMs: DURATION, alpha: 1 }]);
    expect(layers(2 * DURATION)).toEqual([{ index: 1, elapsedMs: DURATION, alpha: 1 }]);
  });

  it("wraps to the first item and keeps cycling indefinitely", () => {
    const cycle = COUNT * DURATION;
    expect(showing(cycle + 1000).index).toBe(0);
    expect(showing(cycle + DURATION + 1000).index).toBe(1);
    expect(showing(7 * cycle + 2 * DURATION + 1000).index).toBe(2);

    // The wrap is a handoff like any other: item 2 hands off to item 0.
    const wrap = layers(cycle + HANDOFF_MS / 2);
    expect(wrap.map((l) => l.index)).toEqual([COUNT - 1, 0]);
  });

  it("is periodic — the same point of any cycle composes identically", () => {
    const cycle = COUNT * DURATION;
    // From the second cycle on; the first has no predecessor to hand off from.
    for (let ms = cycle; ms < 2 * cycle; ms += 250) {
      expect(layers(ms + 4 * cycle)).toEqual(layers(ms));
    }
  });

  it("never leaves the stage empty or over-painted", () => {
    for (let ms = 0; ms < 4 * COUNT * DURATION; ms += 37) {
      const stack = layers(ms);
      expect(stack.length).toBeGreaterThan(0);
      expect(stack.length).toBeLessThanOrEqual(2);
      let total = 0;
      for (const layer of stack) {
        expect(layer.index).toBeGreaterThanOrEqual(0);
        expect(layer.index).toBeLessThan(COUNT);
        expect(layer.alpha).toBeGreaterThan(0);
        expect(layer.alpha).toBeLessThanOrEqual(1);
        expect(layer.elapsedMs).toBeGreaterThanOrEqual(0);
        expect(layer.elapsedMs).toBeLessThanOrEqual(DURATION);
        total += layer.alpha;
      }
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it("loops a single-item playlist by crossfading it with itself", () => {
    const one = (ms: number) => composePlaylistLayers(ms, 1, DURATION);
    expect(one(2000)).toEqual([{ index: 0, elapsedMs: 2000, alpha: 1 }]);
    const wrap = one(DURATION + HANDOFF_MS / 2);
    expect(wrap.map((l) => l.index)).toEqual([0, 0]);
    expect(wrap[0].elapsedMs).toBe(DURATION); // the finished overlay, fading out
    expect(wrap[1].elapsedMs).toBeCloseTo(HANDOFF_MS / 2, 6); // the fresh starfield
  });

  it("is inert for an empty playlist and safe on degenerate inputs", () => {
    expect(composePlaylistLayers(1000, 0, DURATION)).toEqual([]);
    expect(composePlaylistLayers(1000, 2, 0)).toEqual([{ index: 0, elapsedMs: 0, alpha: 1 }]);
    expect(composePlaylistLayers(-1000, COUNT, DURATION)[0].alpha).toBeGreaterThan(0);
    // A handoff wider than the clip degrades to a permanent crossfade, not NaN.
    for (const layer of composePlaylistLayers(100, COUNT, DURATION, DURATION * 5)) {
      expect(Number.isFinite(layer.alpha)).toBe(true);
    }
  });
});

describe("containRect", () => {
  it("letterboxes a portrait plane into a portrait stage", () => {
    const r = containRect(1080, 1920, 506, 900);
    expect(r.w).toBeCloseTo(506, 3);
    expect(r.h).toBeCloseTo(899.55, 1);
    expect(r.x).toBeCloseTo(0, 3);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });

  it("pillarboxes a landscape plane into the same stage", () => {
    const r = containRect(1600, 1200, 506, 900);
    expect(r.w).toBeCloseTo(506, 3);
    expect(r.h).toBeCloseTo(379.5, 1);
    expect(r.y).toBeCloseTo((900 - 379.5) / 2, 1);
  });

  it("gives both coordinate planes fixed placements, so the morph cannot reflow", () => {
    const source = containRect(1080, 1920, 506, 900);
    const photo = containRect(1200, 1600, 506, 900);
    // Independent of any clock value — computed once per item, per plane.
    expect(containRect(1080, 1920, 506, 900)).toEqual(source);
    expect(source).not.toEqual(photo);
    // Both stay inside the stage.
    for (const r of [source, photo]) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(506 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(900 + 1e-9);
    }
  });

  it("survives a zero dimension rather than emitting NaN", () => {
    const r = containRect(0, 0, 506, 900);
    expect(Number.isFinite(r.w)).toBe(true);
    expect(Number.isFinite(r.h)).toBe(true);
  });

  it("maps normalized points into the plane's rectangle", () => {
    const r = containRect(1000, 1000, 500, 900);
    expect(toStage(r, 0, 0)).toEqual({ x: 0, y: 200 });
    expect(toStage(r, 1, 1)).toEqual({ x: 500, y: 700 });
    expect(toStage(r, 0.5, 0.5)).toEqual({ x: 250, y: 450 });
  });
});

// ---------------------------------------------------------------------------

function pose(t: number, sx: number, px: number): ReplayPose {
  return {
    t,
    source: [[15, sx, sx, 0.9]],
    photo: [[15, px, px, 0.9]],
  };
}

const POSES: ReplayPose[] = [pose(0, 0, 0.5), pose(1, 0.2, 0.6), pose(3, 0.6, 0.8)];

describe("sampleReplayPose", () => {
  it("returns null with nothing to sample", () => {
    expect(sampleReplayPose([], 0)).toBeNull();
  });

  it("samples by elapsed time, not by index", () => {
    const half = sampleReplayPose(POSES, 0.5)!;
    expect(half.source.left_wrist.x).toBeCloseTo(0.1, 6);
    expect(half.photo.left_wrist.x).toBeCloseTo(0.55, 6);

    // Half way between samples 1 and 3 in *time* is t = 2, not the midpoint of
    // the sample list — uneven spacing must not warp the playback rate.
    const two = sampleReplayPose(POSES, 2)!;
    expect(two.source.left_wrist.x).toBeCloseTo(0.4, 6);
    expect(two.photo.left_wrist.x).toBeCloseTo(0.7, 6);
  });

  it("blends both coordinate spaces with the same factor", () => {
    const a = sampleReplayPose(POSES, 0.25)!;
    const sourceAlpha = (a.source.left_wrist.x - 0) / 0.2;
    const photoAlpha = (a.photo.left_wrist.x - 0.5) / 0.1;
    expect(sourceAlpha).toBeCloseTo(photoAlpha, 6);
  });

  it("clamps outside the clip instead of wrapping", () => {
    expect(sampleReplayPose(POSES, -5)!.source.left_wrist.x).toBe(0);
    expect(sampleReplayPose(POSES, 99)!.source.left_wrist.x).toBe(0.6);
  });

  it("carries confidence through for Estimated-Landmark dimming", () => {
    expect(sampleReplayPose(POSES, 0.5)!.source.left_wrist.score).toBeCloseTo(0.9, 6);
  });

  it("advances monotonically as the clock does", () => {
    let prev = -Infinity;
    for (let t = 0; t <= 3; t += 0.1) {
      const x = sampleReplayPose(POSES, t)!.source.left_wrist.x;
      expect(x).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = x;
    }
  });
});

describe("morphKeypoints", () => {
  const source = { left_wrist: { x: 0, y: 0 } };
  const photo = { left_wrist: { x: 100, y: 200 } };

  it("returns each space untouched at the ends of the morph", () => {
    expect(morphKeypoints(source, photo, 0)).toBe(source);
    expect(morphKeypoints(source, photo, 1)).toBe(photo);
  });

  it("interpolates between the two baked spaces in between", () => {
    const mid = morphKeypoints(source, photo, 0.25);
    expect(mid.left_wrist.x).toBeCloseTo(25, 6);
    expect(mid.left_wrist.y).toBeCloseTo(50, 6);
  });
});
