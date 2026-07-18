import { describe, it, expect } from "vitest";
import { planBatchAnalyze } from "@/utils/harnessBatch";

function item(key: string, hasSetup: boolean, hasGroundTruth: boolean) {
  return { key, hasSetup, hasGroundTruth };
}

describe("planBatchAnalyze", () => {
  it("queues exactly the accepted-Ground-Truth subset, in corpus order", () => {
    const plan = planBatchAnalyze([
      item("a", true, true),
      item("b", true, false),
      item("c", true, true),
      item("d", false, false),
    ]);
    expect(plan.queue.map((i) => i.key)).toEqual(["a", "c"]);
    expect(plan.skippedNoTruth).toBe(2);
    expect(plan.skippedNoSetup).toBe(0);
    expect(plan.total).toBe(4);
  });

  it("gates on truth only — run counts and staleness never enter the plan", () => {
    // A video with truth is queued no matter what else is true of it; the
    // stamps on each posted run are what tell re-runs apart (ADR 0018).
    const plan = planBatchAnalyze([item("a", true, true), item("a-again", true, true)]);
    expect(plan.queue).toHaveLength(2);
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
    expect(plan.skippedNoSetup).toBe(0);
    expect(plan.total).toBe(0);
  });
});
