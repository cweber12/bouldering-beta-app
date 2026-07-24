import { describe, expect, it } from "vitest";
import {
  finalizeDetectorAttempts,
  normalizeDetectorAttemptRegion,
  ORB_PREVIEW_UPDATE_INTERVAL_SEC,
  shouldEmitOrbPreview,
  tagFlipDiscardedFrames,
} from "@/hooks/useVideoProcessor";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import type { DetectorAttempt } from "@/utils/harnessPayloads";

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

  const acceptedAttempt = (timestamp: number): DetectorAttempt => ({
    timestamp,
    status: "accepted",
    initialSearchRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    detectionRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    reacquireAttempted: false,
    reacquired: false,
    rawKeypoints: keypoints,
    acceptedKeypoints: keypoints,
    searchConditions: null,
    reacquireConditions: null,
    candidateCount: 1,
    rejectedCandidateCount: 0,
    selectionMethod: "tracked",
  });

  it("normalizes crop boxes and represents full-frame searches explicitly", () => {
    expect(normalizeDetectorAttemptRegion({ x: 20, y: 50, width: 100, height: 200 }, 200, 500)).toEqual({
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
  });

  it("leaves missing attempts missing even when no good frame exists", () => {
    const missing: DetectorAttempt = {
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

    expect(finalizeDetectorAttempts([missing], [], [])).toEqual([missing]);
  });
});
