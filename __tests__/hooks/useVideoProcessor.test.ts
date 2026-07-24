import { describe, expect, it } from "vitest";
import {
  ORB_PREVIEW_UPDATE_INTERVAL_SEC,
  shouldEmitOrbPreview,
  tagFlipDiscardedFrames,
} from "@/hooks/useVideoProcessor";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";

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
