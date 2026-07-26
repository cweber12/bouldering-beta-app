import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — MediaPipe, OpenCV, and the seek loop's I/O are stubbed at the
// module boundary so the processor tests exercise attempt classification and
// evidence only.
// ---------------------------------------------------------------------------

vi.mock("@/pipeline/pose/mediapipePoseDetection", () => ({
  estimateFramesMediaPipe: vi.fn(() => []),
}));

vi.mock("@/pipeline/analysis/frameAnalyzer", () => ({
  analyzeFrame: vi.fn(() => ({
    overall: { brightness: 0.5, contrast: 0.5, sharpness: 0.5 },
    climber: null,
    wall: null,
    isOverexposed: false,
    isUnderexposed: false,
    isBacklit: false,
    isLowContrast: false,
    isBlurry: false,
  })),
}));

vi.mock("@/pipeline/analysis/framePreprocessor", () => ({
  applyOrbPreprocessing: vi.fn(),
}));

vi.mock("@/pipeline/matching/orbDetector", () => ({
  extractFeatures: vi.fn(() => ({ keypoints: [], descriptors: null })),
  extractFeaturesExcludingClimber: vi.fn(() => ({ keypoints: [], descriptors: null })),
}));

vi.mock("@/pipeline/matching/orbThumbnail", () => ({
  generateOrbThumbnail: vi.fn(() => undefined),
}));

vi.mock("@/pipeline/holds/holdDetection", () => ({
  detectHoldsVideoSpace: vi.fn(() => []),
}));

vi.mock("@/utils/cvHelpers", () => ({
  cropImageData: vi.fn((src: ImageData) => src),
}));

vi.mock("@/utils/colorBalance", () => ({
  neutralizeColorCast: vi.fn(() => false),
}));

vi.mock("@/storage/sessionStore", () => ({
  saveAttempt: vi.fn(),
}));

vi.mock("@/utils/videoSeek", () => {
  class SeekAbortedError extends Error {}
  class SeekTimeoutError extends Error {}
  return {
    SeekAbortedError,
    SeekTimeoutError,
    seekVideo: vi.fn(async (video: { currentTime: number }, time: number) => {
      video.currentTime = time;
    }),
  };
});

import {
  bestUnselectedCandidateScore,
  deriveMissReason,
  finalizeDetectorAttempts,
  mergeBestUnselectedScore,
  normalizeDetectorAttemptRegion,
  ORB_PREVIEW_UPDATE_INTERVAL_SEC,
  shouldEmitOrbPreview,
  tagFlipDiscardedFrames,
  useVideoProcessor,
} from "@/hooks/useVideoProcessor";
import { estimateFramesMediaPipe } from "@/pipeline/pose/mediapipePoseDetection";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import type { AcceptedDetectorAttempt, DetectorAttempt } from "@/utils/harnessPayloads";

describe("useVideoProcessor ORB preview cadence", () => {
  it("emits immediately for the first preview", () => {
    expect(shouldEmitOrbPreview(0, -Infinity)).toBe(true);
    expect(shouldEmitOrbPreview(0, -1)).toBe(true);
  });

  it("throttles emits until the configured interval elapses", () => {
    const last = 10;
    expect(shouldEmitOrbPreview(last + ORB_PREVIEW_UPDATE_INTERVAL_SEC - 0.01, last)).toBe(false);
    expect(shouldEmitOrbPreview(last + ORB_PREVIEW_UPDATE_INTERVAL_SEC, last)).toBe(true);
  });
});

describe("tagFlipDiscardedFrames", () => {
  it("marks inferred frames at discarded flip timestamps", () => {
    const frames: PoseFrame[] = [
      { timestamp: 0, source: "raw", keypoints: [] },
      { timestamp: 0.5, source: "interpolated", keypoints: [] },
      { timestamp: 1, source: "filled", keypoints: [] },
    ];

    const result = tagFlipDiscardedFrames([...frames], [0.5, 1]);

    expect(result.map((frame) => frame.source)).toEqual(["raw", "flipDiscarded", "flipDiscarded"]);
  });

  it("keeps accepted detector frames raw even when the timestamp was re-probed", () => {
    const frames: PoseFrame[] = [
      { timestamp: 0.5, source: "raw", keypoints: [] },
      { timestamp: 1, source: "limbExpanded", keypoints: [] },
    ];

    const result = tagFlipDiscardedFrames([...frames], [0.5, 1]);

    expect(result.map((frame) => frame.source)).toEqual(["raw", "limbExpanded"]);
  });
});

