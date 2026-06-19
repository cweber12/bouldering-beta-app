import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrbFeatures, OrbMatch } from "@/pipeline/orbDetector";

// Mock only computeHomography at the module boundary; keep the real
// applyHomographyMatrix so the corner projection is exercised end-to-end.
vi.mock("@/pipeline/homography", async (importActual) => {
  const actual = await importActual<typeof import("@/pipeline/homography")>();
  return { ...actual, computeHomography: vi.fn() };
});

import { computeHomography } from "@/pipeline/homography";
import { estimateRouteCrop, AUTO_FRAME_CONFIDENCE_MATCHES } from "@/pipeline/routeCropEstimator";

const cv = {} as unknown;

/** Reference features with a crop box covering the centre of a 1000×1000 frame. */
function refWithCrop(): OrbFeatures {
  return {
    keypoints: [],
    descriptors: new Uint8Array(),
    cropBox: { x: 250, y: 250, width: 500, height: 500, srcWidth: 1000, srcHeight: 1000 },
  };
}

function refNoCrop(): OrbFeatures {
  return { keypoints: [], descriptors: new Uint8Array() };
}

const queryStub: OrbFeatures = { keypoints: [], descriptors: new Uint8Array() };

/** Five matches — enough to clear the n >= 4 floor and the confidence floor. */
function manyMatches(n: number): OrbMatch[] {
  return Array.from({ length: n }, (_, i) => ({ queryIdx: i, trainIdx: i, distance: 10 }));
}

const opts = { ransacReprojThreshold: 3, gate: { srcWidth: 1000, srcHeight: 1000 } };

beforeEach(() => {
  vi.mocked(computeHomography).mockReset();
});

describe("estimateRouteCrop", () => {
  it("projects the crop-box corners through the homography into a fractional crop", () => {
    // Identity homography → the crop box maps onto an identically-sized photo 1:1.
    // prettier-ignore
    vi.mocked(computeHomography).mockReturnValue(new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
    const est = estimateRouteCrop(cv, manyMatches(20), refWithCrop(), queryStub, 1000, 1000, opts);
    expect(est).not.toBeNull();
    expect(est!.crop.x).toBeCloseTo(0.25);
    expect(est!.crop.y).toBeCloseTo(0.25);
    expect(est!.crop.w).toBeCloseTo(0.5);
    expect(est!.crop.h).toBeCloseTo(0.5);
    expect(est!.confidence).toBe("high");
  });

  it("clamps a projection that overflows the photo bounds to [0, 1]", () => {
    // Translate the box so it partly overflows the right/bottom edges; the bbox
    // clamps to the photo (box spans 650..1150 → clamps to 650..1000).
    // prettier-ignore
    vi.mocked(computeHomography).mockReturnValue(new Float64Array([1, 0, 400, 0, 1, 400, 0, 0, 1]));
    const est = estimateRouteCrop(cv, manyMatches(20), refWithCrop(), queryStub, 1000, 1000, opts);
    expect(est).not.toBeNull();
    expect(est!.crop.x).toBeGreaterThanOrEqual(0);
    expect(est!.crop.y).toBeGreaterThanOrEqual(0);
    expect(est!.crop.x + est!.crop.w).toBeLessThanOrEqual(1.0001);
    expect(est!.crop.y + est!.crop.h).toBeLessThanOrEqual(1.0001);
  });

  it("flags a low-confidence estimate below the match threshold", () => {
    // prettier-ignore
    vi.mocked(computeHomography).mockReturnValue(new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
    const est = estimateRouteCrop(cv, manyMatches(AUTO_FRAME_CONFIDENCE_MATCHES - 1), refWithCrop(), queryStub, 1000, 1000, opts);
    expect(est!.confidence).toBe("low");
  });

  it("returns null when the reference has no crop box", () => {
    const est = estimateRouteCrop(cv, manyMatches(20), refNoCrop(), queryStub, 1000, 1000, opts);
    expect(est).toBeNull();
    expect(computeHomography).not.toHaveBeenCalled();
  });

  it("returns null when there are too few matches", () => {
    const est = estimateRouteCrop(cv, manyMatches(3), refWithCrop(), queryStub, 1000, 1000, opts);
    expect(est).toBeNull();
    expect(computeHomography).not.toHaveBeenCalled();
  });

  it("returns null when the homography fails the gate (computeHomography returns null)", () => {
    vi.mocked(computeHomography).mockReturnValue(null);
    const est = estimateRouteCrop(cv, manyMatches(20), refWithCrop(), queryStub, 1000, 1000, opts);
    expect(est).toBeNull();
  });

  it("returns null for non-positive photo dimensions", () => {
    // prettier-ignore
    vi.mocked(computeHomography).mockReturnValue(new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
    expect(estimateRouteCrop(cv, manyMatches(20), refWithCrop(), queryStub, 0, 1000, opts)).toBeNull();
  });
});
