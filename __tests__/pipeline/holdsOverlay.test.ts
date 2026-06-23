import { describe, it, expect, vi, beforeEach } from "vitest";
import { drawHolds } from "@/pipeline/holdsOverlay";
import type { Hold } from "@/pipeline/holdDetection";

// ---------------------------------------------------------------------------
// drawHolds is a canvas routine; we feed it a minimal fake 2D context and spy on
// the text calls. The number is drawn ON each glyph (ADR 0010), so one revealed
// Hold means one strokeText (halo) + one fillText (digit). Path2D is absent in
// jsdom, so the glyph fill/stroke is skipped while the centred number still draws
// — which is exactly what these assertions rely on.
// ---------------------------------------------------------------------------

function makeCtx(width = 1000, height = 1000) {
  const strokeText = vi.fn();
  const fillText = vi.fn();
  const ctx = {
    canvas: { width, height } as HTMLCanvasElement,
    measureText: vi.fn(() => ({ width: 12 }) as TextMetrics),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText,
    strokeText,
    textAlign: "",
    textBaseline: "",
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "",
    miterLimit: 0,
    shadowColor: "",
    shadowBlur: 0,
    globalAlpha: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokeText, fillText };
}

const HOLDS: Hold[] = [
  { id: "hold-1", kind: "hand", side: "left", x: 250, y: 400, firstUseTime: 1, order: 1 },
  { id: "hold-2", kind: "foot", side: "right", x: 700, y: 800, firstUseTime: 2, order: 2 },
];

const BODY_SCALE = 100;

describe("drawHolds on-glyph numbering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws one digit (fill + halo) per revealed hold", () => {
    const { ctx, strokeText, fillText } = makeCtx();
    // Both holds revealed at t=5.
    drawHolds(ctx, HOLDS, 5, undefined, BODY_SCALE);
    expect(fillText).toHaveBeenCalledTimes(2);
    expect(strokeText).toHaveBeenCalledTimes(2);
    expect(fillText.mock.calls.map((c) => c[0])).toEqual(["1", "2"]);
  });

  it("reveals holds progressively by firstUseTime", () => {
    const { ctx, fillText } = makeCtx();
    // Only the first hold revealed (t=1.5 < hold-2 firstUseTime 2).
    drawHolds(ctx, HOLDS, 1.5, undefined, BODY_SCALE);
    expect(fillText).toHaveBeenCalledTimes(1);
    expect(fillText.mock.calls[0][0]).toBe("1");

    // Now both revealed.
    fillText.mockClear();
    drawHolds(ctx, HOLDS, 2.5, undefined, BODY_SCALE);
    expect(fillText).toHaveBeenCalledTimes(2);
  });

  it("draws nothing when holds are empty or hidden", () => {
    const { ctx, fillText } = makeCtx();
    drawHolds(ctx, [], 5, undefined, BODY_SCALE);
    drawHolds(ctx, HOLDS, 5, { holdsVisible: false }, BODY_SCALE);
    expect(fillText).not.toHaveBeenCalled();
  });

  it("drops holds whose point falls outside the canvas bounds", () => {
    const { ctx, fillText } = makeCtx();
    const offscreen: Hold[] = [
      { id: "a", kind: "hand", side: "left", x: -10, y: 400, firstUseTime: 1, order: 1 },
      { id: "b", kind: "hand", side: "right", x: 500, y: 500, firstUseTime: 1, order: 2 },
    ];
    drawHolds(ctx, offscreen, 5, undefined, BODY_SCALE);
    expect(fillText).toHaveBeenCalledTimes(1);
    expect(fillText.mock.calls[0][0]).toBe("2");
  });
});
