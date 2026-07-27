import { describe, it, expect } from "vitest";
import {
  CLIMB_WINDOW_UNMARKED,
  checkClimbEnd,
  detectionFrameWindow,
  formatClimbWindow,
  formatClipTime,
  planClimbEndSweep,
  snapToDetectionFrame,
} from "@/utils/harnessClimbWindow";
import { parseClimbEndEdit } from "@/utils/harnessSetup";
import { buildDetectionGrid, detectionFrameCount } from "@/utils/harnessDetectionGrid";

function item(
  key: string,
  { hasSetup = true, climbStart, climbEnd }: Partial<{
    hasSetup: boolean;
    climbStart: number;
    climbEnd: number;
  }> = {},
) {
  return { key, hasSetup, climbStart, climbEnd };
}

describe("planClimbEndSweep", () => {
  it("queues exactly the set-up bundles that carry no marker, in corpus order", () => {
    const plan = planClimbEndSweep([
      item("unmarked-a"),
      item("marked", { climbEnd: 12.3 }),
      item("unmarked-b", { climbStart: 1.2 }),
      item("no-setup", { hasSetup: false }),
    ]);

    expect(plan.queue.map((i) => i.key)).toEqual(["unmarked-a", "unmarked-b"]);
    expect(plan.marked).toBe(1);
    expect(plan.skippedNoSetup).toBe(1);
    expect(plan.total).toBe(4);
  });

  it("counts a bundle marked at 0 as marked, not unmarked", () => {
    // 0 is not a legal marker (it can never exceed a climb start), but absence
    // and a falsy value must not be conflated when planning the queue.
    const plan = planClimbEndSweep([item("zero", { climbEnd: 0 })]);
    expect(plan.queue).toHaveLength(0);
    expect(plan.marked).toBe(1);
  });

  it("skips an unmarked bundle with no Setup rather than queueing an unwritable marker", () => {
    const plan = planClimbEndSweep([item("no-setup", { hasSetup: false })]);
    expect(plan.queue).toHaveLength(0);
    expect(plan.skippedNoSetup).toBe(1);
  });
});

describe("checkClimbEnd", () => {
  it("accepts a marker strictly after the climb start", () => {
    expect(checkClimbEnd(12.4, 1.2)).toEqual({ ok: true, value: 12.4 });
  });

  it("accepts any non-negative marker when the climb start is unknown", () => {
    expect(checkClimbEnd(0, undefined)).toEqual({ ok: true, value: 0 });
  });

  it("refuses a marker at or before the climb start, naming the start in the reason", () => {
    const atStart = checkClimbEnd(1.2, 1.2);
    expect(atStart.ok).toBe(false);
    if (!atStart.ok) expect(atStart.reason).toContain("0:01.2");

    expect(checkClimbEnd(0.8, 1.2).ok).toBe(false);
  });

  it("refuses a negative or non-finite marker", () => {
    expect(checkClimbEnd(-0.1).ok).toBe(false);
    expect(checkClimbEnd(Number.NaN).ok).toBe(false);
    expect(checkClimbEnd(Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it("agrees with the setup route's own rule, so the UI never accepts what the route 422s", () => {
    const climbStart = 2;
    for (const candidate of [-1, 0, 1.9, 2, 2.1, 30, Number.NaN]) {
      const uiAccepts = checkClimbEnd(candidate, climbStart).ok;
      const routeAccepts = parseClimbEndEdit({ climbEnd: candidate }, climbStart) !== false;
      expect(uiAccepts).toBe(routeAccepts);
    }
  });
});

describe("snapToDetectionFrame", () => {
  it("snaps to the nearest Detection Frame", () => {
    expect(snapToDetectionFrame(1.23, 10)).toBeCloseTo(1.2, 6);
    expect(snapToDetectionFrame(1.26, 10)).toBeCloseTo(1.3, 6);
    expect(snapToDetectionFrame(1.25, 10)).toBeCloseTo(1.3, 6);
  });

  it("lands on a timestamp the grid actually contains", () => {
    const grid = buildDetectionGrid(4).map((f) => f.timestamp);
    for (const t of [0, 0.04, 1.17, 2.5, 3.99]) {
      expect(grid.some((g) => Math.abs(g - snapToDetectionFrame(t, 4)) < 1e-9)).toBe(true);
    }
  });

  it("clamps past the last frame rather than inventing one beyond the video", () => {
    const last = buildDetectionGrid(3.05).at(-1)!.timestamp;
    expect(snapToDetectionFrame(99, 3.05)).toBeCloseTo(last, 6);
  });

  it("returns 0 for an unloaded duration", () => {
    expect(snapToDetectionFrame(1.2, Number.NaN)).toBe(0);
  });
});

describe("detectionFrameWindow", () => {
  it("spans radius seconds either side of the centre, on grid timestamps", () => {
    const { frames, offset } = detectionFrameWindow(5, 10, 0.5);
    expect(frames.map((f) => Number(f.timestamp.toFixed(1)))).toEqual([
      4.5, 4.6, 4.7, 4.8, 4.9, 5, 5.1, 5.2, 5.3, 5.4, 5.5,
    ]);
    expect(offset).toBe(45);
  });

  it("clips at both ends of the video instead of running off the grid", () => {
    const atStart = detectionFrameWindow(0, 10, 0.3);
    expect(atStart.offset).toBe(0);
    expect(atStart.frames[0].timestamp).toBe(0);

    const atEnd = detectionFrameWindow(10, 10, 0.3);
    const lastFrame = buildDetectionGrid(10).at(-1)!.timestamp;
    expect(atEnd.frames.at(-1)!.timestamp).toBeCloseTo(lastFrame, 6);
  });

  it("stays a local window — never the whole video's grid", () => {
    const { frames } = detectionFrameWindow(60, 300, 2);
    expect(frames).toHaveLength(41);
    expect(detectionFrameCount(300)).toBeGreaterThan(frames.length);
  });

  it("returns an empty window for an unloaded duration", () => {
    expect(detectionFrameWindow(1, Number.NaN, 2)).toEqual({ frames: [], offset: 0 });
  });
});

describe("formatClipTime / formatClimbWindow", () => {
  it("formats to tenths, the resolution the marker is stored at", () => {
    expect(formatClipTime(0)).toBe("0:00.0");
    expect(formatClipTime(4.2)).toBe("0:04.2");
    expect(formatClipTime(83.5)).toBe("1:23.5");
    expect(formatClipTime(600)).toBe("10:00.0");
  });

  it("reads unmarked when there is no marker — never a stand-in time", () => {
    expect(formatClimbWindow(4.2, undefined)).toBe(CLIMB_WINDOW_UNMARKED);
    expect(formatClimbWindow(undefined, undefined)).toBe(CLIMB_WINDOW_UNMARKED);
  });

  it("distinguishes a marker at the video's end from no marker at all", () => {
    expect(formatClimbWindow(4.2, 83.5)).toBe("0:04.2–1:23.5");
    expect(formatClimbWindow(4.2, 83.5)).not.toBe(formatClimbWindow(4.2, undefined));
  });

  it("marks an unknown climb start rather than pretending it is zero", () => {
    expect(formatClimbWindow(undefined, 83.5)).toBe("?–1:23.5");
  });
});
