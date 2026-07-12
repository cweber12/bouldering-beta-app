import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import type { VideoMeta, OrbFeatures, OrbMatch } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Module mocks — isolate from real OpenCV / homography
// ---------------------------------------------------------------------------

vi.mock("@/pipeline/matching/homography", () => ({
  computeHomography: vi.fn(),
  homographyAtTime: vi.fn(() => new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1])),
}));

vi.mock("@/pipeline/overlay/skeletonOverlay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pipeline/overlay/skeletonOverlay")>();
  return {
    ...actual,
    buildTransformedKeypoints: vi.fn(),
  };
});

import { computeHomography, homographyAtTime } from "@/pipeline/matching/homography";
import { buildTransformedKeypoints } from "@/pipeline/overlay/skeletonOverlay";

import {
  buildSkeletonFrames,
  buildMultiSkeletonFrames,
  buildPanningSkeletonFrames,
} from "@/pipeline/overlay/skeletonRenderer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockCv = {};

function makeKeypoint(name: string, x: number, y: number, score = 0.9) {
  return { name, x, y, score };
}

function makePoseFrame(ts: number, nKp = 3): PoseFrame {
  return {
    timestamp: ts,
    keypoints: Array.from({ length: nKp }, (_, i) =>
      makeKeypoint(`kp_${i}`, 0.1 * i, 0.2 * i, 0.9),
    ),
  };
}

const videoMeta: VideoMeta = { width: 640, height: 480, duration: 2, name: "test.mp4", fps: 30 };

function fakeOrbFeatures(): OrbFeatures {
  return {
    keypoints: [],
    descriptors: new Uint8Array(0),
  };
}

function fakeMatches(n: number): OrbMatch[] {
  return Array.from({ length: n }, (_, i) => ({
    queryIdx: i,
    trainIdx: i,
    distance: 10,
  }));
}

/** Fake homography matrix returned by mock (flat 9-element Float64Array). */
const FAKE_H = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(computeHomography).mockReturnValue(FAKE_H);
  vi.mocked(buildTransformedKeypoints).mockImplementation((frame) => {
    const kp: Record<string, { x: number; y: number }> = {};
    for (const k of frame.keypoints) {
      kp[k.name] = { x: k.x * 640, y: k.y * 480 };
    }
    return kp;
  });
});

// ---------------------------------------------------------------------------
// buildSkeletonFrames
// ---------------------------------------------------------------------------

describe("buildSkeletonFrames", () => {
  it("produces the expected number of output frames", () => {
    const frames = [makePoseFrame(0), makePoseFrame(0.5), makePoseFrame(1)];
    const result = buildSkeletonFrames({
      frames,
      videoMeta,
      homography: FAKE_H,
      targetFps: 10,
    });

    // duration = 1s, fps = 10 → ceil(1*10)+1 = 11 frames
    expect(result.frames).toHaveLength(11);
    expect(result.duration).toBe(1);
    expect(result.fps).toBe(10);
  });

  it("timestamps are 0-based and monotonically increasing", () => {
    const frames = [makePoseFrame(5), makePoseFrame(5.5), makePoseFrame(6)];
    const result = buildSkeletonFrames({
      frames,
      videoMeta,
      homography: FAKE_H,
      targetFps: 10,
    });

    expect(result.frames[0].timestamp).toBe(0);
    for (let i = 1; i < result.frames.length; i++) {
      expect(result.frames[i].timestamp).toBeGreaterThan(result.frames[i - 1].timestamp);
    }
  });

  it("renders through the supplied homography without recomputing one", () => {
    buildSkeletonFrames({
      frames: [makePoseFrame(0)],
      videoMeta,
      homography: FAKE_H,
    });

    // The gated homography comes from the matcher — the renderer must not
    // re-derive one from matches.
    expect(computeHomography).not.toHaveBeenCalled();
    expect(buildTransformedKeypoints).toHaveBeenCalledWith(
      expect.anything(),
      FAKE_H,
      videoMeta.width,
      videoMeta.height,
    );
  });

  it("produces empty keypoints for frames with no keypoints", () => {
    const emptyFrame: PoseFrame = { timestamp: 0, keypoints: [] };
    const result = buildSkeletonFrames({
      frames: [emptyFrame],
      videoMeta,
      homography: FAKE_H,
    });

    expect(Object.keys(result.frames[0].keypoints)).toHaveLength(0);
    expect(buildTransformedKeypoints).not.toHaveBeenCalled();
  });

  it("defaults to 60 fps when targetFps is omitted", () => {
    const result = buildSkeletonFrames({
      frames: [makePoseFrame(0), makePoseFrame(1)],
      videoMeta,
      homography: FAKE_H,
    });

    expect(result.fps).toBe(60);
    // 1s at 60fps → ceil(60)+1 = 61 frames
    expect(result.frames).toHaveLength(61);
  });
});

// ---------------------------------------------------------------------------
// buildMultiSkeletonFrames
// ---------------------------------------------------------------------------

