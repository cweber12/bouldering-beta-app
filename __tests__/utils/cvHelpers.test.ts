import { describe, it, expect, vi } from "vitest";
import { cropImageData, matDelete } from "@/utils/cvHelpers";

describe("matDelete", () => {
  it("calls .delete() on a valid Mat object", () => {
    const mat = { delete: vi.fn() };
    matDelete(mat);
    expect(mat.delete).toHaveBeenCalledOnce();
  });

  it("does not throw when passed null", () => {
    expect(() => matDelete(null)).not.toThrow();
  });

  it("does not throw when passed undefined", () => {
    expect(() => matDelete(undefined)).not.toThrow();
  });

  it("does not throw when .delete() itself throws (already freed)", () => {
    const mat = {
      delete: vi.fn().mockImplementation(() => {
        throw new Error("Mat already deleted");
      }),
    };
    expect(() => matDelete(mat)).not.toThrow();
  });

  it("does not call .delete() on null (no-op)", () => {
    // Verify the null guard short-circuits correctly.
    const mat = { delete: vi.fn() };
    matDelete(null);
    expect(mat.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cropImageData
// ---------------------------------------------------------------------------

function makeImageData(w: number, h: number, fillValue = 0xff): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = fillValue; // R
    data[i + 1] = fillValue; // G
    data[i + 2] = fillValue; // B
    data[i + 3] = 255;       // A
  }
  return { data, width: w, height: h, colorSpace: "srgb" } as unknown as ImageData;
}

describe("cropImageData", () => {
  it("returns a region with the correct dimensions", () => {
    const src = makeImageData(8, 8);
    const result = cropImageData(src, { x: 2, y: 2, width: 4, height: 3 });
    expect(result.width).toBe(4);
    expect(result.height).toBe(3);
  });

  it("copies pixel values from the correct source region", () => {
    // Build a 4×4 source where each pixel's R channel equals row index.
    const src = { width: 4, height: 4, colorSpace: "srgb", data: new Uint8ClampedArray(4 * 4 * 4) } as unknown as ImageData;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const idx = (row * 4 + col) * 4;
        src.data[idx]     = row;   // R = row index
        src.data[idx + 1] = col;   // G = col index
        src.data[idx + 2] = 0;
        src.data[idx + 3] = 255;
      }
    }

    // Crop the bottom-right 2×2 region: rows 2-3, cols 2-3.
    const result = cropImageData(src, { x: 2, y: 2, width: 2, height: 2 });

    // Pixel (0,0) of crop = source (row=2, col=2) → R=2, G=2
    expect(result.data[0]).toBe(2); // R
    expect(result.data[1]).toBe(2); // G
    // Pixel (0,1) of crop = source (row=2, col=3) → R=2, G=3
    expect(result.data[4]).toBe(2); // R
    expect(result.data[5]).toBe(3); // G
    // Pixel (1,0) of crop = source (row=3, col=2) → R=3, G=2
    expect(result.data[8]).toBe(3); // R
    expect(result.data[9]).toBe(2); // G
  });

  it("fills out-of-bounds pixels with transparent black", () => {
    const src = makeImageData(4, 4, 0xaa);
    // Crop box extends 2px beyond the right edge.
    const result = cropImageData(src, { x: 3, y: 0, width: 4, height: 1 });
    expect(result.width).toBe(4);
    // First pixel — col 3 (valid): R should be 0xaa
    expect(result.data[0]).toBe(0xaa);
    // Second pixel — col 4 (out of bounds): all channels should be 0
    expect(result.data[4]).toBe(0);
    expect(result.data[5]).toBe(0);
    expect(result.data[6]).toBe(0);
    expect(result.data[7]).toBe(0);
  });
});
