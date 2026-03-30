import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateOrbThumbnail } from "@/pipeline/orbThumbnail";
import type { OrbKeypoint } from "@/pipeline/orbDetector";

// ---------------------------------------------------------------------------
// Minimal canvas / context stubs
// ---------------------------------------------------------------------------

function makeMockCtx() {
  return {
    putImageData: vi.fn(),
    fillStyle: "",
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
  };
}

function makeMockCanvas(ctx: ReturnType<typeof makeMockCtx>) {
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => "data:image/png;base64,ABCD"),
  };
}

describe("generateOrbThumbnail", () => {
  let canvases: ReturnType<typeof makeMockCanvas>[];
  let ctxs: ReturnType<typeof makeMockCtx>[];
  const origCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    canvases = [];
    ctxs = [];
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        const ctx = makeMockCtx();
        const c = makeMockCanvas(ctx);
        ctxs.push(ctx);
        canvases.push(c);
        return c as unknown as HTMLElement;
      }
      return origCreateElement(tag);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws keypoints and returns a data URL", () => {
    const imageData = { data: new Uint8ClampedArray(4), width: 640, height: 480, colorSpace: "srgb" } as ImageData;
    const keypoints: OrbKeypoint[] = [
      { pt: { x: 100, y: 200 }, size: 1, angle: 0, response: 1, octave: 0 },
      { pt: { x: 300, y: 400 }, size: 1, angle: 0, response: 1, octave: 0 },
    ];

    const result = generateOrbThumbnail(imageData, keypoints);

    expect(result).toBe("data:image/png;base64,ABCD");
    // Two canvases: full + scaled thumb
    expect(canvases).toHaveLength(2);

    // Full-size canvas dimensions
    expect(canvases[0].width).toBe(640);
    expect(canvases[0].height).toBe(480);

    // putImageData called once with the source frame
    expect(ctxs[0].putImageData).toHaveBeenCalledOnce();

    // arc called once per keypoint on the thumbnail canvas with the fixed
    // DOT_RADIUS and scaled coordinates (scale = 320 / 640 = 0.5)
    expect(ctxs[1].arc).toHaveBeenCalledTimes(2);
    expect(ctxs[1].arc).toHaveBeenNthCalledWith(1, 50, 100, 2.5, 0, Math.PI * 2);
    expect(ctxs[1].arc).toHaveBeenNthCalledWith(2, 150, 200, 2.5, 0, Math.PI * 2);

    // Thumbnail canvas scaled to max 320 wide
    expect(canvases[1].width).toBe(320);
    expect(canvases[1].height).toBe(240);
  });

  it("returns empty string when context unavailable", () => {
    vi.restoreAllMocks();
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return { width: 0, height: 0, getContext: () => null } as unknown as HTMLElement;
      }
      return origCreateElement(tag);
    });

    const imageData = { data: new Uint8ClampedArray(4), width: 640, height: 480, colorSpace: "srgb" } as ImageData;
    expect(generateOrbThumbnail(imageData, [])).toBe("");
  });

  it("handles empty keypoints array", () => {
    const imageData = { data: new Uint8ClampedArray(4), width: 640, height: 480, colorSpace: "srgb" } as ImageData;
    const result = generateOrbThumbnail(imageData, []);
    expect(result).toBe("data:image/png;base64,ABCD");
    expect(ctxs[1].arc).not.toHaveBeenCalled();
  });
});
