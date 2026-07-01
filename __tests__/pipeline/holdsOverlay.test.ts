import { describe, it, expect, vi, beforeEach } from "vitest";
import { drawHolds, HOLD_RING_COLOR } from "@/pipeline/holds/holdsOverlay";
import type { Hold } from "@/pipeline/holds/holdDetection";

// ---------------------------------------------------------------------------
// drawHolds is a canvas routine; we feed it a minimal fake 2D context and spy on
// the arc + stroke calls. Each Hold marker is a colour-coded ring (blue = hand,
// orange = foot) with a clear interior — no number, no glyph (ADR 0012).
//
// Each ring is drawn in two passes: an outer-only drop shadow (clipped to the region
// outside the ring) and a clean flat-colour stroke on top with the shadow cleared.
// We tell the passes apart by the `shadowBlur` recorded at each `stroke`: the clean
// pass strokes with blur 0, the shadow pass with blur > 0. One visible ring therefore
// contributes exactly one zero-blur stroke. Coincident same-kind Holds collapse to one
// ring; a spot used by both a hand and a foot draws two concentric rings. We capture
// arc centres/radii and the clean strokes to assert position and colour.
// ---------------------------------------------------------------------------

interface StrokeRecord {
  color: string;
  blur: number;
}

function makeCtx(width = 1000, height = 1000) {
  const arcs: [number, number, number][] = [];
  const strokes: StrokeRecord[] = [];
  const arc = vi.fn((x: number, y: number, r: number) => arcs.push([x, y, r]));
  const ctx = {
    canvas: { width, height } as HTMLCanvasElement,
    measureText: vi.fn(() => ({ width: 12 }) as TextMetrics),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    arc,
    translate: vi.fn(),
    scale: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    stroke: vi.fn(() => strokes.push({ color: ctx.strokeStyle, blur: ctx.shadowBlur })),
    textAlign: "",
    textBaseline: "",
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    shadowColor: "",
    shadowBlur: 0,
    lineJoin: "",
    lineCap: "",
  };
  // The clean (visible) stroke of each ring is the one drawn with no shadow.
  const ringColors = () => strokes.filter((s) => s.blur === 0).map((s) => s.color);
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    arcs,
    strokes,
    ringColors,
    arc,
    stroke: ctx.stroke,
    fillText: ctx.fillText,
  };
}

const HOLDS: Hold[] = [
  { id: "hold-1", kind: "hand", side: "left", x: 250, y: 400, firstUseTime: 1, order: 1 },
  { id: "hold-2", kind: "foot", side: "right", x: 700, y: 800, firstUseTime: 2, order: 2 },
];

const BODY_SCALE = 100;

