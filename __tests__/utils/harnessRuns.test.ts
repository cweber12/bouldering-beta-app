import { describe, it, expect } from "vitest";
import {
  unwrapRunEnvelope,
  parseHarnessPosePayload,
  parseRunFile,
  parseRunVerdicts,
  summarizeRunFile,
} from "@/utils/harnessRuns";

/** A structurally complete diagnostics record — the spine the parser checks. */
const DIAGNOSTICS = {
  schemaVersion: 3,
  recordType: "scan",
  scanId: "scan-1",
  createdAt: "2026-07-20T00:00:00.000Z",
  videoHash: "vh",
  appVersion: "1.2.3",
  input: { video: { width: 1080, height: 1920 } },
  config: { frameStep: 3 },
  result: { pose: { detectionRate: 0.9 }, orb: { refKeypointCount: 500 }, badStretches: [] },
};

const KEYPOINTS = [{ name: "left_wrist", x: 0.4, y: 0.5, score: 0.9 }];
const REGION = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

const COUNTS = {
  good: 4,
  drift: 3,
  wrong: 2,
  extreme: 1,
  missing: 1,
  unscored: 0,
  absentOk: 5,
  absentViolation: 1,
};
const EMPTY_COUNTS = {
  good: 0,
  drift: 0,
  wrong: 0,
  extreme: 0,
  missing: 0,
  unscored: 0,
  absentOk: 0,
  absentViolation: 0,
};

const SCORING = {
  groundTruthHash: "gt-1",
  rows: [
    {
      frameIndex: 0,
      timestamp: 0,
      state: "present",
      kind: "good",
      verified: true,
      bodyScale: 0.2,
      driftAvg: 0.01,
      driftMax: 0.03,
      worstJoint: "left_wrist",
      jointDrift: { left_wrist: 0.03 },
    },
    {
      frameIndex: 1,
      timestamp: 0.1,
      state: "absent",
      kind: "good",
      verified: true,
      bodyScale: null,
      driftAvg: null,
      driftMax: null,
      worstJoint: null,
      jointDrift: {},
    },
  ],
  rollup: {
    verified: { counts: COUNTS, drift: { min: 0.01, avg: 0.05, max: 0.3 } },
    unverified: { counts: EMPTY_COUNTS, drift: null },
    totalPresent: 10,
    probedPresent: 10,
    probeCoverage: 1,
    verifiedCoverage: 1,
    detectionRateVsGT: 0.9,
    offGridRunFrames: 0,
  },
};

/** A current-generation payload: scored, with a detector-attempt stream. */
function payload(): Record<string, unknown> {
  return {
    setupHash: "setup-1",
    groundTruthHash: "gt-1",
    scoring: SCORING,
    diagnostics: DIAGNOSTICS,
    detectorAttempts: [
      {
        timestamp: 0,
        status: "accepted",
        initialSearchRegion: REGION,
        detectionRegion: REGION,
        reacquireAttempted: false,
        reacquired: false,
        rawKeypoints: KEYPOINTS,
        acceptedKeypoints: KEYPOINTS,
        searchConditions: { overall: {}, climber: null, wall: null, flags: {} },
        reacquireConditions: null,
        candidateCount: 1,
        rejectedCandidateCount: 0,
        selectionMethod: "tracked",
        inferenceMs: 12,
      },
      {
        timestamp: 0.1,
        status: "missing",
        initialSearchRegion: REGION,
        detectionRegion: null,
        reacquireAttempted: true,
        reacquired: false,
        reacquireSteps: [{ region: { x: 0, y: 0, w: 1, h: 1 }, found: false }],
        bestUnselectedCandidateScore: null,
        rawKeypoints: [],
        searchConditions: null,
        reacquireConditions: null,
        candidateCount: 0,
        rejectedCandidateCount: 0,
        missReason: "no-candidates",
      },
    ],
    frames: [
      { timestamp: 0, source: "raw", keypoints: KEYPOINTS },
      { timestamp: 0.1, keypoints: [] },
    ],
  };
}

/**
 * A v1 payload: written before `detectorAttempts`, `missReason` and
 * `selectionMethod` existed. The corpus is mostly this shape, so it is valid
 * evidence, not a validation failure.
 */
function legacyPayload(): Record<string, unknown> {
  return {
    setupHash: "setup-1",
    groundTruthHash: null,
    scoring: null,
    diagnostics: DIAGNOSTICS,
    frames: [{ timestamp: 0, keypoints: KEYPOINTS }],
  };
}

function envelope(data: unknown): Record<string, unknown> {
  return {
    video_key: "vid_1",
    route_folder: "route-x",
    run_ts: "20260726-225214",
    written_at: "2026-07-26T22:52:14",
    type: "pose",
    data,
  };
}

describe("unwrapRunEnvelope", () => {
  it("reads run_ts and written_at off the downloader envelope", () => {
    const unwrapped = unwrapRunEnvelope(envelope(payload()));
    expect(unwrapped?.runTs).toBe("20260726-225214");
    expect(unwrapped?.writtenAt).toBe("2026-07-26T22:52:14");
    expect((unwrapped?.data as Record<string, unknown>).setupHash).toBe("setup-1");
  });

  it("accepts a bare payload as its own data", () => {
    const unwrapped = unwrapRunEnvelope(payload());
    expect(unwrapped?.runTs).toBeNull();
    expect(unwrapped?.writtenAt).toBeNull();
    expect((unwrapped?.data as Record<string, unknown>).setupHash).toBe("setup-1");
  });

  it("rejects a non-object body", () => {
    expect(unwrapRunEnvelope("truncated")).toBeNull();
    expect(unwrapRunEnvelope(null)).toBeNull();
  });
});

