import { describe, expect, it } from "vitest";
import { ORB_PREVIEW_UPDATE_INTERVAL_SEC, shouldEmitOrbPreview } from "@/hooks/useVideoProcessor";

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
