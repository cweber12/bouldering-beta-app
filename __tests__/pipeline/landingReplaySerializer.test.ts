import { describe, it, expect } from "vitest";
import {
  buildLandingReplayItem,
  buildLandingReplayFile,
  type AuthoredHold,
  type BuildLandingReplayItemParams,
} from "@/pipeline/overlay/landingReplaySerializer";
import {
  isReplayItem,
  LANDING_REPLAY_VERSION,
  REPLAY_CAPTURE_SECONDS,
} from "@/pipeline/overlay/landingReplayItem";
import { MP_KP } from "@/utils/poseConstants";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import type { OrbFeatures } from "@/pipeline/matching/orbDetector";

// ---------------------------------------------------------------------------
// Fixtures — a 200×400 source video matched onto a 100×200 photo. The projector
// is a plain half-scale map so every expected photo coordinate is hand-checkable.
// ---------------------------------------------------------------------------

const SOURCE = { w: 200, h: 400 };
const PHOTO = { w: 100, h: 200, webp: "data:image/webp;base64,AAAA" };

function orbFeatures(points: Array<{ x: number; y: number }>): OrbFeatures {
  return {
    keypoints: points.map((pt) => ({ pt, size: 1, angle: 0, response: 0, octave: 0 })),
    descriptors: null,
  } as unknown as OrbFeatures;
}

function frame(timestamp: number, x = 0.5, y = 0.25, score = 0.9): PoseFrame {
  return { timestamp, keypoints: [{ name: "left_wrist", x, y, score }] };
}

function params(
  overrides: Partial<BuildLandingReplayItemParams> = {},
): BuildLandingReplayItemParams {
  return {
    id: "run-1750000000-boulder-problem",
    label: { area: "Chaos Canyon", route: "Boulder Problem", rating: "V4" },
    source: SOURCE,
    photo: PHOTO,
    refFeatures: orbFeatures([
      { x: 20, y: 40 },
      { x: 100, y: 200 },
    ]),
    queryFeatures: orbFeatures([
      { x: 10, y: 20 },
      { x: 50, y: 100 },
    ]),
    matches: [{ queryIdx: 1, trainIdx: 0, distance: 12 }],
    frames: [frame(10), frame(12), frame(18), frame(20)],
    windowStart: 10,
    // Half-scale: source pixels → photo pixels.
    project: (x, y) => ({ x: x / 2, y: y / 2 }),
    holds: [],
    ...overrides,
  };
}

describe("buildLandingReplayItem — output shape", () => {
  it("produces an item that satisfies the runtime guard", () => {
    expect(isReplayItem(buildLandingReplayItem(params()))).toBe(true);
  });

  it("carries the label, both dimension sets, and the embedded WebP", () => {
    const item = buildLandingReplayItem(params());
    expect(item.id).toBe("run-1750000000-boulder-problem");
    expect(item.label).toEqual({ area: "Chaos Canyon", route: "Boulder Problem", rating: "V4" });
    expect(item.source).toEqual({ w: 200, h: 400 });
    expect(item.photo).toEqual({ w: 100, h: 200, webp: "data:image/webp;base64,AAAA" });
  });

  it("gives every pose both coordinate spaces with matching landmark names", () => {
    const item = buildLandingReplayItem(params());
    for (const pose of item.poses) {
      expect(pose.source.map((k) => k[0])).toEqual(pose.photo.map((k) => k[0]));
      expect(pose.source).toHaveLength(1);
      expect(pose.photo).toHaveLength(1);
    }
  });

  it("carries the wall still when one is attached, and omits it when not", () => {
    expect(buildLandingReplayItem(params()).source).toEqual({ w: 200, h: 400 });
    expect("webp" in buildLandingReplayItem(params()).source).toBe(false);

    const withStill = buildLandingReplayItem(
      params({ source: { ...SOURCE, webp: "data:image/webp;base64,BBBB" } }),
    );
    expect(withStill.source).toEqual({
      w: 200,
      h: 400,
      webp: "data:image/webp;base64,BBBB",
    });
    // Both shapes are playable — the still is an enhancement, not a requirement.
    expect(isReplayItem(withStill)).toBe(true);
  });

  it("wraps items in the versioned envelope", () => {
    const item = buildLandingReplayItem(params());
    expect(buildLandingReplayFile([item])).toEqual({
      version: LANDING_REPLAY_VERSION,
      items: [item],
    });
  });
});

