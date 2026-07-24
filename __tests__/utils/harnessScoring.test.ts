import { describe, it, expect } from "vitest";
import {
  scoreRunAgainstGroundTruth,
  computeBodyScale,
  detectorEvidenceFrames,
  findScoredRow,
  DRIFT_MIN,
  WRONG_MAX,
  type DetectionRunInput,
} from "@/utils/harnessScoring";
import {
  hashGroundTruthInput,
  type GroundTruthFrame,
  type GroundTruthJoint,
} from "@/utils/harnessGroundTruth";
import type { PoseFrame, Keypoint } from "@/pipeline/pose/poseDetection";

// ---------------------------------------------------------------------------
// Synthetic fixtures. A full 13-joint upright pose whose torso segments give a
// body scale of exactly (0.2 + 0.16 + ~0.2010 + ~0.2010) / 4 ≈ 0.1905.
// ---------------------------------------------------------------------------

const POSE: Record<string, { x: number; y: number }> = {
  nose: { x: 0.5, y: 0.2 },
  left_shoulder: { x: 0.4, y: 0.3 },
  right_shoulder: { x: 0.6, y: 0.3 },
  left_elbow: { x: 0.35, y: 0.4 },
  right_elbow: { x: 0.65, y: 0.4 },
  left_wrist: { x: 0.33, y: 0.5 },
  right_wrist: { x: 0.67, y: 0.5 },
  left_hip: { x: 0.42, y: 0.5 },
  right_hip: { x: 0.58, y: 0.5 },
  left_knee: { x: 0.41, y: 0.65 },
  right_knee: { x: 0.59, y: 0.65 },
  left_ankle: { x: 0.4, y: 0.8 },
  right_ankle: { x: 0.6, y: 0.8 },
};

function gtJoints(
  overrides: Record<string, Partial<GroundTruthJoint>> = {},
  omit: string[] = [],
): Record<string, GroundTruthJoint> {
  const out: Record<string, GroundTruthJoint> = {};
  for (const [name, p] of Object.entries(POSE)) {
    if (omit.includes(name)) continue;
    out[name] = { x: p.x, y: p.y, occluded: false, ...overrides[name] };
  }
  return out;
}

function gtFrame(
  frameIndex: number,
  timestamp: number,
  overrides: Partial<GroundTruthFrame> = {},
): GroundTruthFrame {
  return {
    frameIndex,
    timestamp,
    state: "present",
    joints: gtJoints(),
    review: "auto",
    verified: true,
    ...overrides,
  };
}

/** A run pose translated by (dx, dy) — translation preserves bone lengths. */
function runPose(
  timestamp: number,
  dx = 0,
  dy = 0,
  overrides: Record<string, { x: number; y: number }> = {},
  omit: string[] = [],
): PoseFrame {
  const keypoints: Keypoint[] = [];
  for (const [name, p] of Object.entries(POSE)) {
    if (omit.includes(name)) continue;
    const o = overrides[name];
    keypoints.push({ name, x: o?.x ?? p.x + dx, y: o?.y ?? p.y + dy, score: 0.9 });
  }
  return { timestamp, keypoints };
}

const BODY_SCALE = computeBodyScale(gtFrame(0, 0))!;

function run(frames: PoseFrame[], probes?: { timestamp: number }[]): DetectionRunInput {
  return { probes: probes ?? frames.map((f) => ({ timestamp: f.timestamp })), frames };
}

function score(gtFrames: GroundTruthFrame[], runInput: DetectionRunInput, hash = "gt-hash-1") {
  return scoreRunAgainstGroundTruth({
    groundTruth: { frames: gtFrames, groundTruthHash: hash },
    run: runInput,
  });
}

describe("detectorEvidenceFrames", () => {
  it("keeps only raw detector evidence for scoring from dense exported frames", () => {
    const frames: PoseFrame[] = [
      { ...runPose(0), source: "raw" },
      { ...runPose(0.1), source: "interpolated" },
      { ...runPose(0.2), source: "filled" },
      { ...runPose(0.3), source: "flipDiscarded" },
      { ...runPose(0.4), source: "limbExpanded" },
    ];

    expect(detectorEvidenceFrames(frames).map((frame) => frame.source)).toEqual([
      "raw",
      "limbExpanded",
    ]);
  });
});

