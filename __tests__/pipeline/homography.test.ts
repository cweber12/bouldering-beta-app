import { describe, it, expect, vi } from "vitest";
import {
  applyHomographyMatrix,
  isValidHomography,
  ransacReprojThresholdFor,
  interpolateHomographies,
  homographyAtTime,
  computeHomography,
  RANSAC_BASE_THRESHOLD,
  RANSAC_RNG_SEED,
  type KeyframeHomography,
} from "@/pipeline/matching/homography";
import { emptyHomographyStats } from "@/pipeline/analysis/diagnostics";
import { buildTransformedKeypoints, drawSkeleton } from "@/pipeline/overlay/skeletonOverlay";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import type { OrbFeatures, OrbMatch } from "@/pipeline/matching/orbDetector";

// ---------------------------------------------------------------------------
// applyHomographyMatrix
// ---------------------------------------------------------------------------

describe("applyHomographyMatrix", () => {
  it("returns the input point unchanged for an identity matrix", () => {
    // prettier-ignore
    const I = new Float64Array([1, 0, 0,   0, 1, 0,   0, 0, 1]);
    const result = applyHomographyMatrix(I, 100, 200);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(200);
  });

  it("applies a pure translation", () => {
    // Translate by (+50, +30)
    // prettier-ignore
    const T = new Float64Array([1, 0, 50,   0, 1, 30,   0, 0, 1]);
    const result = applyHomographyMatrix(T, 10, 20);
    expect(result.x).toBeCloseTo(60);
    expect(result.y).toBeCloseTo(50);
  });

  it("applies a uniform scale", () => {
    // Scale by 2×
    // prettier-ignore
    const S = new Float64Array([2, 0, 0,   0, 2, 0,   0, 0, 1]);
    const result = applyHomographyMatrix(S, 5, 10);
    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(20);
  });

  it("performs perspective division when w ≠ 1", () => {
    // w-scale of 2 halves both coordinates.
    // prettier-ignore
    const P = new Float64Array([1, 0, 0,   0, 1, 0,   0, 0, 2]);
    const result = applyHomographyMatrix(P, 10, 20);
    expect(result.x).toBeCloseTo(5);
    expect(result.y).toBeCloseTo(10);
  });

  it("composes translation then scale correctly", () => {
    // Scale 2× then translate (+10, +5) — H = S·T is not tested here;
    // we test a specific combined matrix directly.
    // prettier-ignore
    const H = new Float64Array([2, 0, 10,   0, 2, 5,   0, 0, 1]);
    const result = applyHomographyMatrix(H, 3, 4);
    // x' = 2*3 + 10 = 16,  y' = 2*4 + 5 = 13,  w = 1
    expect(result.x).toBeCloseTo(16);
    expect(result.y).toBeCloseTo(13);
  });
});

// ---------------------------------------------------------------------------
// isValidHomography
// ---------------------------------------------------------------------------

