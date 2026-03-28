import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyFramePreprocessing } from "@/pipeline/framePreprocessor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCanvas(w = 100, h = 80): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  // The global vitest setup stubs canvas.getContext to return null.
  // Override per-canvas so applyFramePreprocessing can proceed past the
  // early-return guard and exercise the OpenCV mocks.
  const fakeImageData = {
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
    colorSpace: "srgb",
  } as unknown as ImageData;
  const ctx: Partial<CanvasRenderingContext2D> = {
    getImageData: vi.fn().mockReturnValue(fakeImageData),
    putImageData: vi.fn(),
    createImageData: vi.fn().mockReturnValue(fakeImageData),
  };
  canvas.getContext = vi.fn().mockReturnValue(ctx) as unknown as typeof canvas.getContext;
  return canvas;
}

function makeCv() {
  const matInstance = {
    data: new Uint8Array(100 * 80),
    delete: vi.fn(),
  };

  const claheInst = { apply: vi.fn(), delete: vi.fn() };

  const cv = {
    COLOR_RGBA2GRAY: 7,
    CV_8UC1: 0,
    matFromImageData: vi.fn().mockImplementation(() => ({ ...matInstance, delete: vi.fn() })),
    cvtColor: vi.fn(),
    equalizeHist: vi.fn(),
    imshow: vi.fn(),
    // Must use `function` keyword for constructors.
    Mat: vi.fn().mockImplementation(function (..._args: unknown[]) {
      return { data: new Uint8Array(256), delete: vi.fn() };
    }),
    Size: vi.fn().mockImplementation(function (w: number, h: number) {
      return { width: w, height: h };
    }),
    createCLAHE: vi.fn().mockReturnValue(claheInst),
    LUT: vi.fn(),
    GaussianBlur: vi.fn(),
    addWeighted: vi.fn(),
    // Exposed for assertions
    _clahe: claheInst,
  };

  return cv;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// No-op cases
// ---------------------------------------------------------------------------

describe("applyFramePreprocessing — no-op cases", () => {
  it("does nothing when conditions is empty", () => {
    const cv = makeCv();
    const canvas = makeCanvas();
    applyFramePreprocessing(cv, canvas, new Set());
    expect(cv.matFromImageData).not.toHaveBeenCalled();
  });

  it("does nothing when conditions contains only unknown labels", () => {
    const cv = makeCv();
    const canvas = makeCanvas();
    applyFramePreprocessing(cv, canvas, new Set(["unknown_condition"]));
    expect(cv.matFromImageData).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CLAHE conditions
// ---------------------------------------------------------------------------

describe("applyFramePreprocessing — CLAHE conditions", () => {
  it("creates CLAHE for washed_out", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["washed_out"]));
    expect(cv.createCLAHE).toHaveBeenCalledOnce();
    expect(cv._clahe.apply).toHaveBeenCalledOnce();
    expect(cv._clahe.delete).toHaveBeenCalledOnce();
  });

  it("creates CLAHE for backlit", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["backlit"]));
    expect(cv.createCLAHE).toHaveBeenCalledOnce();
  });

  it("creates CLAHE for shadows", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["shadows"]));
    expect(cv.createCLAHE).toHaveBeenCalledOnce();
  });

  it("creates CLAHE for blends", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["blends"]));
    expect(cv.createCLAHE).toHaveBeenCalledOnce();
  });

  it("creates CLAHE for indoor_gym", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["indoor_gym"]));
    expect(cv.createCLAHE).toHaveBeenCalledOnce();
  });

  it("uses clipLimit=3 for shadows, 2 for other CLAHE conditions", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["shadows"]));
    // First arg to createCLAHE is clipLimit.
    expect(cv.createCLAHE).toHaveBeenCalledWith(3.0, expect.anything());

    cv.createCLAHE.mockClear();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["washed_out"]));
    expect(cv.createCLAHE).toHaveBeenCalledWith(2.0, expect.anything());
  });

  it("uses tileSize=16 for indoor_gym, 8 for other CLAHE conditions", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["indoor_gym"]));
    // Second arg is a Size instance — check it was created with 16, 16.
    expect(cv.Size).toHaveBeenCalledWith(16, 16);

    cv.Size.mockClear();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["washed_out"]));
    expect(cv.Size).toHaveBeenCalledWith(8, 8);
  });
});

// ---------------------------------------------------------------------------
// Gamma boost (backlit only)
// ---------------------------------------------------------------------------

describe("applyFramePreprocessing — gamma boost", () => {
  it("applies LUT gamma correction for backlit", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["backlit"]));
    expect(cv.LUT).toHaveBeenCalledOnce();
  });

  it("does NOT apply LUT for washed_out (no gamma)", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["washed_out"]));
    expect(cv.LUT).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Unsharp masking (dusty)
// ---------------------------------------------------------------------------

describe("applyFramePreprocessing — unsharp masking", () => {
  it("applies GaussianBlur + addWeighted for dusty", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["dusty"]));
    expect(cv.GaussianBlur).toHaveBeenCalledOnce();
    expect(cv.addWeighted).toHaveBeenCalledOnce();
  });

  it("passes weight 1.5 / -0.5 to addWeighted for unsharp mask", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["dusty"]));
    // addWeighted(src, alpha, blurred, beta, gamma_val, dst)
    const [, alpha, , beta] = cv.addWeighted.mock.calls[0] as number[];
    expect(alpha).toBeCloseTo(1.5);
    expect(beta).toBeCloseTo(-0.5);
  });

  it("does NOT apply GaussianBlur for non-dusty condition", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["shadows"]));
    expect(cv.GaussianBlur).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Combined conditions
// ---------------------------------------------------------------------------

describe("applyFramePreprocessing — combined conditions", () => {
  it("applies both CLAHE and unsharp masking when dusty + washed_out", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["dusty", "washed_out"]));
    expect(cv.createCLAHE).toHaveBeenCalledOnce();
    expect(cv.GaussianBlur).toHaveBeenCalledOnce();
  });

  it("applies CLAHE, gamma, and unsharp for backlit + dusty", () => {
    const cv = makeCv();
    applyFramePreprocessing(cv, makeCanvas(), new Set(["backlit", "dusty"]));
    expect(cv.createCLAHE).toHaveBeenCalledOnce();
    expect(cv.LUT).toHaveBeenCalledOnce();
    expect(cv.GaussianBlur).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// imshow and canvas write-back
// ---------------------------------------------------------------------------

describe("applyFramePreprocessing — canvas write-back", () => {
  it("calls cv.imshow with the canvas to commit the result", () => {
    const cv = makeCv();
    const canvas = makeCanvas();
    applyFramePreprocessing(cv, canvas, new Set(["washed_out"]));
    expect(cv.imshow).toHaveBeenCalledOnce();
    expect(cv.imshow).toHaveBeenCalledWith(canvas, expect.anything());
  });
});
