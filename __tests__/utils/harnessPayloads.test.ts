import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildHarnessPayloads,
  postDetectionRun,
  type HarnessOrbPayload,
  type HarnessPosePayload,
} from "@/utils/harnessPayloads";
import type { ScanDiagnostics, ReferenceFrameMeta } from "@/pipeline/analysis/diagnostics";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import { scoreRunAgainstGroundTruth } from "@/utils/harnessScoring";

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

const frames: PoseFrame[] = [{ timestamp: 0, source: "raw", keypoints: [] }];
const referenceFrameMeta = {
  width: 720,
  height: 1280,
  refKeypointCount: 480,
} as unknown as ReferenceFrameMeta;

// A minimal real scoring block: one probed absent frame, no pose.
const scoring = scoreRunAgainstGroundTruth({
  groundTruth: {
    groundTruthHash: "gt-hash-9",
    frames: [
      {
        frameIndex: 0,
        timestamp: 0,
        state: "absent",
        joints: {},
        review: "human-flagged-absent",
        verified: true,
      },
    ],
  },
  run: { probes: [{ timestamp: 0 }], frames: [] },
});

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
    expect(pose.frames[0].source).toBe("raw");
  });

  it("posts unscored when no scoring block is supplied", () => {
    const { pose } = buildHarnessPayloads({
      diagnostics,
      frames,
      referenceFrameMeta,
      setupHash: "hash1",
    });
    expect(pose.scoring).toBeNull();
    expect(pose.groundTruthHash).toBeNull();
  });

  it("folds the scoring block in and lifts its groundTruthHash stamp", () => {
    const { pose } = buildHarnessPayloads({
      diagnostics,
      frames,
      referenceFrameMeta,
      setupHash: "hash1",
      scoring,
    });
    expect(pose.scoring).toBe(scoring);
    expect(pose.groundTruthHash).toBe("gt-hash-9");
    // All three stamps ride the pose half: appVersion inside diagnostics.
    expect(pose.diagnostics.appVersion).toBe("abc1234");
    expect(pose.setupHash).toBe("hash1");
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

describe("postDetectionRun", () => {
  const { pose, orb } = buildHarnessPayloads({
    diagnostics,
    frames,
    referenceFrameMeta,
    setupHash: "setup-hash",
    scoring,
  });

  const stubFetch = (response: { ok: boolean; status: number; body: unknown }) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const run = (p: HarnessPosePayload = pose, o: HarnessOrbPayload = orb) =>
    postDetectionRun({ videoPath: "analysis/route/vid/vid.mp4", pose: p, orb: o });

  it("relays the run with its video path and both stamped halves", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: { run_id: "run-1" } });
    await run();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/dev/detections");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.video_path).toBe("analysis/route/vid/vid.mp4");
    expect(body.pose.setupHash).toBe("setup-hash");
    expect(body.pose.diagnostics.appVersion).toBe("abc1234");
    expect(body.pose.groundTruthHash).toBe("gt-hash-9");
    expect(body.pose.frames[0].source).toBe("raw");
    expect(body.pose.scoring.rollup.verified.counts.absentOk).toBe(1);
    expect(body.orb.appVersion).toBe("abc1234");
  });

  it("returns the run id the downloader assigned", async () => {
    stubFetch({ ok: true, status: 200, body: { run_id: "run-7" } });
    await expect(run()).resolves.toEqual({ runId: "run-7" });
  });

  it("resolves with a null run id when the downloader reports none", async () => {
    stubFetch({ ok: true, status: 200, body: {} });
    await expect(run()).resolves.toEqual({ runId: null });
  });

  it("surfaces the downloader's error message", async () => {
    stubFetch({ ok: false, status: 422, body: { error: "video_path not found." } });
    await expect(run()).rejects.toThrow("video_path not found.");
  });

  it("falls back to the status when the failure carries no message", async () => {
    stubFetch({ ok: false, status: 502, body: {} });
    await expect(run()).rejects.toThrow("502");
  });

  it("treats a non-JSON failure body as a failure, not a crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }),
    );
    await expect(run()).rejects.toThrow("500");
  });
});