describe("isValidHomography", () => {
  // prettier-ignore
  const IDENTITY = new Float64Array([1, 0, 0,   0, 1, 0,   0, 0, 1]);

  it("accepts the identity transform over a frame rectangle", () => {
    expect(isValidHomography(IDENTITY, 640, 480)).toBe(true);
  });

  it("accepts a translation + uniform scale", () => {
    // prettier-ignore
    const H = new Float64Array([1.5, 0, 100,   0, 1.5, 50,   0, 0, 1]);
    expect(isValidHomography(H, 640, 480)).toBe(true);
  });

  it("rejects a horizontal flip (negative determinant)", () => {
    // x -> -x maps the rectangle to negative-orientation winding.
    // prettier-ignore
    const FLIP = new Float64Array([-1, 0, 640,   0, 1, 0,   0, 0, 1]);
    expect(isValidHomography(FLIP, 640, 480)).toBe(false);
  });

  it("rejects a degenerate (collinear) transform", () => {
    // Collapses every point onto the x-axis — zero area.
    // prettier-ignore
    const DEGEN = new Float64Array([1, 0, 0,   0, 0, 0,   0, 0, 1]);
    expect(isValidHomography(DEGEN, 640, 480)).toBe(false);
  });

  it("rejects a transform that scales beyond the bounds", () => {
    // 0.001× linear scale — far below the default minScale.
    // prettier-ignore
    const TINY = new Float64Array([0.001, 0, 0,   0, 0.001, 0,   0, 0, 1]);
    expect(isValidHomography(TINY, 640, 480)).toBe(false);
  });

  it("respects custom scale bounds", () => {
    // prettier-ignore
    const H = new Float64Array([3, 0, 0,   0, 3, 0,   0, 0, 1]);
    expect(isValidHomography(H, 640, 480, { maxScale: 2 })).toBe(false);
    expect(isValidHomography(H, 640, 480, { maxScale: 5 })).toBe(true);
  });

  it("rejects matrices with non-finite entries", () => {
    const NAN = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, NaN]);
    expect(isValidHomography(NAN, 640, 480)).toBe(false);
  });

  it("rejects non-positive source dimensions", () => {
    expect(isValidHomography(IDENTITY, 0, 480)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ransacReprojThresholdFor
// ---------------------------------------------------------------------------

describe("ransacReprojThresholdFor", () => {
  it("returns the baseline threshold at the calibration resolution", () => {
    expect(ransacReprojThresholdFor(1600)).toBeCloseTo(RANSAC_BASE_THRESHOLD);
  });

  it("scales up with resolution, clamped to 8px", () => {
    expect(ransacReprojThresholdFor(3200)).toBeCloseTo(6);
    expect(ransacReprojThresholdFor(100000)).toBe(8);
  });

  it("clamps small resolutions to the 2px floor", () => {
    expect(ransacReprojThresholdFor(400)).toBe(2);
  });

  it("falls back to the baseline for non-positive input", () => {
    expect(ransacReprojThresholdFor(0)).toBe(RANSAC_BASE_THRESHOLD);
  });
});

// ---------------------------------------------------------------------------
// interpolateHomographies
// ---------------------------------------------------------------------------

describe("interpolateHomographies", () => {
  // prettier-ignore
  const T0 = new Float64Array([1, 0, 0,    0, 1, 0,    0, 0, 1]);
  // prettier-ignore
  const T100 = new Float64Array([1, 0, 100, 0, 1, 200,  0, 0, 1]);

  it("reproduces the endpoints exactly at alpha 0 and 1", () => {
    expect(Array.from(interpolateHomographies(T0, T100, 0))).toEqual(Array.from(T0));
    expect(Array.from(interpolateHomographies(T0, T100, 1))).toEqual(Array.from(T100));
  });

  it("clamps alpha outside [0, 1] to the endpoints", () => {
    expect(Array.from(interpolateHomographies(T0, T100, -5))).toEqual(Array.from(T0));
    expect(Array.from(interpolateHomographies(T0, T100, 9))).toEqual(Array.from(T100));
  });

  it("blends a pure translation linearly at the midpoint", () => {
    const mid = interpolateHomographies(T0, T100, 0.5);
    const p = applyHomographyMatrix(mid, 0, 0);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(100);
  });

  it("interpolates a uniform scale (linear in scale)", () => {
    // prettier-ignore
    const S1 = new Float64Array([1, 0, 0,   0, 1, 0,   0, 0, 1]);
    // prettier-ignore
    const S3 = new Float64Array([3, 0, 0,   0, 3, 0,   0, 0, 1]);
    const mid = interpolateHomographies(S1, S3, 0.5);
    const p = applyHomographyMatrix(mid, 10, 10);
    // scale halfway between 1 and 3 = 2×
    expect(p.x).toBeCloseTo(20);
    expect(p.y).toBeCloseTo(20);
  });

  it("slerps rotation along the shortest arc", () => {
    const rot = (deg: number): Float64Array => {
      const r = (deg * Math.PI) / 180;
      // prettier-ignore
      return new Float64Array([Math.cos(r), -Math.sin(r), 0,   Math.sin(r), Math.cos(r), 0,   0, 0, 1]);
    };
    const mid = interpolateHomographies(rot(0), rot(90), 0.5);
    // A point on the +x axis should land at 45°.
    const p = applyHomographyMatrix(mid, 1, 0);
    expect(p.x).toBeCloseTo(Math.cos(Math.PI / 4));
    expect(p.y).toBeCloseTo(Math.sin(Math.PI / 4));
  });
});

// ---------------------------------------------------------------------------
// homographyAtTime
// ---------------------------------------------------------------------------

describe("homographyAtTime", () => {
  const kf = (timestamp: number, tx: number): KeyframeHomography => ({
    timestamp,
    // prettier-ignore
    h: new Float64Array([1, 0, tx, 0, 1, 0, 0, 0, 1]),
  });

  it("throws when no keyframes are supplied", () => {
    expect(() => homographyAtTime([], 0)).toThrow();
  });

  it("returns the single keyframe regardless of time", () => {
    const only = kf(5, 42);
    expect(homographyAtTime([only], 0)).toBe(only.h);
    expect(homographyAtTime([only], 99)).toBe(only.h);
  });

  it("clamps before the first and after the last keyframe", () => {
    const a = kf(1, 10);
    const b = kf(3, 30);
    expect(homographyAtTime([a, b], 0)).toBe(a.h);
    expect(homographyAtTime([a, b], 5)).toBe(b.h);
  });

  it("interpolates between the bracketing keyframes by time fraction", () => {
    const a = kf(1, 0);
    const b = kf(3, 100);
    // t = 2 is halfway between 1 and 3 → tx 50.
    const mid = homographyAtTime([a, b], 2);
    expect(applyHomographyMatrix(mid, 0, 0).x).toBeCloseTo(50);
  });

  it("selects the correct pair across three keyframes", () => {
    const a = kf(0, 0);
    const b = kf(2, 20);
    const c = kf(4, 100);
    // t = 3 is halfway between b(20) and c(100) → 60.
    const mid = homographyAtTime([a, b, c], 3);
    expect(applyHomographyMatrix(mid, 0, 0).x).toBeCloseTo(60);
  });
});

// ---------------------------------------------------------------------------
// buildTransformedKeypoints
// ---------------------------------------------------------------------------

describe("buildTransformedKeypoints", () => {
  // prettier-ignore
  const IDENTITY = new Float64Array([1, 0, 0,   0, 1, 0,   0, 0, 1]);

  it("maps normalized coordinates to pixel coordinates under identity H", () => {
    const frame: PoseFrame = {
      timestamp: 0,
      keypoints: [
        { name: "nose", x: 0.5, y: 0.25, score: 0.9 },
        { name: "left_shoulder", x: 0.3, y: 0.4, score: 0.8 },
      ],
    };

    const result = buildTransformedKeypoints(frame, IDENTITY, 640, 480);

    // nose: x = 0.5*640 = 320, y = 0.25*480 = 120
    expect(result["nose"].x).toBeCloseTo(320);
    expect(result["nose"].y).toBeCloseTo(120);

    // left_shoulder: x = 0.3*640 = 192, y = 0.4*480 = 192
    expect(result["left_shoulder"].x).toBeCloseTo(192);
    expect(result["left_shoulder"].y).toBeCloseTo(192);
  });

  it("returns an empty object for a frame with no keypoints", () => {
    const frame: PoseFrame = { timestamp: 0, keypoints: [] };
    const result = buildTransformedKeypoints(frame, IDENTITY, 640, 480);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("applies a translation homography to mapped pixel coordinates", () => {
    // Translate by (+100, +50)
    // prettier-ignore
    const T = new Float64Array([1, 0, 100,  0, 1, 50,  0, 0, 1]);
    const frame: PoseFrame = {
      timestamp: 0,
      keypoints: [{ name: "nose", x: 0.5, y: 0.5, score: 0.95 }],
    };

    const result = buildTransformedKeypoints(frame, T, 640, 480);
    // pixel before H: (320, 240) → after translation: (420, 290)
    expect(result["nose"].x).toBeCloseTo(420);
    expect(result["nose"].y).toBeCloseTo(290);
  });

  it("uses keypoint names as map keys", () => {
    const frame: PoseFrame = {
      timestamp: 0,
      keypoints: [
        { name: "left_wrist", x: 0.1, y: 0.2, score: 0.7 },
        { name: "right_wrist", x: 0.9, y: 0.8, score: 0.7 },
      ],
    };

    const result = buildTransformedKeypoints(frame, IDENTITY, 100, 100);
    expect(Object.keys(result)).toEqual(expect.arrayContaining(["left_wrist", "right_wrist"]));
    expect(Object.keys(result)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// drawSkeleton
// ---------------------------------------------------------------------------

function makeFakeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
    lineCap: "",
    // The renderer reads canvas dimensions to derive the proportional body
    // scale; the Silhouette pass needs a real offscreen 2D context (null in
    // jsdom) so it is skipped here and only the Skeleton pass draws.
    canvas: { width: 100, height: 100 },
  } as unknown as CanvasRenderingContext2D;
}

describe("drawSkeleton", () => {
  it("draws limbs for connected keypoint pairs", () => {
    const ctx = makeFakeCtx();
    // Body edges (face edges are intentionally dropped — the head oval replaces
    // them). left_shoulder → left_elbow → left_wrist share direct edges.
    const keypoints = {
      left_shoulder: { x: 50, y: 50 },
      left_elbow: { x: 60, y: 70 },
      left_wrist: { x: 65, y: 90 },
    };

    drawSkeleton(ctx, keypoints);

    // stroke() should be called at least once for the shoulder↔elbow↔wrist edges.
    expect(ctx.stroke).toHaveBeenCalled();
    // fill() is called once per keypoint for the joint circles.
    expect(ctx.fill).toHaveBeenCalledTimes(3);
  });

  it("skips edges where a keypoint is missing", () => {
    const ctx = makeFakeCtx();
    // Provide only two keypoints — most edges will have missing endpoints.
    const keypoints = {
      nose: { x: 100, y: 100 },
      left_eye: { x: 90, y: 90 },
    };

    // Should not throw even with many missing edge endpoints.
    expect(() => drawSkeleton(ctx, keypoints)).not.toThrow();
    // Only 2 joint circles drawn.
    expect(ctx.fill).toHaveBeenCalledTimes(2);
  });

  it("calls save and restore to isolate canvas state", () => {
    const ctx = makeFakeCtx();
    drawSkeleton(ctx, {});
    expect(ctx.save).toHaveBeenCalledOnce();
    expect(ctx.restore).toHaveBeenCalledOnce();
  });

  it("draws nothing for an empty keypoints map", () => {
    const ctx = makeFakeCtx();
    drawSkeleton(ctx, {});
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it("dims a low-confidence Estimated Landmark joint", () => {
    // Record the globalAlpha in effect at each joint fill.
    const alphasByFill: number[] = [];
    const ctx = makeFakeCtx();
    (ctx.fill as ReturnType<typeof vi.fn>).mockImplementation(() => {
      alphasByFill.push(ctx.globalAlpha);
    });
    drawSkeleton(ctx, {
      nose: { x: 50, y: 50, score: 0.9 }, // confident → full alpha
      left_eye_inner: { x: 40, y: 40, score: 0.1 }, // estimated → dimmed
    });
    expect(alphasByFill).toContain(1);
    // The low-confidence joint is drawn at reduced opacity.
    expect(alphasByFill.some((a) => a < 1)).toBe(true);
  });

  it("never dims keypoints that carry no score (legacy callers)", () => {
    const alphasByFill: number[] = [];
    const ctx = makeFakeCtx();
    (ctx.fill as ReturnType<typeof vi.fn>).mockImplementation(() => {
      alphasByFill.push(ctx.globalAlpha);
    });
    drawSkeleton(ctx, { nose: { x: 50, y: 50 }, left_eye_inner: { x: 40, y: 40 } });
    expect(alphasByFill.every((a) => a === 1)).toBe(true);
  });

  it("estimatedDimThreshold: 0 disables confidence dimming", () => {
    const alphasByFill: number[] = [];
    const ctx = makeFakeCtx();
    (ctx.fill as ReturnType<typeof vi.fn>).mockImplementation(() => {
      alphasByFill.push(ctx.globalAlpha);
    });
    drawSkeleton(ctx, { nose: { x: 50, y: 50, score: 0.01 } }, { estimatedDimThreshold: 0 });
    expect(alphasByFill.every((a) => a === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeHomography — stats out-param (OpenCV mocked at the cv boundary)
// ---------------------------------------------------------------------------

describe("computeHomography stats out-param", () => {
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const DEGENERATE = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  interface FakeMat {
    empty: () => boolean;
    delete: () => void;
    data64F?: Float64Array;
  }

  function makeFeatures(n: number): OrbFeatures {
    return {
      keypoints: Array.from({ length: n }, (_, i) => ({
        pt: { x: i * 10, y: i * 7 },
        size: 1,
        angle: 0,
        response: 0,
        octave: 0,
      })),
      descriptors: new Uint8Array(0),
    };
  }

  function makeMatches(n: number): OrbMatch[] {
    return Array.from({ length: n }, (_, i) => ({ queryIdx: i, trainIdx: i, distance: 10 }));
  }

  function makeCv(opts: { homography: number[] | "empty" | null; inliers: number }) {
    const makeH = (): FakeMat | null => {
      if (opts.homography === null) return null;
      if (opts.homography === "empty") return { empty: () => true, delete: vi.fn() };
      return { empty: () => false, data64F: new Float64Array(opts.homography), delete: vi.fn() };
    };
    return {
      CV_32FC2: 0,
      RANSAC: 8,
      matFromArray: vi.fn((): FakeMat => ({ empty: () => false, delete: vi.fn() })),
      Mat: vi.fn(function (this: unknown): FakeMat {
        return { empty: () => false, delete: vi.fn() };
      }),
      findHomography: vi.fn(makeH),
      countNonZero: vi.fn(() => opts.inliers),
      setRNGSeed: vi.fn(),
    };
  }

  it("labels too_few_matches before touching OpenCV", () => {
    const cv = makeCv({ homography: IDENTITY, inliers: 0 });
    const stats = emptyHomographyStats();
    const result = computeHomography(cv, makeMatches(3), makeFeatures(3), makeFeatures(3), {
      stats,
    });

    expect(result).toBeNull();
    expect(cv.findHomography).not.toHaveBeenCalled();
    expect(stats).toMatchObject({
      matchCount: 3,
      inlierCount: 0,
      inlierRatio: 0,
      homographyFound: false,
      failureReason: "too_few_matches",
    });
  });

  it("labels a null homography as degenerate", () => {
    const cv = makeCv({ homography: null, inliers: 0 });
    const stats = emptyHomographyStats();
    const result = computeHomography(cv, makeMatches(8), makeFeatures(8), makeFeatures(8), {
      stats,
    });

    expect(result).toBeNull();
    expect(stats.failureReason).toBe("degenerate");
    expect(stats.homographyFound).toBe(false);
    expect(stats.matchCount).toBe(8);
  });

  it("labels an empty homography as degenerate", () => {
    const cv = makeCv({ homography: "empty", inliers: 0 });
    const stats = emptyHomographyStats();
    computeHomography(cv, makeMatches(8), makeFeatures(8), makeFeatures(8), { stats });
    expect(stats.failureReason).toBe("degenerate");
  });

  it("labels a gate-failing homography as gate_rejected and still reports inliers", () => {
    const cv = makeCv({ homography: DEGENERATE, inliers: 5 });
    const stats = emptyHomographyStats();
    const result = computeHomography(cv, makeMatches(10), makeFeatures(10), makeFeatures(10), {
      gate: { srcWidth: 640, srcHeight: 480 },
      stats,
    });

    expect(result).toBeNull();
    expect(stats).toMatchObject({
      matchCount: 10,
      inlierCount: 5,
      inlierRatio: 0.5,
      homographyFound: false,
      failureReason: "gate_rejected",
    });
  });

  it("labels a valid homography ok with the inlier ratio", () => {
    const cv = makeCv({ homography: IDENTITY, inliers: 8 });
    const stats = emptyHomographyStats();
    const result = computeHomography(cv, makeMatches(10), makeFeatures(10), makeFeatures(10), {
      gate: { srcWidth: 640, srcHeight: 480 },
      stats,
    });

    expect(result).toBeInstanceOf(Float64Array);
    expect(stats).toMatchObject({
      matchCount: 10,
      inlierCount: 8,
      inlierRatio: 0.8,
      homographyFound: true,
      failureReason: "ok",
    });
    // The inlier mask is passed as the 5th arg to findHomography.
    expect(cv.findHomography.mock.calls[0]).toHaveLength(5);
  });

  it("works for existing callers that pass no stats (no signature break)", () => {
    const cv = makeCv({ homography: IDENTITY, inliers: 8 });
    const result = computeHomography(cv, makeMatches(10), makeFeatures(10), makeFeatures(10));
    expect(result).toBeInstanceOf(Float64Array);
  });

  it("seeds the RNG with a fixed value before findHomography for deterministic RANSAC", () => {
    const cv = makeCv({ homography: IDENTITY, inliers: 8 });
    computeHomography(cv, makeMatches(10), makeFeatures(10), makeFeatures(10));

    expect(cv.setRNGSeed).toHaveBeenCalledWith(RANSAC_RNG_SEED);
    // Seeding must precede the RANSAC estimate, or it has no effect.
    expect(cv.setRNGSeed.mock.invocationCallOrder[0]).toBeLessThan(
      cv.findHomography.mock.invocationCallOrder[0],
    );
  });
});
