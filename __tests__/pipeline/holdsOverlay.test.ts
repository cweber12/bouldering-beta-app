import { describe, it, expect, vi, beforeEach } from "vitest";
import { drawHolds } from "@/pipeline/holdsOverlay";
import type { Hold } from "@/pipeline/holdDetection";

// ---------------------------------------------------------------------------
// drawHolds is a canvas routine; we feed it a minimal fake 2D context and spy on
// the text + arc calls. Each revealed Hold draws one corner number badge: a white
// ring + a dark disc (two `arc` fills) and the number (one `fillText`), pinned up
// and to the right of the glyph. Path2D is absent in jsdom, so the opaque glyph
// itself is skipped while the badges still draw — which is what these assertions
// rely on.
// ---------------------------------------------------------------------------

function makeCtx(width = 1000, height = 1000) {
  const fillText = vi.fn();
  const arc = vi.fn();
  const ctx = {
    canvas: { width, height } as HTMLCanvasElement,
    measureText: vi.fn(() => ({ width: 12 }) as TextMetrics),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc,
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
    textAlign: "",
    textBaseline: "",
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "",
    lineCap: "",
    shadowColor: "",
    shadowBlur: 0,
    globalAlpha: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillText, arc };
}

const HOLDS: Hold[] = [
  { id: "hold-1", kind: "hand", side: "left", x: 250, y: 400, firstUseTime: 1, order: 1 },
  { id: "hold-2", kind: "foot", side: "right", x: 700, y: 800, firstUseTime: 2, order: 2 },
];

const BODY_SCALE = 100;

describe("drawHolds corner number badges", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws one number badge per revealed hold", () => {
    const { ctx, fillText, arc } = makeCtx();
    // Both holds revealed at t=5.
    drawHolds(ctx, HOLDS, 5, undefined, BODY_SCALE);
    expect(fillText).toHaveBeenCalledTimes(2);
    expect(fillText.mock.calls.map((c) => c[0])).toEqual(["1", "2"]);
    // Two arc fills per badge (white ring + dark disc).
    expect(arc).toHaveBeenCalledTimes(4);
  });

  it("pins each badge up and to the right of its glyph", () => {
    const { ctx, fillText } = makeCtx();
    drawHolds(ctx, HOLDS, 5, undefined, BODY_SCALE);
    const [c1, c2] = fillText.mock.calls;
    expect(c1[1]).toBeGreaterThan(250); // badge for "1" right of its glyph
    expect(c1[2]).toBeLessThan(400); //    ...and above it
    expect(c2[1]).toBeGreaterThan(700);
    expect(c2[2]).toBeLessThan(800);
  });

  it("reveals holds progressively by firstUseTime", () => {
    const { ctx, fillText } = makeCtx();
    // Only the first hold revealed (t=1.5 < hold-2 firstUseTime 2).
    drawHolds(ctx, HOLDS, 1.5, undefined, BODY_SCALE);
    expect(fillText).toHaveBeenCalledTimes(1);
    expect(fillText.mock.calls[0][0]).toBe("1");

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
