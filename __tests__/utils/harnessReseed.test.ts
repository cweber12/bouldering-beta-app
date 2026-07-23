import { describe, it, expect } from "vitest";
import { planReseedSweep, planBatchCalibrate, decideReseedStep } from "@/utils/harnessReseed";
import type { ViTPoseScaffold } from "@/utils/harnessViTPose";

function item(
  key: string,
  {
    hasSetup = true,
    hasGroundTruth = true,
    truthStale = false,
    seedReady = false,
    untrackable = false,
  }: Partial<{
    hasSetup: boolean;
    hasGroundTruth: boolean;
    truthStale: boolean;
    seedReady: boolean;
    untrackable: boolean;
  }> = {},
) {
  return { key, hasSetup, hasGroundTruth, truthStale, seedReady, untrackable };
}

const posedScaffold: ViTPoseScaffold = {
  version: 1,
  setupHash: "h1",
  frames: [
    { timestamp: 0, keypoints: [] },
    { timestamp: 0.1, keypoints: [{ name: "nose", x: 0.5, y: 0.5, score: 0.9 }] },
  ],
};

const poselessScaffold: ViTPoseScaffold = {
  version: 1,
  setupHash: "h1",
  frames: [
    { timestamp: 0, keypoints: [] },
    { timestamp: 0.1, keypoints: [] },
  ],
};

