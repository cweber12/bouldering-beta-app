import { describe, it, expect, vi } from "vitest";
import { drawSkeleton, lerpKeypoints, type OverlayPoint } from "@/pipeline/overlay/skeletonOverlay";
import { computeContrastAdjust } from "@/pipeline/overlay/contrastAdapter";

describe("lerpKeypoints", () => {
  const a = { nose: { x: 0, y: 0 }, left_eye: { x: 10, y: 20 } };
  const b = { nose: { x: 100, y: 200 }, left_eye: { x: 30, y: 40 } };

  it("returns a when alpha is 0", () => {
    const result = lerpKeypoints(a, b, 0);
    expect(result.nose).toEqual({ x: 0, y: 0 });
    expect(result.left_eye).toEqual({ x: 10, y: 20 });
  });

  it("returns b when alpha is 1", () => {
    const result = lerpKeypoints(a, b, 1);
    expect(result.nose).toEqual({ x: 100, y: 200 });
    expect(result.left_eye).toEqual({ x: 30, y: 40 });
  });

  it("interpolates at alpha 0.5", () => {
    const result = lerpKeypoints(a, b, 0.5);
    expect(result.nose).toEqual({ x: 50, y: 100 });
    expect(result.left_eye).toEqual({ x: 20, y: 30 });
  });

  it("includes keys present only in a", () => {
    const result = lerpKeypoints({ a_only: { x: 5, y: 5 } }, {}, 0.5);
    expect(result.a_only).toEqual({ x: 5, y: 5 });
  });

  it("includes keys present only in b", () => {
    const result = lerpKeypoints({}, { b_only: { x: 7, y: 7 } }, 0.5);
    expect(result.b_only).toEqual({ x: 7, y: 7 });
  });
});

// ---------------------------------------------------------------------------
// Thread-through of the adaptive-contrast param. The adapter maths is covered at
// its pure seam (contrastAdapter.test.ts); here we only assert the param reaches
// the emitted colours and that omitting it reproduces today's output. We draw
// the joints pass alone (silhouette/lines off) against a mock 2D context.
// ---------------------------------------------------------------------------

function makeCtx(width = 1000, height = 1000) {
  const fills: string[] = [];
  const ctx = {
    canvas: { width, height } as HTMLCanvasElement,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(() => fills.push(String(ctx.fillStyle))),
    fillStyle: "" as string | CanvasGradient,
    strokeStyle: "" as string | CanvasGradient,
    globalAlpha: 1,
    lineWidth: 0,
    lineCap: "" as CanvasLineCap,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

describe("drawSkeleton adaptive contrast thread-through", () => {
  const keypoints: Record<string, OverlayPoint> = { nose: { x: 500, y: 500 } };
  const options = {
    silhouetteVisible: false,
    linesVisible: false,
    jointsVisible: true,
    // A chromatic joint colour so the thread-through is exercised (a neutral joint
    // is a deliberate anchor and is asserted separately below).
    jointColor: "#39B1D1",
    anatomicalPalette: false,
    bodyScale: 100,
  };

  it("reproduces the authored colour when no contrastAdjust is supplied", () => {
    const { ctx, fills } = makeCtx();
    drawSkeleton(ctx, keypoints, options);
    expect(fills).toContain("#39B1D1");
  });

  it("nudges the emitted colour when a contrastAdjust is supplied", () => {
    const { ctx, fills } = makeCtx();
    const contrastAdjust = computeContrastAdjust({ meanLuma: 0.5, stdLuma: 0 });
    drawSkeleton(ctx, keypoints, { ...options, contrastAdjust });
    expect(fills.length).toBeGreaterThan(0);
    expect(fills).not.toContain("#39B1D1");
  });

  it("leaves a neutral (white) joint anchor unadapted even with a contrastAdjust", () => {
    const { ctx, fills } = makeCtx();
    // A bright, busy wall would darken any chromatic colour — but the white joint
    // is a fixed neutral anchor (PRD) and must pass through unchanged.
    const contrastAdjust = computeContrastAdjust({ meanLuma: 0.85, stdLuma: 0.1 });
    const white = "rgba(255,255,255,0.9)";
    drawSkeleton(ctx, keypoints, { ...options, jointColor: white, contrastAdjust });
    expect(fills).toContain(white);
  });
});
