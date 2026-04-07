import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractFeatures, extractFeaturesFromCrop, matchOrbFeatures, buildClimberExclusionMask, extractFeaturesExcludingClimber } from "@/pipeline/orbDetector";
import type { OrbFeatures, OrbCropBox, NormalizedPoint } from "@/pipeline/orbDetector";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
// Arrow functions CANNOT be used as constructors — Vitest enforces this.
// All OpenCV types that the source calls with `new` MUST use the `function`
// keyword (not `=>`) in their mockImplementation.

function makeMockMat(data?: Uint8Array) {
  const buf = data ?? new Uint8Array(512);
  return { data: buf, delete: vi.fn(), empty: vi.fn().mockReturnValue(false) };
}

function makeMockKpVec(kps: Array<{ x: number; y: number }>) {
  return {
    size: vi.fn().mockReturnValue(kps.length),
    get: vi.fn((i: number) => ({
      pt: { x: kps[i].x, y: kps[i].y },
      size: 3,
      angle: 45,
      response: 0.9,
      octave: 0,
    })),
    delete: vi.fn(),
  };
}

type Pair = Array<{ distance: number; queryIdx: number; trainIdx: number }>;

function makeMockDMatch(pairs: Pair[]) {
  return {
    size: vi.fn().mockReturnValue(pairs.length),
    get: vi.fn((i: number) => ({
      size: vi.fn().mockReturnValue(pairs[i].length),
      get: vi.fn((j: number) => pairs[i][j]),
    })),
    delete: vi.fn(),
  };
}

