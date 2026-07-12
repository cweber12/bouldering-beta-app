import { describe, it, expect } from "vitest";
import {
  summarizeMinAvgMax,
  toFrameConditions,
  buildReferenceFrameMeta,
  detectBadStretches,
  buildScanDiagnostics,
  buildMatchDiagnostics,
  emptyHomographyStats,
  DIAGNOSTICS_SCHEMA_VERSION,
  WEAK_CONFIDENCE_THRESHOLD,
  type SampledFrameStatus,
  type ScanDiagnosticsInput,
  type HomographyStats,
} from "@/pipeline/analysis/diagnostics";
import type { FrameAnalysis, RegionStats } from "@/pipeline/analysis/frameAnalyzer";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const region = (mean: number): RegionStats => ({ mean, stdDev: 40, sharpness: 120 });

function makeAnalysis(overrides: Partial<FrameAnalysis> = {}): FrameAnalysis {
  return {
    overall: region(128),
    climber: region(90),
    wall: region(140),
    isOverexposed: false,
    isUnderexposed: false,
    isBacklit: true,
    isLowContrast: false,
    isBlurry: false,
    suggestedGamma: 1.0,
    contrastAlpha: 0,
    ...overrides,
  };
}

function row(overrides: Partial<SampledFrameStatus>): SampledFrameStatus {
  return {
    timestamp: 0,
    frameIndex: 0,
    detected: true,
    avgConfidence: 0.9,
    keypointCount: 33,
    wasFlip: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// summarizeMinAvgMax
// ---------------------------------------------------------------------------

describe("summarizeMinAvgMax", () => {
  it("returns all-zero for empty input", () => {
    expect(summarizeMinAvgMax([])).toEqual({ min: 0, avg: 0, max: 0 });
  });

  it("computes min, avg, and max", () => {
    expect(summarizeMinAvgMax([2, 4, 6])).toEqual({ min: 2, avg: 4, max: 6 });
  });

  it("handles a single value", () => {
    expect(summarizeMinAvgMax([7])).toEqual({ min: 7, avg: 7, max: 7 });
  });
});

// ---------------------------------------------------------------------------
// toFrameConditions / buildReferenceFrameMeta
// ---------------------------------------------------------------------------

describe("toFrameConditions", () => {
  it("maps stats and flags off a FrameAnalysis", () => {
    const conditions = toFrameConditions(makeAnalysis());
    expect(conditions.overall.mean).toBe(128);
    expect(conditions.climber?.mean).toBe(90);
    expect(conditions.flags).toEqual({
      isOverexposed: false,
      isUnderexposed: false,
      isBacklit: true,
      isLowContrast: false,
      isBlurry: false,
    });
  });

  it("preserves a null climber region", () => {
    const conditions = toFrameConditions(makeAnalysis({ climber: null }));
    expect(conditions.climber).toBeNull();
  });
});

describe("buildReferenceFrameMeta", () => {
  it("carries dimensions and ORB keypoint count alongside the conditions", () => {
    const meta = buildReferenceFrameMeta(makeAnalysis(), 412, 1920, 1080);
    expect(meta).toMatchObject({
      width: 1920,
      height: 1080,
      refKeypointCount: 412,
      flags: { isBacklit: true },
    });
    expect(meta.wall?.mean).toBe(140);
  });
});

// ---------------------------------------------------------------------------
// detectBadStretches
// ---------------------------------------------------------------------------

describe("detectBadStretches", () => {
  it("returns no stretches when all frames are good", () => {
    const rows = [row({ timestamp: 0 }), row({ timestamp: 1 }), row({ timestamp: 2 })];
    expect(detectBadStretches(rows, 2)).toEqual([]);
  });

  it("ignores bad runs shorter than minRunLength", () => {
    const rows = [
      row({ timestamp: 0 }),
      row({ timestamp: 1, detected: false, avgConfidence: 0, keypointCount: 0 }),
      row({ timestamp: 2 }),
    ];
    expect(detectBadStretches(rows, 2)).toEqual([]);
  });

  it("captures a run of missing/weak frames meeting the threshold", () => {
    const rows = [
      row({ timestamp: 0 }),
      row({ timestamp: 1, detected: false, avgConfidence: 0, keypointCount: 0 }),
      row({ timestamp: 2, detected: true, avgConfidence: 0.3, keypointCount: 20 }), // weak
      row({ timestamp: 3, detected: false, avgConfidence: 0, keypointCount: 0 }),
      row({ timestamp: 4 }),
    ];
    const stretches = detectBadStretches(rows, 3);
    expect(stretches).toHaveLength(1);
    expect(stretches[0].startTs).toBe(1);
    expect(stretches[0].endTs).toBe(3);
    expect(stretches[0].frames.map((f) => f.status)).toEqual(["missing", "weak", "missing"]);
  });

  it("treats exactly-threshold confidence as good (strict less-than)", () => {
    const rows = [
      row({ timestamp: 0, avgConfidence: WEAK_CONFIDENCE_THRESHOLD }),
      row({ timestamp: 1, avgConfidence: WEAK_CONFIDENCE_THRESHOLD }),
    ];
    expect(detectBadStretches(rows, 2)).toEqual([]);
  });

  it("closes a trailing bad run at the end of the sequence", () => {
    const rows = [
      row({ timestamp: 0 }),
      row({ timestamp: 1, detected: false, avgConfidence: 0, keypointCount: 0 }),
      row({ timestamp: 2, detected: false, avgConfidence: 0, keypointCount: 0 }),
    ];
    const stretches = detectBadStretches(rows, 2);
    expect(stretches).toHaveLength(1);
    expect(stretches[0].frames).toHaveLength(2);
  });

  it("carries the wasFlip flag through to the captured rows", () => {
    const rows = [
      row({ timestamp: 0, detected: false, avgConfidence: 0, keypointCount: 0, wasFlip: true }),
      row({ timestamp: 1, detected: false, avgConfidence: 0, keypointCount: 0 }),
    ];
    const stretches = detectBadStretches(rows, 2);
    expect(stretches[0].frames[0].wasFlip).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildScanDiagnostics
// ---------------------------------------------------------------------------

function scanInput(overrides: Partial<ScanDiagnosticsInput> = {}): ScanDiagnosticsInput {
  return {
    scanId: "run-1",
    videoHash: "abc",
    appVersion: "deadbee",
    video: {
      width: 1920,
      height: 1080,
      durationSec: 4,
      frameCount: 40,
      fileType: "video/mp4",
      source: "uploaded",
    },
    captureMode: "fixed",
    referenceAnalysis: makeAnalysis(),
    climberFrameCoverage: { min: 0.1, avg: 0.2 },
    motionMagnitude: 0.05,
    config: {
      frameStep: 5,
      frameIntervalMs: 100,
      minScore: 0.3,
      maxRecoveryFrames: 30,
      motionThreshold: Infinity,
      filterTolerance: null,
      flipTeleportBase: 0.2,
      refineStride: 1,
    },
    pose: {
      sampledFrames: 8,
      detectedFrames: 7,
      detectionRate: 0.875,
      flippedFrames: 1,
      keptFrames: 6,
      goodFrames: 6,
      confidence: { min: 0.6, avg: 0.8, max: 0.95 },
      avgKeypointCount: 33,
      limbExpandedFrames: 0,
      refinement: { gapsRefined: 1, recoveryFramesUsed: 3 },
    },
    orb: { refKeypointCount: 400, keyframeCount: 0, keyframeKeypoints: { min: 0, avg: 0, max: 0 } },
    badStretches: [],
    ...overrides,
  };
}

describe("buildScanDiagnostics", () => {
  it("stamps schema/type and groups input/config/result", () => {
    const rec = buildScanDiagnostics(scanInput());
    expect(rec.schemaVersion).toBe(DIAGNOSTICS_SCHEMA_VERSION);
    expect(rec.recordType).toBe("scan");
    expect(rec.scanId).toBe("run-1");
    expect(rec.input.referenceFrame.flags.isBacklit).toBe(true);
    expect(rec.result.pose.detectionRate).toBeCloseTo(0.875);
    expect(rec.result.overlayQuality).toBeNull();
  });

  it("defaults overlayQuality to null and respects a provided tag", () => {
    expect(buildScanDiagnostics(scanInput({ overlayQuality: "drift" })).result.overlayQuality).toBe(
      "drift",
    );
  });

  it("uses a provided createdAt", () => {
    const rec = buildScanDiagnostics(scanInput({ createdAt: "2026-01-01T00:00:00.000Z" }));
    expect(rec.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// buildMatchDiagnostics
// ---------------------------------------------------------------------------

const stats = (overrides: Partial<HomographyStats> = {}): HomographyStats => ({
  ...emptyHomographyStats(),
  matchCount: 50,
  inlierCount: 30,
  inlierRatio: 0.6,
  homographyFound: true,
  failureReason: "ok",
  ...overrides,
});

const queryBlock = {
  width: 3000,
  height: 4000,
  queryKeypointCount: 800,
  overall: region(120),
  flags: {
    isOverexposed: false,
    isUnderexposed: false,
    isBacklit: false,
    isLowContrast: false,
    isBlurry: false,
  },
  downscaleApplied: 0.4,
};

describe("buildMatchDiagnostics", () => {
  it("shapes a fixed-capture record from a single stats object", () => {
    const rec = buildMatchDiagnostics({
      scanId: "run-1",
      videoHash: "abc",
      imageHash: "img",
      appVersion: "deadbee",
      reference: null,
      query: queryBlock,
      match: { mode: "fixed", stats: stats() },
    });
    expect(rec.recordType).toBe("match");
    expect(rec.result.captureMode).toBe("fixed");
    expect(rec.result.inlierRatio).toBe(0.6);
    expect(rec.result.homographyFound).toBe(true);
    expect(rec.result.matchQuality).toBeNull();
    expect(rec.result.keyframesMatched).toBeUndefined();
  });

  it("labels a failed fixed match without a homography", () => {
    const rec = buildMatchDiagnostics({
      scanId: "run-1",
      videoHash: "abc",
      imageHash: "img",
      appVersion: "deadbee",
      reference: null,
      query: queryBlock,
      match: {
        mode: "fixed",
        stats: stats({
          inlierCount: 0,
          inlierRatio: 0,
          homographyFound: false,
          failureReason: "gate_rejected",
        }),
      },
    });
    expect(rec.result.homographyFound).toBe(false);
    expect(rec.result.failureReason).toBe("gate_rejected");
  });

  it("aggregates panning keyframes into a min/avg/max inlier ratio", () => {
    const rec = buildMatchDiagnostics({
      scanId: "run-1",
      videoHash: "abc",
      imageHash: "img",
      appVersion: "deadbee",
      reference: null,
      query: queryBlock,
      match: {
        mode: "panning",
        perKeyframe: [
          stats({ matchCount: 20, inlierCount: 10, inlierRatio: 0.5 }),
          stats({ matchCount: 30, inlierCount: 21, inlierRatio: 0.7 }),
          stats({
            matchCount: 5,
            inlierCount: 0,
            inlierRatio: 0,
            homographyFound: false,
            failureReason: "too_few_matches",
          }),
        ],
      },
    });
    expect(rec.result.captureMode).toBe("panning");
    expect(rec.result.keyframesMatched).toBe(2);
    expect(rec.result.matchCount).toBe(55); // 20 + 30 + 5
    expect(rec.result.inlierCount).toBe(31); // 10 + 21 + 0
    // min/avg/max computed over the two MATCHED keyframes only.
    expect(rec.result.inlierRatio).toEqual({ min: 0.5, avg: 0.6, max: 0.7 });
  });

  it("reports a panning match where every keyframe failed", () => {
    const rec = buildMatchDiagnostics({
      scanId: "run-1",
      videoHash: "abc",
      imageHash: "img",
      appVersion: "deadbee",
      reference: null,
      query: queryBlock,
      match: {
        mode: "panning",
        perKeyframe: [stats({ homographyFound: false, failureReason: "degenerate" })],
      },
    });
    expect(rec.result.homographyFound).toBe(false);
    expect(rec.result.keyframesMatched).toBe(0);
    expect(rec.result.failureReason).toBe("too_few_matches");
    expect(rec.result.inlierRatio).toEqual({ min: 0, avg: 0, max: 0 });
  });
});