describe("buildLandingReplayItem — capture window and pose density", () => {
  /** A frame every 100ms, matching the stored Run track's cadence. */
  function track(from: number, to: number): PoseFrame[] {
    const frames: PoseFrame[] = [];
    for (let t = from; t <= to + 1e-9; t = Math.round((t + 0.1) * 1e3) / 1e3) {
      frames.push(frame(t));
    }
    return frames;
  }

  it("records the captured span, which is what sets the item's playback rate", () => {
    expect(buildLandingReplayItem(params()).duration).toBe(REPLAY_CAPTURE_SECONDS);
    expect(buildLandingReplayItem(params({ windowSeconds: 12 })).duration).toBe(12);
  });

  it("thins the 10Hz stored track to the export interval", () => {
    const item = buildLandingReplayItem(params({ frames: track(10, 24), windowStart: 10 }));
    // 14s at 10Hz is 141 frames; at the 0.2s export interval it is 71.
    expect(item.poses).toHaveLength(71);
    for (let i = 1; i < item.poses.length; i++) {
      expect(item.poses[i].t - item.poses[i - 1].t).toBeGreaterThanOrEqual(0.2 - 1e-9);
    }
  });

  it("still opens and closes the clip on real detections", () => {
    const item = buildLandingReplayItem(
      params({ frames: [frame(10), frame(10.05), frame(10.1), frame(10.15)], windowStart: 10 }),
    );
    expect(item.poses[0].t).toBe(0);
    expect(item.poses[item.poses.length - 1].t).toBe(0.15);
  });

  it("exports every stored frame when the interval is zero", () => {
    const item = buildLandingReplayItem(
      params({ frames: track(10, 11), windowStart: 10, poseIntervalSeconds: 0 }),
    );
    expect(item.poses).toHaveLength(11);
  });

  it("drops a landmark the topology cannot name, since nothing could draw it", () => {
    const odd: PoseFrame = {
      timestamp: 10,
      keypoints: [
        { name: "left_wrist", x: 0.5, y: 0.25, score: 0.9 },
        { name: "third_arm", x: 0.1, y: 0.1, score: 0.9 },
      ],
    };
    const item = buildLandingReplayItem(params({ frames: [odd], windowStart: 10 }));
    expect(item.poses[0].source).toEqual([[MP_KP.LEFT_WRIST, 0.5, 0.25, 0.9]]);
  });
});

describe("buildLandingReplayItem — coordinate normalization", () => {
  it("normalizes the starfield against the source dimensions", () => {
    const item = buildLandingReplayItem(params());
    expect(item.starfield).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.5 },
    ]);
  });

  it("pairs each match's source point (queryIdx) with its photo point (trainIdx)", () => {
    const item = buildLandingReplayItem(params());
    // queryIdx 1 → ref (100, 200) / (200, 400); trainIdx 0 → query (10, 20) / (100, 200).
    expect(item.matches).toEqual([{ sx: 0.5, sy: 0.5, px: 0.1, py: 0.1 }]);
  });

  it("drops matches whose keypoint index is out of range", () => {
    const item = buildLandingReplayItem(
      params({ matches: [{ queryIdx: 9, trainIdx: 0, distance: 1 }] }),
    );
    expect(item.matches).toEqual([]);
  });

  it("keeps source keypoints normalized and projects photo keypoints through `project`", () => {
    const item = buildLandingReplayItem(params({ frames: [frame(10, 0.5, 0.25)] }));
    // Landmarks encode as [index, x, y, score] — left_wrist is BlazePose 15.
    expect(item.poses[0].source[0]).toEqual([MP_KP.LEFT_WRIST, 0.5, 0.25, 0.9]);
    // (0.5·200, 0.25·400) = (100, 100) → half-scale (50, 50) → /(100, 200).
    expect(item.poses[0].photo[0]).toEqual([MP_KP.LEFT_WRIST, 0.5, 0.25, 0.9]);
  });

  it("normalizes photo coordinates against `photoSpace` when the WebP is downscaled", () => {
    const item = buildLandingReplayItem(
      params({
        photo: { w: 50, h: 100, webp: "data:image/webp;base64,AAAA" },
        photoSpace: { w: 100, h: 200 },
        frames: [frame(10, 0.5, 0.25)],
      }),
    );
    // Dimensions reported are the WebP's; coordinates measured in match space.
    expect(item.photo.w).toBe(50);
    expect(item.poses[0].photo[0][1]).toBe(0.5);
    expect(item.matches[0].px).toBe(0.1);
  });

  it("does not divide by zero when a dimension is missing", () => {
    const item = buildLandingReplayItem(params({ source: { w: 0, h: 0 } }));
    for (const point of item.starfield) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });
});

