import { describe, it, expect, vi, beforeEach } from "vitest";
import { drawHolds } from "@/pipeline/holdsOverlay";
import type { Hold } from "@/pipeline/holdDetection";

// ---------------------------------------------------------------------------
// drawHolds is a canvas routine; we feed it a minimal fake 2D context and spy on
// the text + arc + stroke calls. Coincident Holds share ONE ring; each ring draws
// a single `arc` stroked twice (a dark halo + the white border). Each revealed
// Hold then draws a numbered glyph badge — a solid glyph (skipped here, Path2D is
// absent in jsdom) and the on-glyph number (one `fillText`). So a cluster of N
// Holds contributes one `arc`, two `stroke`s, and N `fillText`s; the glyph fill is
// what jsdom drops.
// ---------------------------------------------------------------------------

function makeCtx(width = 1000, height = 1000) {
  const fillText = vi.fn();
  const arc = vi.fn();
  const stroke = vi.fn();
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
    stroke,
    fillText,
    strokeText: vi.fn(),
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
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillText, arc, stroke };
}

const HOLDS: Hold[] = [
  { id: "hold-1", kind: "hand", side: "left", x: 250, y: 400, firstUseTime: 1, order: 1 },
  { id: "hold-2", kind: "foot", side: "right", x: 700, y: 800, firstUseTime: 2, order: 2 },
];

const BODY_SCALE = 100;

describe("drawHolds clustered rings + side badges", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws one ring per cluster and one number per revealed hold", () => {
    const { ctx, fillText, arc, stroke } = makeCtx();
    // Both holds revealed at t=5; they sit far apart, so two separate rings.
    drawHolds(ctx, HOLDS, 5, undefined, BODY_SCALE);
    expect(fillText).toHaveBeenCalledTimes(2);
    expect(fillText.mock.calls.map((c) => c[0])).toEqual(["1", "2"]);
    // One ring per cluster: one arc each, stroked twice (halo + white border).
    expect(arc).toHaveBeenCalledTimes(2);
    expect(stroke).toHaveBeenCalledTimes(4);
  });

  it("consolidates coincident holds into a single shared ring", () => {
    const { ctx, fillText, arc, stroke } = makeCtx();
    // Both hands on the same wall hold → two coincident Holds, one ring.
    const sameHold: Hold[] = [
      { id: "hold-1", kind: "hand", side: "right", x: 500, y: 500, firstUseTime: 1, order: 1 },
      { id: "hold-2", kind: "hand", side: "left", x: 505, y: 498, firstUseTime: 2, order: 2 },
    ];
    drawHolds(ctx, sameHold, 5, undefined, BODY_SCALE);
    // One shared ring (one arc, two strokes) but both badges drawn.
    expect(arc).toHaveBeenCalledTimes(1);
    expect(stroke).toHaveBeenCalledTimes(2);
    expect(fillText).toHaveBeenCalledTimes(2);
    // Badges land on opposite sides of the shared ring centre (~502).
    const [right, left] = fillText.mock.calls;
    expect(right[1]).toBeGreaterThan(520); // right limb → right arc
    expect(left[1]).toBeLessThan(490); // left limb → left arc
  });

  it("places each badge on its limb's side of the ring", () => {
    const { ctx, fillText } = makeCtx();
    drawHolds(ctx, HOLDS, 5, undefined, BODY_SCALE);
    const [c1, c2] = fillText.mock.calls;
    expect(c1[1]).toBeLessThan(250); // left hand → badge left of its ring
    expect(c2[1]).toBeGreaterThan(700); // right foot → badge right of its ring
  });

  it("reveals holds progressively by firstUseTime", () => {
    const { ctx, fillText, arc } = makeCtx();
    // Only the first hold revealed (t=1.5 < hold-2 firstUseTime 2).
    drawHolds(ctx, HOLDS, 1.5, undefined, BODY_SCALE);
    expect(fillText).toHaveBeenCalledTimes(1);
    expect(fillText.mock.calls[0][0]).toBe("1");
    // Only the revealed cluster's ring is drawn.
    expect(arc).toHaveBeenCalledTimes(1);

    fillText.mockClear();
    drawHolds(ctx, HOLDS, 2.5, undefined, BODY_SCALE);
    expect(fillText).toHaveBeenCalledTimes(2);
  });

  it("reveals a shared ring on its earliest member, then pops in later badges", () => {
    const { ctx, fillText, arc } = makeCtx();
    const sameHold: Hold[] = [
      { id: "hold-1", kind: "hand", side: "right", x: 500, y: 500, firstUseTime: 1, order: 1 },
      { id: "hold-2", kind: "hand", side: "left", x: 503, y: 502, firstUseTime: 3, order: 2 },
    ];
    // t between the two: ring shows (earliest member used), only badge 1 drawn.
    drawHolds(ctx, sameHold, 2, undefined, BODY_SCALE);
    expect(arc).toHaveBeenCalledTimes(1);
    expect(fillText).toHaveBeenCalledTimes(1);
    expect(fillText.mock.calls[0][0]).toBe("1");
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
