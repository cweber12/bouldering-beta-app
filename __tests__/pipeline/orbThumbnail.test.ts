import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateOrbThumbnail } from "@/pipeline/orbThumbnail";
import type { OrbFeatures } from "@/pipeline/orbDetector";

// ---------------------------------------------------------------------------
// Minimal canvas / context stubs
// ---------------------------------------------------------------------------

function makeMockCtx() {
  return {
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    strokeStyle: "",
    lineWidth: 0,
    strokeRect: vi.fn(),
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

  it("draws bounding box for cropBox and returns a data URL", () => {
    const imageData = { data: new Uint8ClampedArray(4), width: 640, height: 480, colorSpace: "srgb" } as ImageData;
    const features: OrbFeatures = {
      keypoints: [],
      descriptors: new Uint8Array(0),
      cropBox: { x: 100, y: 50, width: 300, height: 200, srcWidth: 640, srcHeight: 480 },
    };

    const result = generateOrbThumbnail(imageData, features);

    expect(result).toBe("data:image/png;base64,ABCD");
    // Two canvases: full + scaled thumb
    expect(canvases).toHaveLength(2);

    // Full-size canvas dimensions
    expect(canvases[0].width).toBe(640);
    expect(canvases[0].height).toBe(480);

    // putImageData called once with the source frame on the full canvas
    expect(ctxs[0].putImageData).toHaveBeenCalledOnce();

    // Thumbnail canvas scaled to max 320 wide
    expect(canvases[1].width).toBe(320);
    expect(canvases[1].height).toBe(240);

    // Scale is 0.5; bounding box drawn on thumbnail canvas at scaled coordinates
    expect(ctxs[1].strokeRect).toHaveBeenCalledWith(50, 25, 150, 100);
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
    const features: OrbFeatures = { keypoints: [], descriptors: new Uint8Array(0) };
    expect(generateOrbThumbnail(imageData, features)).toBe("");
  });

  it("skips strokeRect when no cropBox provided", () => {
    const imageData = { data: new Uint8ClampedArray(4), width: 640, height: 480, colorSpace: "srgb" } as ImageData;
    const features: OrbFeatures = { keypoints: [], descriptors: new Uint8Array(0) };
    const result = generateOrbThumbnail(imageData, features);
    expect(result).toBe("data:image/png;base64,ABCD");
    expect(ctxs[1].strokeRect).not.toHaveBeenCalled();
  });
});