describe("planReseedSweep", () => {
  it("queues exactly the stale-truth bundles that are not seed-ready, in corpus order", () => {
    const plan = planReseedSweep([
      item("stale-a", { truthStale: true }),
      item("fresh", {}),
      item("stale-b", { truthStale: true }),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["stale-a", "stale-b"]);
    expect(plan.seedReady).toBe(0);
    expect(plan.staleTotal).toBe(2);
    expect(plan.total).toBe(3);
  });

  it("excludes seed-ready stale bundles — a fresh posed scaffold needs review, never a job", () => {
    const plan = planReseedSweep([
      item("ready", { truthStale: true, seedReady: true }),
      item("needs-job", { truthStale: true }),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["needs-job"]);
    expect(plan.seedReady).toBe(1);
    expect(plan.staleTotal).toBe(2);
  });

  it("excludes truthless bundles — first-time authoring stays a deliberate act", () => {
    const plan = planReseedSweep([
      item("truthless", { hasGroundTruth: false }),
      item("stale", { truthStale: true }),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["stale"]);
    expect(plan.staleTotal).toBe(1);
    expect(plan.total).toBe(2);
  });

  it("excludes fresh-truth bundles — nothing to re-seed", () => {
    const plan = planReseedSweep([item("fresh", {}), item("also-fresh", {})]);
    expect(plan.queue).toEqual([]);
    expect(plan.staleTotal).toBe(0);
    expect(plan.total).toBe(2);
  });

  it("skips a stale-truth bundle with no Scan Setup under its own count (pathological)", () => {
    const plan = planReseedSweep([
      item("orphan", { truthStale: true, hasSetup: false }),
      item("ok", { truthStale: true }),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["ok"]);
    expect(plan.skippedNoSetup).toBe(1);
    expect(plan.staleTotal).toBe(2);
  });

  it("holds out an Untrackable stale bundle — re-running the same seed fails identically", () => {
    const plan = planReseedSweep([
      item("untrackable", { truthStale: true, untrackable: true }),
      item("ok", { truthStale: true }),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["ok"]);
    expect(plan.skippedUntrackable).toBe(1);
    expect(plan.staleTotal).toBe(2);
  });

  it("plans an empty corpus as an empty sweep", () => {
    const plan = planReseedSweep([]);
    expect(plan.queue).toEqual([]);
    expect(plan.seedReady).toBe(0);
    expect(plan.skippedNoSetup).toBe(0);
    expect(plan.skippedUntrackable).toBe(0);
    expect(plan.staleTotal).toBe(0);
    expect(plan.total).toBe(0);
  });
});

describe("planBatchCalibrate", () => {
  it("queues exactly the setup-but-truthless bundles that are not seed-ready, in corpus order", () => {
    const plan = planBatchCalibrate([
      item("truthless-a", { hasGroundTruth: false }),
      item("has-truth", {}),
      item("truthless-b", { hasGroundTruth: false }),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["truthless-a", "truthless-b"]);
    expect(plan.seedReady).toBe(0);
    expect(plan.truthlessTotal).toBe(2);
    expect(plan.total).toBe(3);
  });

  it("surfaces seed-ready truthless bundles as review-ready, never re-jobbed", () => {
    const plan = planBatchCalibrate([
      item("ready", { hasGroundTruth: false, seedReady: true }),
      item("needs-job", { hasGroundTruth: false }),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["needs-job"]);
    expect(plan.seedReady).toBe(1);
    expect(plan.truthlessTotal).toBe(2);
  });

  it("skips a truthless bundle with no Scan Setup under its own count", () => {
    const plan = planBatchCalibrate([
      item("no-setup", { hasGroundTruth: false, hasSetup: false }),
      item("ok", { hasGroundTruth: false }),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["ok"]);
    expect(plan.skippedNoSetup).toBe(1);
    expect(plan.truthlessTotal).toBe(2);
  });

  it("excludes every truth-bearing bundle — stale or fresh, calibration is not first-time authoring", () => {
    const plan = planBatchCalibrate([
      item("fresh", {}),
      item("stale", { truthStale: true }),
      item("stale-ready", { truthStale: true, seedReady: true }),
    ]);
    expect(plan.queue).toEqual([]);
    expect(plan.seedReady).toBe(0);
    expect(plan.truthlessTotal).toBe(0);
    expect(plan.total).toBe(3);
  });

  it("holds out an Untrackable truthless bundle — the same seed already posed nothing", () => {
    const plan = planBatchCalibrate([
      item("untrackable", { hasGroundTruth: false, untrackable: true }),
      item("ok", { hasGroundTruth: false }),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["ok"]);
    expect(plan.skippedUntrackable).toBe(1);
    expect(plan.truthlessTotal).toBe(2);
  });

  it("plans an empty corpus as an empty sweep", () => {
    const plan = planBatchCalibrate([]);
    expect(plan.queue).toEqual([]);
    expect(plan.seedReady).toBe(0);
    expect(plan.skippedNoSetup).toBe(0);
    expect(plan.skippedUntrackable).toBe(0);
    expect(plan.truthlessTotal).toBe(0);
    expect(plan.total).toBe(0);
  });
});

describe("decideReseedStep", () => {
  it("lands a posed scaffold and advances", () => {
    const step = decideReseedStep({ scaffold: posedScaffold, error: null }, false);
    expect(step).toEqual({ kind: "landed", advance: true });
  });

  it("fails a scaffold that tracked no Climber — and still advances", () => {
    const step = decideReseedStep({ scaffold: poselessScaffold, error: null }, false);
    expect(step).toEqual({
      kind: "failed",
      failure: "no-climber",
      message: "ViTPose tracked no climber.",
      advance: true,
    });
  });

  it("names the re-tap remedy when the sidecar reports seedFound false", () => {
    const step = decideReseedStep(
      { scaffold: poselessScaffold, error: null, seedFound: false },
      false,
    );
    expect(step.kind).toBe("failed");
    if (step.kind === "failed") {
      expect(step.failure).toBe("no-climber");
      expect(step.message).toMatch(/re-tap the Climber/);
    }
    // A posed scaffold lands regardless of the flag (stale sidecar noise).
    expect(
      decideReseedStep({ scaffold: posedScaffold, error: null, seedFound: false }, false).kind,
    ).toBe("landed");
  });

  it("fails on the downloader's error sidecar with its message, and advances", () => {
    const step = decideReseedStep({ scaffold: null, error: "GPU exploded." }, false);
    expect(step).toEqual({
      kind: "failed",
      failure: "error-sidecar",
      message: "GPU exploded.",
      advance: true,
    });
  });

  it("fails on the poll-timeout backstop, and advances", () => {
    const step = decideReseedStep({ scaffold: null, error: null }, true);
    expect(step).toEqual({
      kind: "failed",
      failure: "timeout",
      message: "The ViTPose job timed out.",
      advance: true,
    });
  });

  it("keeps polling while nothing has landed and nothing is terminal", () => {
    const step = decideReseedStep({ scaffold: null, error: null }, false);
    expect(step).toEqual({ kind: "poll", advance: false });
  });

  it("a landed artifact supersedes a lingering error sidecar", () => {
    const step = decideReseedStep({ scaffold: posedScaffold, error: "stale error" }, false);
    expect(step.kind).toBe("landed");
  });

  it("a terminal error wins over the timeout backstop firing on the same poll", () => {
    const step = decideReseedStep({ scaffold: null, error: "died late" }, true);
    expect(step).toMatchObject({ kind: "failed", failure: "error-sidecar" });
  });
});
