import { describe, it, expect } from "vitest";
import { buildHarnessPayloads } from "@/utils/harnessPayloads";
import type { ScanDiagnostics, ReferenceFrameMeta } from "@/pipeline/analysis/diagnostics";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";

const orbSummary = {
  refKeypointCount: 480,
  keyframeCount: 0,
  keyframeKeypoints: { min: 0, avg: 0, max: 0 },
};

// The builder only reads appVersion + result.orb; the rest is opaque to it.
const diagnostics = {
  appVersion: "abc1234",
  result: { orb: orbSummary },
} as unknown as ScanDiagnostics;

const frames: PoseFrame[] = [{ timestamp: 0, keypoints: [] }];
const referenceFrameMeta = {
  width: 720,
  height: 1280,
  refKeypointCount: 480,
} as unknown as ReferenceFrameMeta;

describe("buildHarnessPayloads", () => {
  it("wraps the diagnostics + frames as the pose half", () => {
    const { pose } = buildHarnessPayloads({
      diagnostics,
      frames,
      referenceFrameMeta,
      setupHash: "hash1",
    });
    expect(pose.setupHash).toBe("hash1");
    expect(pose.diagnostics).toBe(diagnostics);
    expect(pose.frames).toBe(frames);
  });

  it("puts extraction data + attribution in the orb half", () => {
    const { orb } = buildHarnessPayloads({
      diagnostics,
      frames,
      referenceFrameMeta,
      setupHash: "hash1",
    });
    expect(orb.setupHash).toBe("hash1");
    expect(orb.appVersion).toBe("abc1234");
    expect(orb.referenceFrameMeta).toBe(referenceFrameMeta);
    expect(orb.summary).toBe(orbSummary);
  });

  it("tolerates a null reference frame meta", () => {
    const { orb } = buildHarnessPayloads({
      diagnostics,
      frames,
      referenceFrameMeta: null,
      setupHash: "h",
    });
    expect(orb.referenceFrameMeta).toBeNull();
  });
});
