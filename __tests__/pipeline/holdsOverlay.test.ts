import { describe, it, expect, vi, beforeEach } from "vitest";
import { drawHolds } from "@/pipeline/holdsOverlay";
import type { Hold } from "@/pipeline/holdDetection";

// ---------------------------------------------------------------------------
// drawHolds is a canvas routine; we feed it a minimal fake 2D context and spy on
// measureText (the marker of the greedy label layout) to assert the layout is
// cached per (canvas, holds, revealed set) and only recomputed on a reveal
// change — the ADR 0009 performance fix.
// ---------------------------------------------------------------------------

function makeCtx(width = 1000, height = 1000) {
  const measureText = vi.fn(() => ({ width: 12 }) as TextMetrics);
  const ctx = {
    canvas: { width, height } as HTMLCanvasElement,
    measureText,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    textAlign: "",
    textBaseline: "",
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    shadowColor: "",
    shadowBlur: 0,
    globalAlpha: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, measureText };
}

const HOLDS: Hold[] = [
  { id: "hold-1", kind: "hand", side: "left", x: 250, y: 400, firstUseTime: 1, order: 1 },
  { id: "hold-2", kind: "foot", side: "right", x: 700, y: 800, firstUseTime: 2, order: 2 },
];

const BODY_SCALE = 100;

describe("drawHolds label-layout caching", () => {
  beforeEach(() => vi.clearAllMocks());

  it("computes the layout once and reuses it for the same revealed set", () => {
    const { ctx, measureText } = makeCtx();
    // Both holds revealed at t=5.
    drawHolds(ctx, HOLDS, 5, undefined, BODY_SCALE);
    const afterFirst = measureText.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Same canvas, same holds, a later time but the same revealed set → cached.
    drawHolds(ctx, HOLDS, 6, undefined, BODY_SCALE);
    drawHolds(ctx, HOLDS, 7, undefined, BODY_SCALE);
    expect(measureText.mock.calls.length).toBe(afterFirst);
  });

  it("recomputes when the revealed set changes", () => {
    const { ctx, measureText } = makeCtx();
    // Only the first hold revealed (t=1.5 < hold-2 firstUseTime 2).
    drawHolds(ctx, HOLDS, 1.5, undefined, BODY_SCALE);
    const afterOne = measureText.mock.calls.length;

    // Now both revealed → the plan must be rebuilt.
    drawHolds(ctx, HOLDS, 2.5, undefined, BODY_SCALE);
    expect(measureText.mock.calls.length).toBeGreaterThan(afterOne);
  });

  it("draws nothing (no layout) when holds are empty or hidden", () => {
    const { ctx, measureText } = makeCtx();
    drawHolds(ctx, [], 5, undefined, BODY_SCALE);
    drawHolds(ctx, HOLDS, 5, { holdsVisible: false }, BODY_SCALE);
    expect(measureText).not.toHaveBeenCalled();
  });
});