describe("drawHolds colour-coded rings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws one ring per kind, coloured by kind, with no numbers or glyphs", () => {
    const { ctx, ringColors, fillText } = makeCtx();
    drawHolds(ctx, HOLDS, 5, undefined, BODY_SCALE);
    // Two separate spots → two visible rings (one clean stroke each).
    const colors = ringColors();
    expect(colors).toHaveLength(2);
    // No number digit and no glyph fill.
    expect(fillText).not.toHaveBeenCalled();
    // Both kind colours appear.
    expect(colors).toContain(HOLD_RING_COLOR.hand);
    expect(colors).toContain(HOLD_RING_COLOR.foot);
  });

  it("collapses coincident same-kind Holds into a single ring", () => {
    const { ctx, ringColors } = makeCtx();
    // Both hands on the same wall hold → two coincident Holds, one blue ring.
    const sameHold: Hold[] = [
      { id: "hold-1", kind: "hand", side: "right", x: 500, y: 500, firstUseTime: 1, order: 1 },
      { id: "hold-2", kind: "hand", side: "left", x: 505, y: 498, firstUseTime: 2, order: 2 },
    ];
    drawHolds(ctx, sameHold, 5, undefined, BODY_SCALE);
    const colors = ringColors();
    expect(colors).toHaveLength(1);
    expect(colors).toContain(HOLD_RING_COLOR.hand);
    expect(colors).not.toContain(HOLD_RING_COLOR.foot);
  });

  it("draws concentric rings when one spot is used by both a hand and a foot", () => {
    const { ctx, arcs, ringColors } = makeCtx();
    const both: Hold[] = [
      { id: "hold-1", kind: "hand", side: "right", x: 500, y: 500, firstUseTime: 1, order: 1 },
      { id: "hold-2", kind: "foot", side: "left", x: 503, y: 502, firstUseTime: 2, order: 2 },
    ];
    drawHolds(ctx, both, 5, undefined, BODY_SCALE);
    // Two visible concentric rings on the shared centroid: same centre, two radii.
    const colors = ringColors();
    expect(colors).toHaveLength(2);
    expect(colors).toContain(HOLD_RING_COLOR.hand);
    expect(colors).toContain(HOLD_RING_COLOR.foot);
    // Every ring arc shares the centroid; the foot ring nests inside the hand ring.
    const cxs = new Set(arcs.map((a) => a[0].toFixed(3)));
    const cys = new Set(arcs.map((a) => a[1].toFixed(3)));
    expect(cxs.size).toBe(1);
    expect(cys.size).toBe(1);
    const radii = [...new Set(arcs.map((a) => a[2]))].sort((p, q) => p - q);
    expect(radii).toHaveLength(2);
    expect(radii[0]).toBeLessThan(radii[1]); // foot ring inside the hand ring
  });

  it("reveals rings progressively by firstUseTime", () => {
    const { ctx, ringColors } = makeCtx();
    // Only the first hold revealed (t=1.5 < hold-2 firstUseTime 2).
    drawHolds(ctx, HOLDS, 1.5, undefined, BODY_SCALE);
    expect(ringColors()).toHaveLength(1);

    const second = makeCtx();
    drawHolds(second.ctx, HOLDS, 2.5, undefined, BODY_SCALE);
    expect(second.ringColors()).toHaveLength(2);
  });

  it("reveals each kind's ring at its own earliest use within a shared spot", () => {
    const { ctx, ringColors } = makeCtx();
    const both: Hold[] = [
      { id: "hold-1", kind: "hand", side: "right", x: 500, y: 500, firstUseTime: 1, order: 1 },
      { id: "hold-2", kind: "foot", side: "left", x: 503, y: 502, firstUseTime: 3, order: 2 },
    ];
    // t between the two: the hand ring shows, the foot ring is still hidden.
    drawHolds(ctx, both, 2, undefined, BODY_SCALE);
    const colors = ringColors();
    expect(colors).toHaveLength(1);
    expect(colors).toContain(HOLD_RING_COLOR.hand);
    expect(colors).not.toContain(HOLD_RING_COLOR.foot);
  });

  it("clips overlapping rings from different spots so their outlines never cross", () => {
    const { ctx, arcs, ringColors } = makeCtx();
    // Two separate spots (60px apart > cluster radius 45) whose rings still overlap
    // (centres < 2×45). Each must be clipped against the other's disc.
    const close: Hold[] = [
      { id: "a", kind: "hand", side: "left", x: 500, y: 500, firstUseTime: 1, order: 1 },
      { id: "b", kind: "foot", side: "left", x: 560, y: 500, firstUseTime: 1, order: 2 },
    ];
    drawHolds(ctx, close, 5, undefined, BODY_SCALE);
    // Still two distinct rings (not clustered into one spot).
    expect(ringColors()).toHaveLength(2);
    // Each ring is clipped against the other cluster's disc, so arcs are centred at
    // BOTH spots (an occluder arc at the neighbour's centre), proving the cross-clip.
    const cxs = new Set(arcs.map((a) => a[0]));
    expect(cxs).toContain(500);
    expect(cxs).toContain(560);
  });

  it("does not cross-clip concentric same-spot rings (no neighbour discs)", () => {
    const { ctx, arcs } = makeCtx();
    const both: Hold[] = [
      { id: "a", kind: "hand", side: "right", x: 500, y: 500, firstUseTime: 1, order: 1 },
      { id: "b", kind: "foot", side: "left", x: 503, y: 502, firstUseTime: 1, order: 2 },
    ];
    drawHolds(ctx, both, 5, undefined, BODY_SCALE);
    // Every arc shares the single centroid — no occluder arcs from a different spot.
    const cxs = new Set(arcs.map((a) => a[0].toFixed(3)));
    expect(cxs.size).toBe(1);
  });

  it("draws nothing when holds are empty or hidden", () => {
    const { ctx, arc } = makeCtx();
    drawHolds(ctx, [], 5, undefined, BODY_SCALE);
    drawHolds(ctx, HOLDS, 5, { holdsVisible: false }, BODY_SCALE);
    expect(arc).not.toHaveBeenCalled();
  });

  it("drops holds whose point falls outside the canvas bounds", () => {
    const { ctx, ringColors } = makeCtx();
    const offscreen: Hold[] = [
      { id: "a", kind: "hand", side: "left", x: -10, y: 400, firstUseTime: 1, order: 1 },
      { id: "b", kind: "hand", side: "right", x: 500, y: 500, firstUseTime: 1, order: 2 },
    ];
    drawHolds(ctx, offscreen, 5, undefined, BODY_SCALE);
    // Only the in-bounds hold draws a ring.
    expect(ringColors()).toHaveLength(1);
  });
});
