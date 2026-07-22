import { describe, it, expect } from "vitest";
import { planBatchAnalyze } from "@/utils/harnessBatch";

function item(
  key: string,
  hasSetup: boolean,
  hasGroundTruth: boolean,
  truthStale = false,
  pairedRunCount = 0,
) {
  return { key, hasSetup, hasGroundTruth, truthStale, pairedRunCount };
}

describe("planBatchAnalyze", () => {
  it("queues exactly the fresh accepted-Ground-Truth subset, in corpus order", () => {
    const plan = planBatchAnalyze([
      item("a", true, true),
      item("b", true, false),
      item("c", true, true),
      item("d", false, false),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["a", "c"]);
    expect(plan.skippedNoTruth).toBe(2);
    expect(plan.skippedStaleTruth).toBe(0);
    expect(plan.skippedNoSetup).toBe(0);
    expect(plan.total).toBe(4);
  });

  it("gates on truth freshness — run counts never enter the plan", () => {
    // A video with fresh truth is queued no matter how many runs it already
    // holds; the stamps on each posted run are what tell re-runs apart.
    const plan = planBatchAnalyze([item("a", true, true), item("a-again", true, true)]);
    expect(plan.queue).toHaveLength(2);
  });

  it("skips stale-truth videos under their own count — sweeping them would only mint unpaired runs", () => {
    const plan = planBatchAnalyze([
      item("stale", true, true, true),
      item("ok", true, true),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["ok"]);
    expect(plan.skippedStaleTruth).toBe(1);
    expect(plan.skippedNoTruth).toBe(0);
  });

  it("skips a truth-bearing video with no Scan Setup under its own count", () => {
    const plan = planBatchAnalyze([
      item("orphan-truth", false, true),
      item("ok", true, true),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["ok"]);
    expect(plan.skippedNoSetup).toBe(1);
    expect(plan.skippedNoTruth).toBe(0);
  });

  it("plans an empty corpus as an empty sweep", () => {
    const plan = planBatchAnalyze([]);
    expect(plan.queue).toEqual([]);
    expect(plan.skippedNoTruth).toBe(0);
    expect(plan.skippedStaleTruth).toBe(0);
    expect(plan.skippedNoSetup).toBe(0);
    expect(plan.skippedAnalyzed).toBe(0);
    expect(plan.total).toBe(0);
  });

  it("defaults to 'all' scope — a paired run never removes a fresh-truth video", () => {
    const plan = planBatchAnalyze([
      item("analyzed", true, true, false, 3),
      item("fresh", true, true, false, 0),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["analyzed", "fresh"]);
    expect(plan.skippedAnalyzed).toBe(0);
  });

  it("'un-analyzed' scope drops fresh-truth videos that already hold a paired run", () => {
    const plan = planBatchAnalyze(
      [
        item("analyzed", true, true, false, 2),
        item("fresh", true, true, false, 0),
        item("stale", true, true, true, 0),
        item("no-truth", true, false),
      ],
      "un-analyzed",
    );
    expect(plan.queue.map((i) => i.key)).toEqual(["fresh"]);
    expect(plan.skippedAnalyzed).toBe(1);
    // The other gates still apply, counted under their own reasons.
    expect(plan.skippedStaleTruth).toBe(1);
    expect(plan.skippedNoTruth).toBe(1);
    expect(plan.total).toBe(4);
  });
});