describe("verdict ladder", () => {
  it("scores an exact pose as good with zero drift", () => {
    const result = score([gtFrame(0, 0)], run([runPose(0)]));
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.kind).toBe("good");
    expect(row.driftMax).toBe(0);
    expect(row.driftAvg).toBe(0);
    expect(row.bodyScale).toBeCloseTo(BODY_SCALE, 6);
    expect(Object.keys(row.jointDrift)).toHaveLength(13);
  });

  it("scores a uniformly translated pose between the thresholds as drift", () => {
    const offset = 0.15 * BODY_SCALE;
    const result = score([gtFrame(0, 0)], run([runPose(0, offset, 0)]));
    const row = result.rows[0];
    expect(row.kind).toBe("drift");
    expect(row.driftMax).toBeGreaterThanOrEqual(DRIFT_MIN);
    expect(row.driftMax).toBeLessThan(WRONG_MAX);
    expect(row.driftMax).toBeCloseTo(0.15, 5);
    expect(row.worstJoint).not.toBeNull();
  });

  it("scores a pose translated past WRONG_MAX as wrong (bones intact)", () => {
    const offset = 0.5 * BODY_SCALE;
    const result = score([gtFrame(0, 0)], run([runPose(0, offset, 0)]));
    expect(result.rows[0].kind).toBe("wrong");
    expect(result.rows[0].driftMax).toBeCloseTo(0.5, 5);
  });

  it("scores a stretched bone as extreme even when drift stays small", () => {
    // Slide the left wrist 0.06 outward along the forearm axis: the bone
    // stretches ~59% (past tolerance) while the wrist displacement is ~0.31
    // body scales — inside the drift band, under WRONG_MAX.
    const result = score(
      [gtFrame(0, 0)],
      run([runPose(0, 0, 0, { left_wrist: { x: 0.3182, y: 0.5588 } })]),
    );
    expect(result.rows[0].kind).toBe("extreme");
  });

  it("outranks wrong with extreme when both apply", () => {
    // A huge single-joint displacement both breaks the forearm bone and
    // exceeds WRONG_MAX — precedence keeps it extreme.
    const result = score(
      [gtFrame(0, 0)],
      run([runPose(0, 0, 0, { left_wrist: { x: 0.33, y: 0.95 } })]),
    );
    expect(result.rows[0].kind).toBe("extreme");
  });

  it("scores a probed frame with no accepted pose as missing", () => {
    const result = score([gtFrame(0, 0)], run([], [{ timestamp: 0 }]));
    expect(result.rows[0].kind).toBe("missing");
  });

  it("scores a partial pose below the coverage floor as missing", () => {
    // 5 of 13 non-occluded GT joints returned — coverage 0.38 < 0.6, missing
    // regardless of how well those five joints score.
    const omit = [
      "nose",
      "left_elbow",
      "right_elbow",
      "left_wrist",
      "right_wrist",
      "left_knee",
      "right_knee",
      "right_ankle",
    ];
    const result = score([gtFrame(0, 0)], run([runPose(0, 0, 0, {}, omit)]));
    expect(result.rows[0].kind).toBe("missing");
  });

  it("excludes occluded joints from drift, coverage, and the verdict", () => {
    // The left wrist is occluded in GT: a wild run wrist must not change the
    // verdict, and the joint must not appear in jointDrift.
    const gt = gtFrame(0, 0, { joints: gtJoints({ left_wrist: { occluded: true } }) });
    const result = score(
      [gt],
      run([runPose(0, 0, 0, { left_wrist: { x: 0.9, y: 0.9 } })]),
    );
    const row = result.rows[0];
    expect(row.kind).toBe("good");
    expect(row.jointDrift.left_wrist).toBeUndefined();
  });

  it("marks a frame with no resolvable torso segment unscored (no-body-scale)", () => {
    const gt = gtFrame(0, 0, {
      joints: gtJoints({
        left_shoulder: { occluded: true },
        right_shoulder: { occluded: true },
        left_hip: { occluded: true },
        right_hip: { occluded: true },
      }),
    });
    const result = score([gt], run([runPose(0)]));
    const row = result.rows[0];
    expect(row.kind).toBe("unscored");
    expect(row.unscoredReason).toBe("no-body-scale");
    expect(row.driftMax).toBeNull();
  });

  it("degrades body scale gracefully when one torso pair is occluded", () => {
    const gt = gtFrame(0, 0, {
      joints: gtJoints({ left_hip: { occluded: true }, right_hip: { occluded: true } }),
    });
    const result = score([gt], run([runPose(0)]));
    const row = result.rows[0];
    expect(row.kind).toBe("good");
    // Only the shoulder-width segment resolves (both sides need a hip).
    expect(row.bodyScale).toBeCloseTo(0.2, 6);
  });

  it("keeps flagged-wrong frames as presence truth only", () => {
    const flagged = gtFrame(0, 0, { review: "human-flagged-wrong" });
    const withPose = score([flagged], run([runPose(0)]));
    expect(withPose.rows[0].kind).toBe("unscored");
    expect(withPose.rows[0].unscoredReason).toBe("flagged-wrong-joints");

    const withoutPose = score([flagged], run([], [{ timestamp: 0 }]));
    expect(withoutPose.rows[0].kind).toBe("missing");
  });

  it("scores absent frames as violation with a pose, ok without", () => {
    const absent = gtFrame(0, 0, {
      state: "absent",
      joints: {},
      review: "human-flagged-absent",
    });
    const violation = score([absent], run([runPose(0)]));
    expect(violation.rows[0].kind).toBe("wrong");
    expect(violation.rollup.verified.counts.absentViolation).toBe(1);
    expect(violation.rollup.verified.counts.wrong).toBe(0);

    const ok = score([absent], run([], [{ timestamp: 0 }]));
    expect(ok.rows[0].kind).toBe("good");
    expect(ok.rollup.verified.counts.absentOk).toBe(1);
    expect(ok.rollup.verified.counts.good).toBe(0);
  });

  it("excludes skip frames from rows and denominators", () => {
    const frames = [
      gtFrame(0, 0, { state: "skip", joints: {} }),
      gtFrame(1, 0.1),
    ];
    const result = score(frames, run([runPose(0), runPose(0.1)]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].frameIndex).toBe(1);
    expect(result.rollup.totalPresent).toBe(1);
    // The probe that paired with the skip frame is matched, not off-grid.
    expect(result.rollup.offGridRunFrames).toBe(0);
  });
});