describe("buildLandingReplayItem — clip-relative rebasing", () => {
  it("keeps only frames inside the window and re-times them from zero", () => {
    const item = buildLandingReplayItem(
      params({ frames: [frame(8), frame(10), frame(14), frame(18), frame(19)], windowStart: 10 }),
    );
    // Default window is REPLAY_CAPTURE_SECONDS wide, so 8 is before it and 24 ends it.
    expect(item.poses.map((p) => p.t)).toEqual([0, 4, 8, 9]);
  });

  it("orders poses chronologically regardless of input order", () => {
    const item = buildLandingReplayItem(
      params({ frames: [frame(16), frame(10), frame(13)], windowStart: 10 }),
    );
    expect(item.poses.map((p) => p.t)).toEqual([0, 3, 6]);
  });

  it("honours a custom window length", () => {
    const item = buildLandingReplayItem(
      params({ frames: [frame(10), frame(12), frame(16)], windowStart: 10, windowSeconds: 4 }),
    );
    expect(item.poses.map((p) => p.t)).toEqual([0, 2]);
  });

  it("rebases Hold times to the window and drops Holds first used after it", () => {
    const holds: AuthoredHold[] = [
      { x: 10, y: 20, kind: "hand", side: "left", firstUseTime: 11.5 },
      { x: 30, y: 40, kind: "foot", side: "right", firstUseTime: 35 },
    ];
    const item = buildLandingReplayItem(params({ holds, windowStart: 10 }));
    expect(item.holds).toEqual([{ x: 0.1, y: 0.1, kind: "hand", side: "left", t: 1.5 }]);
  });

  it("reveals a Hold already in use at the window's start at t = 0", () => {
    const holds: AuthoredHold[] = [
      { x: 10, y: 20, kind: "hand", side: "right", firstUseTime: 2 },
    ];
    const item = buildLandingReplayItem(params({ holds, windowStart: 10 }));
    expect(item.holds[0].t).toBe(0);
  });

  it("sorts Holds by reveal time", () => {
    const holds: AuthoredHold[] = [
      { x: 10, y: 20, kind: "foot", side: "left", firstUseTime: 16 },
      { x: 30, y: 40, kind: "hand", side: "right", firstUseTime: 12 },
    ];
    const item = buildLandingReplayItem(params({ holds, windowStart: 10 }));
    expect(item.holds.map((h) => h.t)).toEqual([2, 6]);
  });
});

describe("buildLandingReplayItem — private-field exclusion", () => {
  /** Every key appearing anywhere in the serialized item. */
  function allKeys(value: unknown, acc = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
      for (const entry of value) allKeys(entry, acc);
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        acc.add(key);
        allKeys(child, acc);
      }
    }
    return acc;
  }

  it("emits no user identity, notes, coordinates, S3 key, descriptor, or matrix field", () => {
    const item = buildLandingReplayItem(
      params({
        holds: [{ x: 10, y: 20, kind: "hand", side: "left", firstUseTime: 11 }],
      }),
    );
    const keys = allKeys(item);
    for (const forbidden of [
      "userId",
      "uid",
      "notes",
      "coordinates",
      "key",
      "descriptors",
      "homography",
      "orbFeatures",
      "videoMeta",
      "videoHash",
      "thumbnail",
      "runType",
      "state",
      "frames",
      "matchesPerFrame",
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("exposes exactly the contract's top-level fields", () => {
    expect(Object.keys(buildLandingReplayItem(params())).sort()).toEqual([
      "duration",
      "holds",
      "id",
      "label",
      "matches",
      "photo",
      "poses",
      "source",
      "starfield",
    ]);
  });

  it("limits the label to area, route, and rating", () => {
    const item = buildLandingReplayItem(params());
    expect(Object.keys(item.label).sort()).toEqual(["area", "rating", "route"]);
  });
});