describe("buildMultiSkeletonFrames", () => {
  it("unifies timelines across layers", () => {
    const layer0 = {
      frames: [makePoseFrame(0), makePoseFrame(1)],
      videoMeta,
      orbFeatures: fakeOrbFeatures(),
      queryOrb: fakeOrbFeatures(),
      matches: fakeMatches(10),
    };
    const layer1 = {
      frames: [makePoseFrame(0.5), makePoseFrame(2)],
      videoMeta,
      orbFeatures: fakeOrbFeatures(),
      queryOrb: fakeOrbFeatures(),
      matches: fakeMatches(10),
    };

    const result = buildMultiSkeletonFrames({
      cv: mockCv,
      layers: [layer0, layer1],
      targetFps: 10,
    });

    // Timeline: 0…2s → duration = 2, 10fps → ceil(20)+1 = 21 frames
    expect(result.layers).toHaveLength(2);
    expect(result.duration).toBe(2);
    expect(result.layers[0].frames).toHaveLength(21);
    expect(result.layers[1].frames).toHaveLength(21);
  });

  it("throws when layers array is empty", () => {
    expect(() => buildMultiSkeletonFrames({ cv: mockCv, layers: [], targetFps: 10 })).toThrow(
      /at least one layer/i,
    );
  });

  it("throws when any layer has insufficient matches", () => {
    vi.mocked(computeHomography)
      .mockReturnValueOnce(FAKE_H) // layer 0 OK
      .mockReturnValueOnce(null); // layer 1 fails

    expect(() =>
      buildMultiSkeletonFrames({
        cv: mockCv,
        layers: [
          {
            frames: [makePoseFrame(0)],
            videoMeta,
            orbFeatures: fakeOrbFeatures(),
            queryOrb: fakeOrbFeatures(),
            matches: fakeMatches(10),
          },
          {
            frames: [makePoseFrame(0)],
            videoMeta,
            orbFeatures: fakeOrbFeatures(),
            queryOrb: fakeOrbFeatures(),
            matches: fakeMatches(2),
          },
        ],
      }),
    ).toThrow(/Layer 1/);
  });

  it("handles layers with empty frame arrays", () => {
    const result = buildMultiSkeletonFrames({
      cv: mockCv,
      layers: [
        {
          frames: [makePoseFrame(0), makePoseFrame(1)],
          videoMeta,
          orbFeatures: fakeOrbFeatures(),
          queryOrb: fakeOrbFeatures(),
          matches: fakeMatches(10),
        },
        {
          frames: [],
          videoMeta,
          orbFeatures: fakeOrbFeatures(),
          queryOrb: fakeOrbFeatures(),
          matches: fakeMatches(10),
        },
      ],
      targetFps: 10,
    });

    // Layer 1 should have blank frames throughout the timeline.
    for (const f of result.layers[1].frames) {
      expect(Object.keys(f.keypoints)).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// buildPanningSkeletonFrames
// ---------------------------------------------------------------------------

describe("buildPanningSkeletonFrames", () => {
  const kfHomographies = [
    { timestamp: 0, h: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) },
    { timestamp: 1, h: new Float64Array([1, 0, 50, 0, 1, 0, 0, 0, 1]) },
  ];

  it("throws when no keyframe homographies are supplied", () => {
    expect(() =>
      buildPanningSkeletonFrames({
        frames: [makePoseFrame(0)],
        videoMeta,
        keyframeHomographies: [],
      }),
    ).toThrow(/keyframe/i);
  });

  it("produces the expected number of output frames", () => {
    const result = buildPanningSkeletonFrames({
      frames: [makePoseFrame(0), makePoseFrame(0.5), makePoseFrame(1)],
      videoMeta,
      keyframeHomographies: kfHomographies,
      targetFps: 10,
    });
    // duration 1s @ 10fps → 11 frames
    expect(result.frames).toHaveLength(11);
    expect(result.fps).toBe(10);
  });

  it("resolves a time-varying homography per output frame", () => {
    buildPanningSkeletonFrames({
      frames: [makePoseFrame(0), makePoseFrame(1)],
      videoMeta,
      keyframeHomographies: kfHomographies,
      targetFps: 10,
    });
    // homographyAtTime is consulted once per non-blank output frame.
    expect(homographyAtTime).toHaveBeenCalled();
    // It is always passed the sorted keyframe list.
    expect(vi.mocked(homographyAtTime).mock.calls[0][0]).toHaveLength(2);
  });

  it("emits blank keypoints for frames with no pose keypoints", () => {
    const result = buildPanningSkeletonFrames({
      frames: [{ timestamp: 0, keypoints: [] }],
      videoMeta,
      keyframeHomographies: kfHomographies,
      targetFps: 10,
    });
    expect(Object.keys(result.frames[0].keypoints)).toHaveLength(0);
    expect(buildTransformedKeypoints).not.toHaveBeenCalled();
  });
});
