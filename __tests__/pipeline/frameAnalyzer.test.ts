import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeFrame } from "@/pipeline/frameAnalyzer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeImageData(w = 64, h = 64): ImageData {
  return {
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
    colorSpace: "srgb",
  } as unknown as ImageData;
}

function makeMat(meanVal = 128, stdVal = 40, hfStdVal = 10) {
  return {
    data64F: new Float64Array([meanVal]),
    delete: vi.fn(),
  };
}

function makeCv(opts: { mean?: number; std?: number; hfStd?: number } = {}) {
  const { mean = 128, std = 40, hfStd = 10 } = opts;
  let meanStdDevCallCount = 0;

  const cv = {
    COLOR_RGBA2GRAY: 7,
    CV_8UC1: 0,
    matFromImageData: vi.fn().mockImplementation(() => ({ delete: vi.fn() })),
    cvtColor: vi.fn(),
    GaussianBlur: vi.fn(),
    addWeighted: vi.fn(),
    meanStdDev: vi.fn().mockImplementation((_src, meanMat, stdMat) => {
      const isHfCall = meanStdDevCallCount > 0;
      meanMat.data64F[0] = isHfCall ? 128 : mean;
      stdMat.data64F[0]  = isHfCall ? hfStd : std;
      meanStdDevCallCount++;
    }),
    Mat: vi.fn().mockImplementation(function () {
      return { data64F: new Float64Array([0]), delete: vi.fn() };
    }),
    Size: vi.fn().mockImplementation(function (w: number, h: number) {
      return { width: w, height: h };
    }),
  };

  return cv;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// analyzeFrame — overall stats
// ---------------------------------------------------------------------------

describe("analyzeFrame — overall stats", () => {
  it("classifies a well-exposed frame as normal", () => {
    const cv = makeCv({ mean: 128, std: 45, hfStd: 10 });
    const result = analyzeFrame(cv, makeImageData());
    expect(result.isOverexposed).toBe(false);
    expect(result.isUnderexposed).toBe(false);
    expect(result.isLowContrast).toBe(false);
    expect(result.isBlurry).toBe(false);
    expect(result.suggestedGamma).toBe(1.0);
    expect(result.contrastAlpha).toBe(0);
  });

  it("flags overexposed frame (mean > 195)", () => {
    const cv = makeCv({ mean: 210, std: 45, hfStd: 10 });
    const result = analyzeFrame(cv, makeImageData());
    expect(result.isOverexposed).toBe(true);
    expect(result.isUnderexposed).toBe(false);
    expect(result.suggestedGamma).toBeLessThan(1.0);
  });

  it("flags underexposed frame (mean < 60)", () => {
    const cv = makeCv({ mean: 40, std: 45, hfStd: 10 });
    const result = analyzeFrame(cv, makeImageData());
    expect(result.isUnderexposed).toBe(true);
    expect(result.isOverexposed).toBe(false);
    expect(result.suggestedGamma).toBeGreaterThan(1.0);
  });

  it("flags low contrast (stdDev < 30)", () => {
    const cv = makeCv({ mean: 128, std: 20, hfStd: 10 });
    const result = analyzeFrame(cv, makeImageData());
    expect(result.isLowContrast).toBe(true);
    expect(result.contrastAlpha).toBeGreaterThan(0);
  });

  it("flags blurry frame (sharpness < 60)", () => {
    // hfStd=7 → sharpness = 7²=49 < 60 threshold
    const cv = makeCv({ mean: 128, std: 45, hfStd: 7 });
    const result = analyzeFrame(cv, makeImageData());
    expect(result.isBlurry).toBe(true);
  });

  it("does not flag sharp frame (sharpness >= 60)", () => {
    // hfStd=8 → sharpness = 8²=64 >= 60
    const cv = makeCv({ mean: 128, std: 45, hfStd: 8 });
    const result = analyzeFrame(cv, makeImageData());
    expect(result.isBlurry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// analyzeFrame — backlit detection (requires climber crop)
// ---------------------------------------------------------------------------

describe("analyzeFrame — backlit detection", () => {
  it("does not set isBacklit without climber crop", () => {
    const cv = makeCv({ mean: 200, std: 45, hfStd: 10 });
    const result = analyzeFrame(cv, makeImageData());
    expect(result.isBacklit).toBe(false);
    expect(result.climber).toBeNull();
  });

  it("sets isBacklit when overall mean minus climber mean > 65", () => {
    // First call: overall stats → mean=200, second call: climber crop stats → mean=120
    let callCount = 0;
    const cv = {
      COLOR_RGBA2GRAY: 7,
      CV_8UC1: 0,
      matFromImageData: vi.fn().mockImplementation(() => ({ delete: vi.fn() })),
      cvtColor: vi.fn(),
      GaussianBlur: vi.fn(),
      addWeighted: vi.fn(),
      meanStdDev: vi.fn().mockImplementation((_src, meanMat, stdMat) => {
        // Each analyzeFrame region invokes meanStdDev twice (once for stats, once for hf)
        const regionIndex = Math.floor(callCount / 2);
        meanMat.data64F[0] = regionIndex === 0 ? 200 : 120; // overall=200, climber=120
        stdMat.data64F[0]  = 10;
        callCount++;
      }),
      Mat: vi.fn().mockImplementation(function () {
        return { data64F: new Float64Array([0]), delete: vi.fn() };
      }),
      Size: vi.fn().mockImplementation(function (w: number, h: number) {
        return { width: w, height: h };
      }),
    };

    const result = analyzeFrame(
      cv,
      makeImageData(200, 200),
      { x: 50, y: 50, width: 100, height: 100 },
    );

    expect(result.isBacklit).toBe(true);
    expect(result.suggestedGamma).toBeGreaterThanOrEqual(1.35);
  });
});

// ---------------------------------------------------------------------------
// analyzeFrame — gamma derivation
// ---------------------------------------------------------------------------

describe("analyzeFrame — gamma derivation", () => {
  it("returns gamma=1.0 for a well-exposed frame", () => {
    const cv = makeCv({ mean: 128, std: 50, hfStd: 10 });
    const { suggestedGamma } = analyzeFrame(cv, makeImageData());
    expect(suggestedGamma).toBe(1.0);
  });

  it("gamma compression is capped at minimum 0.55 for severe overexposure", () => {
    const cv = makeCv({ mean: 255, std: 50, hfStd: 10 });
    const { suggestedGamma } = analyzeFrame(cv, makeImageData());
    expect(suggestedGamma).toBeGreaterThanOrEqual(0.55);
    expect(suggestedGamma).toBeLessThan(1.0);
  });

  it("gamma lift is capped at maximum 1.6 for severe underexposure", () => {
    const cv = makeCv({ mean: 0, std: 50, hfStd: 10 });
    const { suggestedGamma } = analyzeFrame(cv, makeImageData());
    expect(suggestedGamma).toBeGreaterThan(1.0);
    expect(suggestedGamma).toBeLessThanOrEqual(1.6);
  });
});

// ---------------------------------------------------------------------------
// analyzeFrame — contrastAlpha derivation
// ---------------------------------------------------------------------------

describe("analyzeFrame — contrastAlpha", () => {
  it("highest alpha (0.65) for very flat histogram (stdDev < 20)", () => {
    const cv = makeCv({ mean: 128, std: 15, hfStd: 10 });
    const { contrastAlpha } = analyzeFrame(cv, makeImageData());
    expect(contrastAlpha).toBe(0.65);
  });

  it("moderate alpha (0.45) for moderately flat histogram (20 <= stdDev < 30)", () => {
    const cv = makeCv({ mean: 128, std: 25, hfStd: 10 });
    const { contrastAlpha } = analyzeFrame(cv, makeImageData());
    expect(contrastAlpha).toBe(0.45);
  });

  it("no alpha (0) for well-contrasted, well-exposed frame", () => {
    const cv = makeCv({ mean: 128, std: 50, hfStd: 10 });
    const { contrastAlpha } = analyzeFrame(cv, makeImageData());
    expect(contrastAlpha).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// analyzeFrame — null fields without crops
// ---------------------------------------------------------------------------

describe("analyzeFrame — optional crop fields", () => {
  it("returns null for climber and wall when no crops provided", () => {
    const cv = makeCv();
    const result = analyzeFrame(cv, makeImageData());
    expect(result.climber).toBeNull();
    expect(result.wall).toBeNull();
  });

  it("computes wall stats when wallCropPx is provided", () => {
    const cv = makeCv({ mean: 128, std: 50, hfStd: 10 });
    const result = analyzeFrame(
      cv,
      makeImageData(200, 200),
      undefined,
      { x: 10, y: 10, width: 80, height: 80 },
    );
    expect(result.wall).not.toBeNull();
    expect(typeof result.wall!.mean).toBe("number");
  });
});