describe("detector attempt helpers", () => {
  const keypoints = [{ name: "nose", x: 0.5, y: 0.25, score: 0.9 }];

  const acceptedAttempt = (timestamp: number): AcceptedDetectorAttempt => ({
    timestamp,
    status: "accepted",
    initialSearchRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    detectionRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    reacquireAttempted: false,
    reacquired: false,
    reacquireSteps: [],
    bestUnselectedCandidateScore: null,
    rawKeypoints: keypoints,
    acceptedKeypoints: keypoints,
    searchConditions: null,
    reacquireConditions: null,
    candidateCount: 1,
    rejectedCandidateCount: 0,
    selectionMethod: "tracked",
  });

  it("normalizes crop boxes and represents full-frame searches explicitly", () => {
    expect(
      normalizeDetectorAttemptRegion({ x: 20, y: 50, width: 100, height: 200 }, 200, 500),
    ).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.5,
      h: 0.4,
    });
    expect(normalizeDetectorAttemptRegion(null, 200, 500)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("preserves raw rejected keypoints while deriving flip and quality rejection status", () => {
    const attempts = [acceptedAttempt(0), acceptedAttempt(0.1), acceptedAttempt(0.2)];
    const goodFrames: PoseFrame[] = [{ timestamp: 0, keypoints }];

    const result = finalizeDetectorAttempts(attempts, [0.1], goodFrames);

    expect(result.map((attempt) => attempt.status)).toEqual([
      "accepted",
      "flipRejected",
      "qualityRejected",
    ]);
    expect(result[1].rawKeypoints).toEqual(keypoints);
    expect(result[2].rawKeypoints).toEqual(keypoints);
    expect("acceptedKeypoints" in result[1]).toBe(false);
    expect("acceptedKeypoints" in result[2]).toBe(false);
    // Rejection is not a miss — the reason field never travels onto these.
    expect("missReason" in result[1]).toBe(false);
    expect("missReason" in result[2]).toBe(false);
  });

  it("leaves missing attempts missing even when no good frame exists", () => {
    const missing: DetectorAttempt = {
      timestamp: 0,
      status: "missing",
      initialSearchRegion: { x: 0, y: 0, w: 1, h: 1 },
      detectionRegion: null,
      reacquireAttempted: false,
      reacquired: false,
      reacquireSteps: [],
      bestUnselectedCandidateScore: null,
      missReason: "no-candidates",
      rawKeypoints: [],
      searchConditions: null,
      reacquireConditions: null,
      candidateCount: 0,
      rejectedCandidateCount: 0,
      selectionMethod: "strongest",
    };

    expect(finalizeDetectorAttempts([missing], [], [])).toEqual([missing]);
  });

  it("marks flagged timestamps accepted-under-suspicion rather than rejected", () => {
    const attempts = [acceptedAttempt(0), acceptedAttempt(0.1)];
    const goodFrames: PoseFrame[] = [
      { timestamp: 0, keypoints },
      { timestamp: 0.1, keypoints },
    ];

    const result = finalizeDetectorAttempts(attempts, [], goodFrames, [0.1]);

    expect(result.map((attempt) => attempt.status)).toEqual(["accepted", "accepted"]);
    expect(result[1].flipFlagged).toBe(true);
    // Not flagged means the field is absent, never `false`.
    expect("flipFlagged" in result[0]).toBe(false);
  });

  it("keeps a discarded flip rejected and strips the flag from a demoted attempt", () => {
    const flagged: DetectorAttempt = { ...acceptedAttempt(0), flipFlagged: true };

    // A timestamp cannot be both discarded and flagged coming out of
    // detectFlips, but demotion must never leave acceptance-only fields behind.
    const [result] = finalizeDetectorAttempts([flagged], [0], []);

    expect(result.status).toBe("flipRejected");
    expect("flipFlagged" in result).toBe(false);
    expect("acceptedKeypoints" in result).toBe(false);
  });

  it("defaults to no flagged timestamps so existing callers are unaffected", () => {
    const goodFrames: PoseFrame[] = [{ timestamp: 0, keypoints }];
    const [result] = finalizeDetectorAttempts([acceptedAttempt(0)], [], goodFrames);

    expect(result.status).toBe("accepted");
    expect("flipFlagged" in result).toBe(false);
  });

  it("accepts a payload without the iteration-2 evidence fields", () => {
    const legacy: DetectorAttempt = {
      timestamp: 0,
      status: "missing",
      initialSearchRegion: { x: 0, y: 0, w: 1, h: 1 },
      detectionRegion: null,
      reacquireAttempted: false,
      reacquired: false,
      rawKeypoints: [],
      searchConditions: null,
      reacquireConditions: null,
      candidateCount: 0,
      rejectedCandidateCount: 0,
      selectionMethod: "strongest",
    };

    expect(finalizeDetectorAttempts([legacy], [], [])).toEqual([legacy]);
  });
});

describe("bestUnselectedCandidateScore", () => {
  const candidate = (score: number): PoseFrame => ({
    timestamp: 0,
    keypoints: [
      { name: "left_hip", x: 0.5, y: 0.5, score },
      { name: "right_hip", x: 0.5, y: 0.5, score: score / 2 },
    ],
  });

  it("returns the highest mean confidence among the candidates left behind", () => {
    const strong = candidate(0.9);
    const weak = candidate(0.4);
    const middling = candidate(0.6);

    expect(bestUnselectedCandidateScore([strong, weak, middling], strong)).toBeCloseTo(0.45, 6);
  });

  it("is null when every candidate was selected or none was returned", () => {
    const only = candidate(0.9);
    expect(bestUnselectedCandidateScore([only], only)).toBeNull();
    expect(bestUnselectedCandidateScore([], null)).toBeNull();
  });

  it("skips candidates with no keypoints rather than scoring them zero", () => {
    const empty: PoseFrame = { timestamp: 0, keypoints: [] };
    expect(bestUnselectedCandidateScore([empty], null)).toBeNull();
  });

  it("folds one search's best into the attempt's running best", () => {
    expect(mergeBestUnselectedScore(null, null)).toBeNull();
    expect(mergeBestUnselectedScore(null, 0.4)).toBe(0.4);
    expect(mergeBestUnselectedScore(0.7, null)).toBe(0.7);
    expect(mergeBestUnselectedScore(0.7, 0.4)).toBe(0.7);
  });
});

describe("deriveMissReason", () => {
  it("blames the detector only when no region returned a candidate", () => {
    expect(deriveMissReason(0)).toBe("no-candidates");
  });

  it("blames the identity gate when candidates existed", () => {
    expect(deriveMissReason(1)).toBe("identity-gated");
    expect(deriveMissReason(4)).toBe("identity-gated");
  });
});

// ---------------------------------------------------------------------------
// Processor-level attempt evidence
// ---------------------------------------------------------------------------

describe("useVideoProcessor detector attempt evidence", () => {
  const VIDEO_W = 100;
  const VIDEO_H = 200;
  const FULL_FRAME = { x: 0, y: 0, w: 1, h: 1 };

  /** Names carrying full weight in filterLandmarks, so a synthetic pose survives. */
  const POSE_KEYPOINT_NAMES = [
    "left_wrist",
    "right_wrist",
    "left_shoulder",
    "right_shoulder",
    "left_hip",
    "right_hip",
  ];

  /** A compact synthetic pose centred on (cx, cy) in the search region's space. */
  function pose(cx: number, cy: number, score = 0.9): PoseFrame {
    return {
      timestamp: 0,
      keypoints: POSE_KEYPOINT_NAMES.map((name, i) => ({
        name,
        x: cx + (i % 2 === 0 ? -0.02 : 0.02),
        y: cy + (i < 2 ? -0.02 : 0.02),
        score,
      })),
    };
  }

  let createElementSpy: ReturnType<typeof vi.spyOn> | null = null;

  /** A minimal 2D context: every pixel operation the seek loop makes is a stub. */
  function fakeContext() {
    return {
      drawImage: vi.fn(),
      putImageData: vi.fn(),
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(1, w * h) * 4),
        width: w,
        height: h,
        colorSpace: "srgb",
      })),
    };
  }

  /** A video element whose metadata resolves on src assignment. */
  function fakeVideo(duration: number) {
    const video: Record<string, unknown> = {
      muted: false,
      playsInline: false,
      currentTime: 0,
      duration,
      videoWidth: VIDEO_W,
      videoHeight: VIDEO_H,
      onloadedmetadata: null,
      onerror: null,
    };
    Object.defineProperty(video, "src", {
      set() {
        setTimeout(() => (video.onloadedmetadata as (() => void) | null)?.(), 0);
      },
      get: () => "blob:fake",
    });
    return video;
  }

  /**
   * Drive the seek loop with a scripted MediaPipe response per call, in call
   * order: each detection frame consumes one entry for its initial search and,
   * when that search selects nothing, one more per rung of the re-acquire
   * ladder (tight ×1.5, tight ×2.5, then the full frame) until one finds the
   * Climber.
   */
  async function runProcessor(
    responses: PoseFrame[][],
    {
      duration = 0.2,
      climberCrop = { x: 0, y: 0, w: 1, h: 1 },
    }: { duration?: number; climberCrop?: { x: number; y: number; w: number; h: number } } = {},
  ): Promise<DetectorAttempt[]> {
    const queue = [...responses];
    vi.mocked(estimateFramesMediaPipe).mockImplementation(() => queue.shift() ?? []);

    const realCreateElement = document.createElement.bind(document);
    createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string, options?: ElementCreationOptions) =>
        tag === "video"
          ? (fakeVideo(duration) as unknown as HTMLElement)
          : realCreateElement(tag, options),
      ) as ReturnType<typeof vi.spyOn>;

    const { result } = renderHook(() => useVideoProcessor());

    await act(async () => {
      await result.current.process(
        new File([""], "clip.mp4", { type: "video/mp4" }),
        {},
        {},
        1,
        { state: "", area: "", route: "" },
        // A full-frame Climber Crop keeps crop-local and full-frame coordinates
        // identical on acquisition, so scripted poses land where they read.
        { climberCrop },
        0,
        "mediapipe",
        {},
        {
          emitLivePreview: false,
          frameOutput: "detected",
          detectHolds: false,
          generateThumbnail: false,
          collectDetectorAttempts: true,
        },
      );
    });

    return result.current.detectorAttempts ?? [];
  }

  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    HTMLCanvasElement.prototype.getContext = vi.fn(
      fakeContext,
    ) as unknown as HTMLCanvasElement["getContext"];
    HTMLCanvasElement.prototype.toBlob = vi.fn();
  });

  afterEach(() => {
    createElementSpy?.mockRestore();
    createElementSpy = null;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reports no-candidates when no region returned a pose", async () => {
    // Initial crop search, then the full-frame re-acquire — both empty.
    const attempts = await runProcessor([[], []], { duration: 0.1 });

    expect(attempts).toHaveLength(1);
    const [miss] = attempts;
    expect(miss.status).toBe("missing");
    expect(miss.missReason).toBe("no-candidates");
    expect(miss.candidateCount).toBe(0);
    expect(miss.bestUnselectedCandidateScore).toBeNull();
    expect(miss.reacquireAttempted).toBe(true);
    expect(miss.reacquired).toBe(false);
    expect(miss.reacquireSteps).toEqual([{ region: FULL_FRAME, found: false }]);
  });

  it("rejects a bystander far from a fresh prediction and reports identity-gated", async () => {
    const attempts = await runProcessor([
      [pose(0.5, 0.5)], // frame 0 — acquires the Climber
      [], // frame 1 initial crop search — nothing
      [], // frame 1 ladder rung ×1.5
      [], // frame 1 ladder rung ×2.5
      [pose(0.05, 0.05, 0.42)], // frame 1 full frame — a bystander far from the prediction
    ]);

    expect(attempts.map((attempt) => attempt.status)).toEqual(["accepted", "missing"]);

    const miss = attempts[1];
    expect(miss.missReason).toBe("identity-gated");
    expect(miss.candidateCount).toBe(1);
    // The gated candidate's mean confidence still travels, so a near miss is
    // distinguishable from a hard one.
    expect(miss.bestUnselectedCandidateScore).toBeCloseTo(0.42, 6);

    // Acceptance carries no miss reason and no re-acquire rung.
    expect("missReason" in attempts[0]).toBe(false);
    expect(attempts[0].reacquireSteps).toEqual([]);
    expect(attempts[0].reacquireAttempted).toBe(false);
  });

  it("walks tight rungs before the full frame and records every one", async () => {
    const attempts = await runProcessor([
      [pose(0.5, 0.5)], // frame 0 — acquires the Climber
      [], // frame 1 initial crop search — nothing
      [], // frame 1 ladder rung ×1.5
      [], // frame 1 ladder rung ×2.5
      [], // frame 1 full frame — still nothing
    ]);

    const steps = attempts[1].reacquireSteps ?? [];
    expect(steps.map((step) => step.found)).toEqual([false, false, false]);
    // Tightest first: each rung searches strictly more of the frame than the
    // last, and the full frame is the demoted final rung.
    const areas = steps.map((step) => step.region.w * step.region.h);
    expect(areas[0]).toBeLessThan(areas[1]);
    expect(areas[1]).toBeLessThan(areas[2]);
    expect(steps[2].region).toEqual(FULL_FRAME);
  });

  it("stops at the first rung that finds the Climber", async () => {
    const attempts = await runProcessor([
      [pose(0.5, 0.5)], // frame 0 — acquires the Climber
      [], // frame 1 initial crop search — nothing
      [pose(0.5, 0.5)], // frame 1 ladder rung ×1.5 — found here
    ]);

    expect(attempts.map((attempt) => attempt.status)).toEqual(["accepted", "accepted"]);
    const reacquired = attempts[1];
    expect(reacquired.reacquired).toBe(true);
    // One rung only — the wider rungs and the full frame were never searched.
    expect(reacquired.reacquireSteps).toHaveLength(1);
    expect(reacquired.reacquireSteps?.[0].found).toBe(true);
    // The rung that found the Climber is the detection region, not "full frame".
    expect(reacquired.detectionRegion).toEqual(reacquired.reacquireSteps?.[0].region);
    expect(reacquired.detectionRegion).not.toEqual(FULL_FRAME);
    expect("missReason" in reacquired).toBe(false);

    // Two frames, one miss: 2 initial searches + exactly 1 extra pass.
    expect(vi.mocked(estimateFramesMediaPipe)).toHaveBeenCalledTimes(3);
  });

  it("never escalates to a ladder while the Climber stays tracked", async () => {
    const attempts = await runProcessor([[pose(0.5, 0.5)], [pose(0.5, 0.5)]]);

    expect(attempts.map((attempt) => attempt.status)).toEqual(["accepted", "accepted"]);
    for (const attempt of attempts) {
      expect(attempt.reacquireAttempted).toBe(false);
      expect(attempt.reacquireSteps).toEqual([]);
      expect(attempt.detectionRegion).toEqual(attempt.initialSearchRegion);
    }
    // A hit costs no extra inference: one MediaPipe pass per detection frame.
    expect(vi.mocked(estimateFramesMediaPipe)).toHaveBeenCalledTimes(2);
  });

  it("falls back to the Climber Crop seed after a run of misses", async () => {
    // A seed crop distinguishable from both the Adaptive Crop and the full
    // frame, so the region the reset lands on is unambiguous.
    const seed = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
    const attempts = await runProcessor(
      [
        [pose(0.5, 0.5)], // frame 0 — acquires the Climber
        [], // frame 1 initial + ladder — all empty
        [],
        [],
        [],
        [], // frame 2 initial + ladder — all empty (MISS_RESET_RUN reached)
        [],
        [],
        [],
      ],
      { duration: 0.4, climberCrop: seed },
    );

    expect(attempts.map((attempt) => attempt.status)).toEqual([
      "accepted",
      "missing",
      "missing",
      "missing",
    ]);

    // While the crop is still trusted, the search region is the Adaptive Crop.
    expect(attempts[1].initialSearchRegion).not.toEqual(seed);
    expect(attempts[2].initialSearchRegion).not.toEqual(seed);
    // After MISS_RESET_RUN consecutive misses it is cleared, and acquisition
    // falls back to the seed — never to the full frame, which is what keeps a
    // small or distant Climber above the detector's size floor.
    expect(attempts[3].initialSearchRegion).toEqual(seed);
  });

  it("scores the strongest candidate the initial search passed over", async () => {
    const attempts = await runProcessor([[pose(0.5, 0.5, 0.9), pose(0.55, 0.55, 0.4)]], {
      duration: 0.1,
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("accepted");
    expect(attempts[0].candidateCount).toBe(2);
    expect(attempts[0].bestUnselectedCandidateScore).toBeCloseTo(0.4, 6);
  });
});
