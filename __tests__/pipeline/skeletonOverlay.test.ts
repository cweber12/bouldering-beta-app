import { describe, it, expect } from "vitest";
import { lerpKeypoints } from "@/pipeline/skeletonOverlay";

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