function makeMockCv(
  opts: {
    keypoints?: Array<{ x: number; y: number }>;
    descriptorData?: Uint8Array;
    matchPairs?: Pair[];
  } = {},
) {
  const kps = opts.keypoints ?? [{ x: 10, y: 20 }];
  const descData =
    opts.descriptorData ?? new Uint8Array(kps.length * 32).fill(0xab);
  const pairs = opts.matchPairs ?? [];

  // Track Mat instances so tests can verify .delete() was called.
  const matInstances: ReturnType<typeof makeMockMat>[] = [];

  const kpVec = makeMockKpVec(kps);
  const descMat = makeMockMat(descData);

  const bfKnnMatcher = {
    knnMatch: vi.fn(function (
      _d1: unknown,
      _d2: unknown,
      out: ReturnType<typeof makeMockDMatch>,
      _k: number,
    ) {
      Object.assign(out, makeMockDMatch(pairs));
    }),
    delete: vi.fn(),
  };

  const orbInst = {
    detectAndCompute: vi.fn(function (
      _gray: unknown,
      _mask: unknown,
      _kpv: unknown,
      dst: ReturnType<typeof makeMockMat>,
    ) {
      Object.assign(dst, descMat);
    }),
    delete: vi.fn(),
  };

  // NOTE: mockImplementation must use `function` keyword, not `=>`, for
  // anything called with `new`. Arrow functions are not constructors.
  return {
    COLOR_RGBA2GRAY: 7,
    NORM_HAMMING: 6,
    CV_8UC1: 0,
    CV_32FC2: 13,
    RANSAC: 8,
    // Plain call-site functions (no `new`) — arrow functions are fine here.
    matFromImageData: vi.fn().mockImplementation(() => makeMockMat()),
    matFromArray: vi.fn().mockImplementation(() => makeMockMat()),
    cvtColor: vi.fn(),
    equalizeHist: vi.fn(),
    findHomography: vi.fn().mockReturnValue(null),
    // Constructors — MUST use `function` keyword.
    Mat: vi.fn().mockImplementation(function (..._args: unknown[]) {
      const m = makeMockMat();
      matInstances.push(m);
      return m;
    }),
    KeyPointVector: vi.fn().mockImplementation(function () {
      return kpVec;
    }),
    ORB: vi.fn().mockImplementation(function () {
      return orbInst;
    }),
    BFMatcher: vi.fn().mockImplementation(function () {
      return bfKnnMatcher;
    }),
    DMatchVectorVector: vi.fn().mockImplementation(function () {
      return makeMockDMatch(pairs);
    }),
    // Exposed for assertions
    _kpVec: kpVec,
    _descMat: descMat,
    _matInstances: matInstances,
    _bfMatcher: bfKnnMatcher,
    _orb: orbInst,
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function fakeImageData(w = 4, h = 4): ImageData {
  return {
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
    colorSpace: "srgb",
  } as ImageData;
}

function makeFeatures(nKp: number): OrbFeatures {
  return {
    keypoints: Array.from({ length: nKp }, (_, i) => ({
      pt: { x: i * 10, y: i * 5 },
      size: 3,
      angle: 0,
      response: 0.8,
      octave: 0,
    })),
    descriptors: new Uint8Array(nKp * 32).fill(0xff),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// extractFeatures
// ---------------------------------------------------------------------------

describe("extractFeatures", () => {
  it("returns keypoints and descriptors from the mock cv", () => {
    const cv = makeMockCv({
      keypoints: [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ],
    });
    const result = extractFeatures(cv, fakeImageData());

    expect(result.keypoints).toHaveLength(2);
    expect(result.keypoints[0]).toMatchObject({
      pt: { x: 10, y: 20 },
      size: 3,
      angle: 45,
      response: 0.9,
      octave: 0,
    });
    expect(result.descriptors).toBeInstanceOf(Uint8Array);
  });

  it("calls cvtColor to convert RGBA to grayscale", () => {
    const cv = makeMockCv();
    extractFeatures(cv, fakeImageData());
    expect(cv.cvtColor).toHaveBeenCalledOnce();
  });

  it("calls equalizeHist when normalizePixels=true (default)", () => {
    const cv = makeMockCv();
    extractFeatures(cv, fakeImageData());
    expect(cv.equalizeHist).toHaveBeenCalledOnce();
  });

  it("skips equalizeHist when normalizePixels=false", () => {
    const cv = makeMockCv();
    extractFeatures(cv, fakeImageData(), false);
    expect(cv.equalizeHist).not.toHaveBeenCalled();
  });

  it("frees all OpenCV objects in the finally block", () => {
    const cv = makeMockCv();
    extractFeatures(cv, fakeImageData());

    expect(cv._orb.delete).toHaveBeenCalled();
    expect(cv._kpVec.delete).toHaveBeenCalled();
    const srcMat = cv.matFromImageData.mock.results[0]
      .value as ReturnType<typeof makeMockMat>;
    expect(srcMat.delete).toHaveBeenCalled();
  });

  it("propagates errors from ORB detection and still frees source mat", () => {
    const cv = makeMockCv();
    cv.ORB = vi.fn().mockImplementation(function () {
      return {
        detectAndCompute: vi.fn().mockImplementation(function () {
          throw new Error("ORB boom");
        }),
        delete: vi.fn(),
      };
    });

    expect(() => extractFeatures(cv, fakeImageData())).toThrow("ORB boom");
    const srcMat = cv.matFromImageData.mock.results[0]
      .value as ReturnType<typeof makeMockMat>;
    expect(srcMat.delete).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// matchOrbFeatures
// ---------------------------------------------------------------------------

describe("matchOrbFeatures", () => {
  it("returns an empty array when ref has 0 keypoints", () => {
    const cv = makeMockCv();
    expect(matchOrbFeatures(cv, makeFeatures(0), makeFeatures(5))).toEqual([]);
    expect(cv.BFMatcher).not.toHaveBeenCalled();
  });

  it("returns an empty array when query has fewer than 2 rows", () => {
    const cv = makeMockCv();
    expect(matchOrbFeatures(cv, makeFeatures(5), makeFeatures(1))).toEqual([]);
  });

  it("returns matches that pass the Lowe ratio test (20 < 0.75 * 80)", () => {
    const pairs: Pair[] = [
      [
        { distance: 20, queryIdx: 0, trainIdx: 1 },
        { distance: 80, queryIdx: 0, trainIdx: 2 },
      ],
    ];
    const cv = makeMockCv({ matchPairs: pairs });
    const result = matchOrbFeatures(cv, makeFeatures(3), makeFeatures(3));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ queryIdx: 0, trainIdx: 1, distance: 20 });
  });

  it("filters out matches that fail the Lowe ratio test (50 >= 0.75 * 60)", () => {
    const pairs: Pair[] = [
      [
        { distance: 50, queryIdx: 0, trainIdx: 1 },
        { distance: 60, queryIdx: 0, trainIdx: 2 },
      ],
    ];
    const cv = makeMockCv({ matchPairs: pairs });
    expect(matchOrbFeatures(cv, makeFeatures(3), makeFeatures(3))).toEqual([]);
  });

  it("frees BFMatcher and descriptor Mats in the finally block", () => {
    const cv = makeMockCv({ matchPairs: [] });
    matchOrbFeatures(cv, makeFeatures(3), makeFeatures(3));

    expect(cv._bfMatcher.delete).toHaveBeenCalled();
    for (const m of cv._matInstances) {
      expect(m.delete).toHaveBeenCalled();
    }
  });
});

// ---------------------------------------------------------------------------
// extractFeaturesFromCrop
// ---------------------------------------------------------------------------

describe("extractFeaturesFromCrop", () => {
  it("offsets returned keypoints by the crop box origin", () => {
    const kps = [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ];
    const cv = makeMockCv({ keypoints: kps, descriptorData: new Uint8Array(kps.length * 32).fill(0xab) });

    const cropBox: OrbCropBox = {
      x: 100,
      y: 50,
      width: 200,
      height: 300,
      srcWidth: 640,
      srcHeight: 480,
    };

    const src = fakeImageData(640, 480);
    const result = extractFeaturesFromCrop(cv, src, cropBox);

    // Keypoints from extractFeatures are relative to the crop; they must be
    // shifted by (cropBox.x, cropBox.y) back to full-frame space.
    expect(result.keypoints[0].pt).toEqual({ x: kps[0].x + cropBox.x, y: kps[0].y + cropBox.y });
    expect(result.keypoints[1].pt).toEqual({ x: kps[1].x + cropBox.x, y: kps[1].y + cropBox.y });
  });

  it("stores the cropBox on the returned OrbFeatures", () => {
    const cv = makeMockCv({ keypoints: [{ x: 5, y: 5 }] });
    const cropBox: OrbCropBox = { x: 20, y: 10, width: 100, height: 80, srcWidth: 320, srcHeight: 240 };
    const result = extractFeaturesFromCrop(cv, fakeImageData(), cropBox);
    expect(result.cropBox).toEqual(cropBox);
  });

  it("preserves the descriptor bytes from the underlying extractFeatures call", () => {
    const descData = new Uint8Array(32).fill(0xcc);
    const cv = makeMockCv({ keypoints: [{ x: 0, y: 0 }], descriptorData: descData });
    const cropBox: OrbCropBox = { x: 0, y: 0, width: 4, height: 4, srcWidth: 4, srcHeight: 4 };
    const result = extractFeaturesFromCrop(cv, fakeImageData(), cropBox);
    expect(result.descriptors).toEqual(descData);
  });
});

// ---------------------------------------------------------------------------
// buildClimberExclusionMask
// ---------------------------------------------------------------------------

/** Extend the base mock cv with convex hull / dilate / bitwise_not support. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMaskCv(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cv = makeMockCv() as Record<string, any>;

  const resultMat = makeMockMat();
  const zerosMat = makeMockMat();

  // Additional constructors/functions needed by buildClimberExclusionMask.
  cv.CV_32SC2 = 14;
  cv.MORPH_ELLIPSE = 2;
  cv.FILLED = -1;
  cv.Scalar = vi.fn().mockImplementation(function (v: number) { return { val: v }; });
  cv.Size = vi.fn().mockImplementation(function (w: number, h: number) { return { width: w, height: h }; });

  // Mat.zeros is called with `new` in source — must use `function` keyword.
  cv.Mat.zeros = vi.fn().mockImplementation(function () { return zerosMat; });

  // MatVector used for drawContours.
  cv.MatVector = vi.fn().mockImplementation(function () {
    return { push_back: vi.fn(), delete: vi.fn() };
  });

  cv.convexHull = vi.fn();
  cv.drawContours = vi.fn();
  cv.getStructuringElement = vi.fn().mockReturnValue(makeMockMat());
  cv.dilate = vi.fn();
  cv.bitwise_not = vi.fn();

  // These are the mats we can inspect for cleanup.
  cv._resultMat = resultMat;
  cv._zerosMat = zerosMat;

  return cv;
}

describe("buildClimberExclusionMask", () => {
  it("returns a white mask when fewer than 3 landmarks", () => {
    const cv = makeMaskCv();
    const twoLandmarks: NormalizedPoint[] = [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }];
    const mask = buildClimberExclusionMask(cv, 100, 100, twoLandmarks);
    // Should construct a white-filled Mat via Scalar(255), not use convexHull.
    expect(cv.convexHull).not.toHaveBeenCalled();
    expect(mask).toBeDefined();
    mask.delete();
  });

  it("builds a convex hull from ≥ 3 landmarks and inverts via bitwise_not", () => {
    const cv = makeMaskCv();
    const landmarks: NormalizedPoint[] = [
      { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.8 },
      { x: 0.9, y: 0.3 },
    ];
    buildClimberExclusionMask(cv, 200, 200, landmarks);
    expect(cv.convexHull).toHaveBeenCalledOnce();
    expect(cv.drawContours).toHaveBeenCalledOnce();
    expect(cv.dilate).toHaveBeenCalledOnce();
    expect(cv.bitwise_not).toHaveBeenCalledOnce();
  });

  it("converts normalised landmarks to integer pixel coordinates", () => {
    const cv = makeMaskCv();
    const landmarks: NormalizedPoint[] = [
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.1 },
      { x: 0.5, y: 0.9 },
    ];
    buildClimberExclusionMask(cv, 400, 200, landmarks);
    // matFromArray should receive pixel ints: [100, 100, 300, 20, 200, 180]
    const call = cv.matFromArray.mock.calls[0];
    expect(call[0]).toBe(3); // nRows
    expect(call[3]).toEqual([100, 100, 300, 20, 200, 180]);
  });

  it("frees intermediate Mats (hull, points, dilateKernel) in finally", () => {
    const cv = makeMaskCv();
    const landmarks: NormalizedPoint[] = [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.5 },
      { x: 0.9, y: 0.1 },
    ];
    buildClimberExclusionMask(cv, 100, 100, landmarks);
    // matFromArray creates 'points' — freed in finally.
    const pointsMat = cv.matFromArray.mock.results[0].value as ReturnType<typeof makeMockMat>;
    expect(pointsMat.delete).toHaveBeenCalled();
    // getStructuringElement creates dilateKernel — freed in finally.
    const dilateKernel = cv.getStructuringElement.mock.results[0].value as ReturnType<typeof makeMockMat>;
    expect(dilateKernel.delete).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// extractFeaturesExcludingClimber
// ---------------------------------------------------------------------------

describe("extractFeaturesExcludingClimber", () => {
  it("falls back to standard extractFeatures when landmarks < 3", () => {
    const cv = makeMockCv({ keypoints: [{ x: 5, y: 10 }] });
    const landmarks: NormalizedPoint[] = [{ x: 0.5, y: 0.5 }];
    const result = extractFeaturesExcludingClimber(cv, fakeImageData(), landmarks);
    // Should produce results from the standard extractFeatures path.
    expect(result.keypoints).toHaveLength(1);
    expect(result.keypoints[0].pt).toEqual({ x: 5, y: 10 });
  });

  it("uses a climber mask when ≥ 3 landmarks are provided", () => {
    const cv = makeMaskCv();
    const landmarks: NormalizedPoint[] = [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.8 },
      { x: 0.9, y: 0.2 },
    ];
    const result = extractFeaturesExcludingClimber(cv, fakeImageData(), landmarks);
    expect(result.keypoints).toBeDefined();
    // buildClimberExclusionMask should have been invoked.
    expect(cv.convexHull).toHaveBeenCalledOnce();
  });

  it("frees climber mask and all allocations", () => {
    const cv = makeMaskCv();
    const landmarks: NormalizedPoint[] = [
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.5 },
      { x: 0.8, y: 0.8 },
    ];
    extractFeaturesExcludingClimber(cv, fakeImageData(), landmarks);
    // ORB, keypoints, srcMat etc. should all be deleted.
    expect(cv._orb.delete).toHaveBeenCalled();
    expect(cv._kpVec.delete).toHaveBeenCalled();
    for (const m of cv._matInstances) {
      expect(m.delete).toHaveBeenCalled();
    }
  });
});