describe("probed-frame domain", () => {
  it("never charges missing for grid frames a sparse run did not probe", () => {
    // Dense 100 ms grid, run probing every 200 ms — half the grid unprobed.
    const gt = Array.from({ length: 10 }, (_, i) => gtFrame(i, i / 10));
    const poses = [0, 0.2, 0.4, 0.6, 0.8].map((t) => runPose(t));
    const result = score(gt, run(poses));

    expect(result.rows).toHaveLength(5);
    expect(result.rollup.verified.counts.missing).toBe(0);
    expect(result.rollup.verified.counts.good).toBe(5);
    expect(result.rollup.totalPresent).toBe(10);
    expect(result.rollup.probedPresent).toBe(5);
    expect(result.rollup.probeCoverage).toBeCloseTo(0.5, 6);
  });

  it("computes detectionRateVsGT over probed present frames only", () => {
    const gt = Array.from({ length: 4 }, (_, i) => gtFrame(i, i / 10));
    // Probes all four; poses accepted on two.
    const probes = [0, 0.1, 0.2, 0.3].map((timestamp) => ({ timestamp }));
    const result = score(gt, run([runPose(0), runPose(0.1)], probes));

    expect(result.rollup.probedPresent).toBe(4);
    expect(result.rollup.detectionRateVsGT).toBeCloseTo(0.5, 6);
    expect(result.rollup.verified.counts.missing).toBe(2);
  });

  it("counts run probes that pair with no truth frame without scoring them", () => {
    const result = score(
      [gtFrame(0, 0)],
      run([runPose(0), runPose(0.05)]), // 0.05 is on no grid frame
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rollup.offGridRunFrames).toBe(1);
  });

  it("pairs probes to truth within 1 ms and no further", () => {
    const result = score(
      [gtFrame(0, 0.2), gtFrame(1, 0.3)],
      run([runPose(0.2004), runPose(0.305)]),
    );
    // 0.2004 pairs with 0.2 (0.4 ms); 0.305 pairs with nothing (5 ms).
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].frameIndex).toBe(0);
    expect(result.rows[0].kind).toBe("good");
    expect(result.rollup.offGridRunFrames).toBe(1);
  });

  it("unions refinement-only frames into the probed set", () => {
    // The base timeline never saw 0.1; the accepted frame list did (an
    // Adaptive Refinement re-probe). Both grid frames are probed.
    const result = score(
      [gtFrame(0, 0), gtFrame(1, 0.1)],
      run([runPose(0), runPose(0.1)], [{ timestamp: 0 }]),
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rollup.probedPresent).toBe(2);
  });
});