describe("parseHarnessPosePayload", () => {
  it("returns the typed payload for a current run", () => {
    const parsed = parseHarnessPosePayload(payload());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.setupHash).toBe("setup-1");
    expect(parsed.payload.groundTruthHash).toBe("gt-1");
    expect(parsed.payload.scoring?.rollup.verified.counts).toEqual(COUNTS);
    expect(parsed.payload.scoring?.rows).toHaveLength(2);
    expect(parsed.payload.detectorAttempts).toHaveLength(2);
    expect(parsed.payload.frames[0].source).toBe("raw");
  });

  it("loads a run written before detectorAttempts, missReason and selectionMethod existed", () => {
    const parsed = parseHarnessPosePayload(legacyPayload());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.detectorAttempts).toBeUndefined();
    expect(parsed.payload.scoring).toBeNull();
    expect(parsed.payload.groundTruthHash).toBeNull();
  });

  it("loads an attempt stream whose entries carry no missReason or selectionMethod", () => {
    const body = payload();
    const attempts = body.detectorAttempts as Record<string, unknown>[];
    delete attempts[0].selectionMethod;
    delete attempts[1].missReason;
    const parsed = parseHarnessPosePayload(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [accepted, missing] = parsed.payload.detectorAttempts ?? [];
    expect(accepted.selectionMethod).toBeUndefined();
    expect(missing.status === "missing" && missing.missReason).toBeUndefined();
  });

  it("treats an absent groundTruthHash as unscored rather than failing", () => {
    const body = legacyPayload();
    delete body.groundTruthHash;
    const parsed = parseHarnessPosePayload(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.groundTruthHash).toBeNull();
  });

  it("names the field that failed instead of returning a partial object", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...payload(), setupHash: undefined }, /setupHash/],
      [{ ...payload(), diagnostics: { appVersion: "1.0.0" } }, /diagnostics/],
      [{ ...payload(), frames: [{ timestamp: 0 }] }, /pose frames/],
      [{ ...payload(), frames: [{ timestamp: 0, keypoints: [{ name: "n", x: 0.1 }] }] }, /pose frames/],
      [{ ...payload(), scoring: { groundTruthHash: "gt-1", rows: [] } }, /scoring/],
    ];
    for (const [body, pattern] of cases) {
      const parsed = parseHarnessPosePayload(body);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.error).toMatch(pattern);
    }
  });

  it("rejects an attempt whose status and evidence disagree", () => {
    const withoutAccepted = payload();
    const attempts = withoutAccepted.detectorAttempts as Record<string, unknown>[];
    delete attempts[0].acceptedKeypoints;
    expect(parseHarnessPosePayload(withoutAccepted).ok).toBe(false);

    const posedMiss = payload();
    (posedMiss.detectorAttempts as Record<string, unknown>[])[1].rawKeypoints = KEYPOINTS;
    expect(parseHarnessPosePayload(posedMiss).ok).toBe(false);

    const unknownStatus = payload();
    (unknownStatus.detectorAttempts as Record<string, unknown>[])[0].status = "skipped";
    expect(parseHarnessPosePayload(unknownStatus).ok).toBe(false);
  });

  it("rejects a scoring row with an off-vocabulary verdict", () => {
    const body = payload();
    body.scoring = {
      ...SCORING,
      rows: [{ ...SCORING.rows[0], kind: "terrible" }],
    };
    expect(parseHarnessPosePayload(body).ok).toBe(false);
  });

  it("rejects a non-object payload", () => {
    expect(parseHarnessPosePayload("truncated").ok).toBe(false);
    expect(parseHarnessPosePayload(null).ok).toBe(false);
  });
});

describe("parseRunFile", () => {
  it("parses a whole run file, envelope and all", () => {
    expect(parseRunFile(envelope(payload())).ok).toBe(true);
    expect(parseRunFile(payload()).ok).toBe(true);
  });

  it("explains a truncated file rather than throwing", () => {
    const parsed = parseRunFile("{ \"video_key\": ");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/not a JSON object/);
  });
});

describe("parseRunVerdicts", () => {
  it("reads the counts out of both halves of the rollup split", () => {
    expect(parseRunVerdicts(SCORING)).toEqual({ verified: COUNTS, unverified: EMPTY_COUNTS });
  });

  it("returns null for an unscored run or an unreadable rollup", () => {
    expect(parseRunVerdicts(null)).toBeNull();
    expect(parseRunVerdicts({ groundTruthHash: "gt", rows: [] })).toBeNull();
    expect(parseRunVerdicts({ rollup: { verified: { counts: {} }, unverified: {} } })).toBeNull();
  });
});

describe("summarizeRunFile", () => {
  it("reads the list-level stamps without touching frames or attempts", () => {
    const facts = summarizeRunFile(envelope(payload()));
    expect(facts).toEqual({
      writtenAt: "2026-07-26T22:52:14",
      setupHash: "setup-1",
      groundTruthHash: "gt-1",
      verdicts: { verified: COUNTS, unverified: EMPTY_COUNTS },
      malformed: false,
    });
  });

  it("summarizes a bare payload with no envelope stamps", () => {
    const facts = summarizeRunFile(legacyPayload());
    expect(facts.writtenAt).toBeNull();
    expect(facts.setupHash).toBe("setup-1");
    expect(facts.groundTruthHash).toBeNull();
    expect(facts.verdicts).toBeNull();
    expect(facts.malformed).toBe(false);
  });

  it("flags a file it cannot read stamps out of", () => {
    expect(summarizeRunFile("truncated").malformed).toBe(true);
    expect(summarizeRunFile(envelope("truncated")).malformed).toBe(true);
  });
});
