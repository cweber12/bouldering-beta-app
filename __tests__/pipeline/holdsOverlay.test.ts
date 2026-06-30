import { describe, it, expect, vi, beforeEach } from "vitest";
import { drawHolds, HOLD_RING_COLOR } from "@/pipeline/holdsOverlay";
import type { Hold } from "@/pipeline/holdDetection";

// ---------------------------------------------------------------------------
// drawHolds is a canvas routine; we feed it a minimal fake 2D context and spy on
// the arc + stroke calls. Each Hold marker is a thin colour-coded ring (blue =
// hand, orange = foot) with a clear interior — no number, no glyph (ADR 0012).
//
// A ring is one `arc` stroked once in the flat kind colour (no halo), so a single
// ring contributes one `arc` and one `stroke`. Coincident same-kind Holds collapse
// to one ring; a spot used by both a hand and a foot draws two concentric rings. We
// capture arc centres/radii and the strokeStyle at each stroke to assert position
// and colour.
// ---------------------------------------------------------------------------

function makeCtx(width = 1000, height = 1000) {
  const arcs: [number, number, number][] = [];
  const strokeColors: string[] = [];
  const arc = vi.fn((x: number, y: number, r: number) => arcs.push([x, y, r]));
  const ctx = {
    canvas: { width, height } as HTMLCanvasElement,
    measureText: vi.fn(() => ({ width: 12 }) as TextMetrics),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc,
    translate: vi.fn(),
    scale: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    stroke: vi.fn(() => strokeColors.push(ctx.strokeStyle)),
    textAlign: "",
    textBaseline: "",
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "",
    lineCap: "",
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, arcs, strokeColors, arc, stroke: ctx.stroke, fillText: ctx.fillText };
}

const HOLDS: Hold[] = [
  { id: "hold-1", kind: "hand", side: "left", x: 250, y: 400, firstUseTime: 1, order: 1 },
  { id: "hold-2", kind: "foot", side: "right", x: 700, y: 800, firstUseTime: 2, order: 2 },
];

const BODY_SCALE = 100;

describe("drawHolds colour-coded rings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws one ring per kind, coloured by kind, with no numbers or glyphs", () => {
    const { ctx, arc, stroke, fillText, strokeColors } = makeCtx();
    drawHolds(ctx, HOLDS, 5, undefined, BODY_SCALE);
    // Two separate spots → two rings, each stroked once (flat colour, no halo).
    expect(arc).toHaveBeenCalledTimes(2);
    expect(stroke).toHaveBeenCalledTimes(2);
    // No number digit and no glyph fill.
    expect(fillText).not.toHaveBeenCalled();
    // Both kind colours appear.
    expect(strokeColors).toContain(HOLD_RING_COLOR.hand);
    expect(strokeColors).toContain(HOLD_RING_COLOR.foot);
  });

  it("collapses coincident same-kind Holds into a single ring", () => {
    const { ctx, arc, stroke, strokeColors } = makeCtx();
    // Both hands on the same wall hold → two coincident Holds, one blue ring.
    const sameHold: Hold[] = [
      { id: "hold-1", kind: "hand", side: "right", x: 500, y: 500, firstUseTime: 1, order: 1 },
      { id: "hold-2", kind: "hand", side: "left", x: 505, y: 498, firstUseTime: 2, order: 2 },
    ];
    drawHolds(ctx, sameHold, 5, undefined, BODY_SCALE);
    expect(arc).toHaveBeenCalledTimes(1);
    expect(stroke).toHaveBeenCalledTimes(1);
    expect(strokeColors).toContain(HOLD_RING_COLOR.hand);
    expect(strokeColors).not.toContain(HOLD_RING_COLOR.foot);
  });

  it("draws concentric rings when one spot is used by both a hand and a foot", () => {
    const { ctx, arc, arcs, strokeColors } = makeCtx();
    const both: Hold[] = [
      { id: "hold-1", kind: "hand", side: "right", x: 500, y: 500, firstUseTime: 1, order: 1 },
      { id: "hold-2", kind: "foot", side: "left", x: 503, y: 502, firstUseTime: 2, order: 2 },
    ];
    drawHolds(ctx, both, 5, undefined, BODY_SCALE);
    // Two concentric rings on the shared centroid: same centre, different radii.
    expect(arc).toHaveBeenCalledTimes(2);
    const [hand, foot] = arcs; // hand ring is pushed first
    expect(hand[0]).toBeCloseTo(foot[0]); // same cx
    expect(hand[1]).toBeCloseTo(foot[1]); // same cy
    expect(foot[2]).toBeLessThan(hand[2]); // foot ring nests inside the hand ring
    expect(strokeColors).toContain(HOLD_RING_COLOR.hand);
    expect(strokeColors).toContain(HOLD_RING_COLOR.foot);
  });

  it("reveals rings progressively by firstUseTime", () => {
    const { ctx, arc } = makeCtx();
    // Only the first hold revealed (t=1.5 < hold-2 firstUseTime 2).
    drawHolds(ctx, HOLDS, 1.5, undefined, BODY_SCALE);
    expect(arc).toHaveBeenCalledTimes(1);

    arc.mockClear();
    drawHolds(ctx, HOLDS, 2.5, undefined, BODY_SCALE);
    expect(arc).toHaveBeenCalledTimes(2);
  });

  it("reveals each kind's ring at its own earliest use within a shared spot", () => {
    const { ctx, arc, strokeColors } = makeCtx();
    const both: Hold[] = [
      { id: "hold-1", kind: "hand", side: "right", x: 500, y: 500, firstUseTime: 1, order: 1 },
      { id: "hold-2", kind: "foot", side: "left", x: 503, y: 502, firstUseTime: 3, order: 2 },
    ];
    // t between the two: the hand ring shows, the foot ring is still hidden.
    drawHolds(ctx, both, 2, undefined, BODY_SCALE);
    expect(arc).toHaveBeenCalledTimes(1);
    expect(strokeColors).toContain(HOLD_RING_COLOR.hand);
    expect(strokeColors).not.toContain(HOLD_RING_COLOR.foot);
  });

  it("draws nothing when holds are empty or hidden", () => {
    const { ctx, arc } = makeCtx();
    drawHolds(ctx, [], 5, undefined, BODY_SCALE);
    drawHolds(ctx, HOLDS, 5, { holdsVisible: false }, BODY_SCALE);
    expect(arc).not.toHaveBeenCalled();
  });

  it("drops holds whose point falls outside the canvas bounds", () => {
    const { ctx, arc } = makeCtx();
    const offscreen: Hold[] = [
      { id: "a", kind: "hand", side: "left", x: -10, y: 400, firstUseTime: 1, order: 1 },
      { id: "b", kind: "hand", side: "right", x: 500, y: 500, firstUseTime: 1, order: 2 },
    ];
    drawHolds(ctx, offscreen, 5, undefined, BODY_SCALE);
    // Only the in-bounds hold draws a ring.
    expect(arc).toHaveBeenCalledTimes(1);
  });
});