describe("rollup split and drift stats", () => {
  it("splits verified and unverified into parallel sets", () => {
    const gt = [
      gtFrame(0, 0),
      gtFrame(1, 0.1, { verified: false }),
    ];
    const offset = 0.15 * BODY_SCALE;
    const result = score(gt, run([runPose(0), runPose(0.1, offset, 0)]));

    expect(result.rollup.verified.counts.good).toBe(1);
    expect(result.rollup.verified.counts.drift).toBe(0);
    expect(result.rollup.unverified.counts.drift).toBe(1);
    expect(result.rollup.unverified.counts.good).toBe(0);
    expect(result.rollup.verifiedCoverage).toBeCloseTo(0.5, 6);
  });

  it("aggregates drift stats over good + drift frames only", () => {
    const gt = Array.from({ length: 3 }, (_, i) => gtFrame(i, i / 10));
    const result = score(gt, run([
      runPose(0), // good, driftMax 0
      runPose(0.1, 0.2 * BODY_SCALE, 0), // drift, driftMax 0.2
      runPose(0.2, 0.6 * BODY_SCALE, 0), // wrong — counted, never averaged
    ]));

    const stats = result.rollup.verified.drift!;
    expect(stats.min).toBeCloseTo(0, 5);
    expect(stats.max).toBeCloseTo(0.2, 5);
    expect(stats.avg).toBeCloseTo(0.1, 5);
    expect(result.rollup.verified.counts.wrong).toBe(1);
  });

  it("reports null drift stats when no frame carries a drift verdict", () => {
    const result = score([gtFrame(0, 0)], run([], [{ timestamp: 0 }]));
    expect(result.rollup.verified.drift).toBeNull();
    expect(result.rollup.unverified.drift).toBeNull();
  });

  it("reports null rates over an empty domain", () => {
    const result = score([], run([]));
    expect(result.rollup.probeCoverage).toBeNull();
    expect(result.rollup.verifiedCoverage).toBeNull();
    expect(result.rollup.detectionRateVsGT).toBeNull();
  });
});

describe("groundTruthHash stamping", () => {
  it("stamps the scoring block with the truth's hash", () => {
    const result = score([gtFrame(0, 0)], run([runPose(0)]), "hash-abc");
    expect(result.groundTruthHash).toBe("hash-abc");
  });

  it("re-flagging truth yields a new hash for subsequent runs to stamp", async () => {
    const frames = [gtFrame(0, 0)];
    const before = await hashGroundTruthInput({ frames, setupHash: "s1" });
    const reflagged = [
      gtFrame(0, 0, { state: "absent", joints: {}, review: "human-flagged-absent" }),
    ];
    const after = await hashGroundTruthInput({ frames: reflagged, setupHash: "s1" });
    expect(after).not.toBe(before);

    // A run scored against the re-flagged truth carries the new stamp — and a
    // different verdict — while anything posted under `before` is untouched.
    const result = score(reflagged, run([runPose(0)]), after);
    expect(result.groundTruthHash).toBe(after);
    expect(result.rollup.verified.counts.absentViolation).toBe(1);
  });
});

describe("findScoredRow", () => {
  it("finds the row for a timestamp within pairing tolerance", () => {
    const result = score([gtFrame(0, 0), gtFrame(1, 0.1)], run([runPose(0), runPose(0.1)]));
    expect(findScoredRow(result.rows, 0.1004)?.frameIndex).toBe(1);
    expect(findScoredRow(result.rows, 0.105)).toBeNull();
  });
});
