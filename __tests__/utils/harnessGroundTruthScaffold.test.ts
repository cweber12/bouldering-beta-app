import { describe, it, expect } from "vitest";
import {
  coreJointsFromKeypoints,
  keypointsToPositions,
  contextKeypointsAt,
  buildGroundTruthScaffold,
  applyReviewFlag,
  deriveFrameFlags,
  materializeReview,
  reconstructControlPoints,
  reviewToFlag,
  hasAcceptedGroundTruth,
  countSeedCoverage,
  frameReviewMark,
  reseedAffordanceDecision,
  seedGateDecision,
  OCCLUSION_SEED_SCORE,
  type ReviewFlag,
} from "@/utils/harnessGroundTruthScaffold";
import type { Keypoint } from "@/pipeline/pose/poseDetection";
import type { GroundTruthFrame, GroundTruthInput } from "@/utils/harnessGroundTruth";
import type { ViTPoseScaffold } from "@/utils/harnessViTPose";

function kp(name: string, x: number, y: number, score = 0.9): Keypoint {
  return { name, x, y, score };
}

describe("coreJointsFromKeypoints", () => {
  it("keeps only core joints and drops face/hand context points", () => {
    const joints = coreJointsFromKeypoints([
      kp("nose", 0.5, 0.1),
      kp("left_wrist", 0.4, 0.6),
      kp("left_eye", 0.52, 0.09), // non-core → dropped
      kp("left_index", 0.38, 0.62), // non-core → dropped
    ]);
    expect(Object.keys(joints).sort()).toEqual(["left_wrist", "nose"]);
    expect(joints.nose).toEqual({ x: 0.5, y: 0.1, occluded: false });
  });

  it("seeds occluded from a low confidence score", () => {
    const joints = coreJointsFromKeypoints([
      kp("left_wrist", 0.4, 0.6, OCCLUSION_SEED_SCORE - 0.01),
    ]);
    expect(joints.left_wrist.occluded).toBe(true);
  });

  it("clamps positions into the frame", () => {
    const joints = coreJointsFromKeypoints([kp("nose", 1.4, -0.2)]);
    expect(joints.nose.x).toBe(1);
    expect(joints.nose.y).toBe(0);
  });
});

describe("keypointsToPositions / contextKeypointsAt", () => {
  it("maps every keypoint to a bare position", () => {
    expect(keypointsToPositions([kp("nose", 0.5, 0.1), kp("left_eye", 0.52, 0.09)])).toEqual({
      nose: { x: 0.5, y: 0.1 },
      left_eye: { x: 0.52, y: 0.09 },
    });
  });

  it("returns the pose nearest the timestamp, or empty when none matches", () => {
    const poses = [{ timestamp: 1.0, keypoints: [kp("nose", 0.5, 0.1)] }];
    expect(contextKeypointsAt(poses, 1.0)).toEqual({ nose: { x: 0.5, y: 0.1 } });
    expect(contextKeypointsAt(poses, 5.0)).toEqual({});
  });
});

describe("buildGroundTruthScaffold", () => {
  // The Detection Frame grid: uniform 100 ms timestamps, no detector verdicts.
  const detectionFrames = [{ timestamp: 0.0 }, { timestamp: 0.5 }, { timestamp: 1.0 }];
  const poseFrames = [
    { timestamp: 0.0, keypoints: [kp("nose", 0.5, 0.1), kp("left_wrist", 0.4, 0.6)] },
    { timestamp: 0.5, keypoints: [kp("nose", 0.5, 0.15)] },
    { timestamp: 1.0, keypoints: [kp("nose", 0.5, 0.2)] },
  ];

  it("seeds every frame auto-accepted, keying present/absent off the scaffold pose", () => {
    const gt = buildGroundTruthScaffold(detectionFrames, poseFrames, "setup-1", null);
    expect(gt.frames).toHaveLength(3);
    expect(gt.setupHash).toBe("setup-1");

    expect(gt.frames[0]).toMatchObject({
      frameIndex: 0,
      state: "present",
      review: "auto",
      verified: false,
    });
    expect(Object.keys(gt.frames[0].joints).sort()).toEqual(["left_wrist", "nose"]);

    expect(gt.frames[1]).toMatchObject({ frameIndex: 1, state: "present", review: "auto" });
    expect(Object.keys(gt.frames[1].joints)).toEqual(["nose"]);

    expect(gt.frames[2]).toMatchObject({ frameIndex: 2, state: "present", review: "auto" });
  });

  it("seeds occluded flags from the scaffold confidence, kept on the seed", () => {
    const frames = [{ timestamp: 0.0 }];
    const poses = [{ timestamp: 0.0, keypoints: [kp("nose", 0.5, 0.1, OCCLUSION_SEED_SCORE - 0.1)] }];
    const gt = buildGroundTruthScaffold(frames, poses, "setup-1", null);
    expect(gt.frames[0].joints.nose.occluded).toBe(true);
  });

  it("marks a frame seeded-absent when no scaffold pose matches its timestamp", () => {
    const gt = buildGroundTruthScaffold(
      [{ timestamp: 9.0 }],
      poseFrames,
      "setup-1",
      null,
    );
    expect(gt.frames[0]).toMatchObject({ state: "absent", review: "auto" });
    expect(gt.frames[0].joints).toEqual({});
  });

  it("carries a prior Wrong flag onto the fresh seed by timestamp, soft-retiring Absent to auto", () => {
    const existing: GroundTruthInput = {
      setupHash: "setup-1",
      frames: [
        // Wrong flag carries; joints come from the new seed, not the old file.
        {
          frameIndex: 0,
          timestamp: 0.0,
          state: "present",
          review: "human-flagged-wrong",
          verified: true,
          joints: { nose: { x: 0.9, y: 0.9, occluded: false } },
        },
        // Legacy Absent flag soft-retires to auto (ADR 0005 — presence follows the seed).
        {
          frameIndex: 1,
          timestamp: 0.5,
          state: "absent",
          review: "human-flagged-absent",
          verified: true,
          joints: {},
        },
      ],
    };
    const gt = buildGroundTruthScaffold(detectionFrames, poseFrames, "setup-1", existing);

    expect(gt.frames[0].review).toBe("human-flagged-wrong");
    expect(gt.frames[0].state).toBe("present");
    // Joints re-seeded from the new poses, not the stale 0.9/0.9 from the old file.
    expect(gt.frames[0].joints).toEqual(coreJointsFromKeypoints(poseFrames[0].keypoints));

    // The carried Absent is dropped to auto; presence comes from the fresh seed.
    expect(gt.frames[1]).toMatchObject({ review: "auto", state: "present" });

    // Unflagged frame re-seeds clean as auto.
    expect(gt.frames[2]).toMatchObject({ review: "auto", state: "present" });
  });

  it("drops a carried Wrong onto a now-empty seed frame to seeded-absent auto", () => {
    // The prior review flagged t=9.0 Wrong, but the fresh seed poses nobody there
    // (no matching pose) — the carry-forward guard must not fabricate a
    // present-with-empty-joints frame.
    const existing: GroundTruthInput = {
      setupHash: "setup-1",
      frames: [
        {
          frameIndex: 0,
          timestamp: 9.0,
          state: "present",
          review: "human-flagged-wrong",
          verified: true,
          joints: { nose: { x: 0.5, y: 0.5, occluded: false } },
        },
      ],
    };
    const gt = buildGroundTruthScaffold([{ timestamp: 9.0 }], poseFrames, "setup-1", existing);
    expect(gt.frames[0]).toMatchObject({ review: "auto", state: "absent" });
    expect(gt.frames[0].joints).toEqual({});
  });

  it("carries a Wrong flag across a Scan Setup change — truth is video-keyed, not setup-keyed", () => {
    const existing: GroundTruthInput = {
      setupHash: "setup-OLD",
      frames: [
        {
          frameIndex: 0,
          timestamp: 0.0,
          state: "present",
          review: "human-flagged-wrong",
          verified: true,
          joints: {},
        },
      ],
    };
    const gt = buildGroundTruthScaffold(detectionFrames, poseFrames, "setup-NEW", existing);
    // The setup changed, but a crop edit cannot invalidate full-frame truth.
    expect(gt.frames[0]).toMatchObject({ review: "human-flagged-wrong", state: "present" });
    // setupHash rides along as seed provenance only.
    expect(gt.setupHash).toBe("setup-NEW");
  });

  it("carries flags from legacy hash-less truth", () => {
    const existing: GroundTruthInput = {
      setupHash: "",
      frames: [
        {
          frameIndex: 0,
          timestamp: 0.0,
          state: "present",
          review: "human-flagged-wrong",
          verified: true,
          joints: {},
        },
      ],
    };
    const gt = buildGroundTruthScaffold(detectionFrames, poseFrames, "setup-1", existing);
    expect(gt.frames[0].review).toBe("human-flagged-wrong");
  });

  it("densifies a sparse legacy grid, matching flags by timestamp not frame index", () => {
    // Legacy truth on a 500 ms grid: index 1 is t=0.5. The fresh 100 ms grid puts
    // t=0.5 at index 5, so index-keyed carry-forward would land the flag on t=0.1.
    const existing: GroundTruthInput = {
      setupHash: "setup-1",
      frames: [
        {
          frameIndex: 0,
          timestamp: 0.0,
          state: "present",
          review: "auto",
          verified: true,
          joints: {},
        },
        {
          frameIndex: 1,
          timestamp: 0.5,
          state: "present",
          review: "human-flagged-wrong",
          verified: true,
          joints: {},
        },
      ],
    };
    const dense = Array.from({ length: 11 }, (_, i) => ({ timestamp: i * 0.1 }));
    const gt = buildGroundTruthScaffold(dense, poseFrames, "setup-1", existing);

    expect(gt.frames).toHaveLength(11);
    expect(gt.frames[5]).toMatchObject({ timestamp: 0.5, review: "human-flagged-wrong" });
    // Frames the sparse grid never held arrive auto-accepted.
    expect(gt.frames[1]).toMatchObject({ timestamp: 0.1, review: "auto" });
  });
});

describe("reviewToFlag", () => {
  it("maps persisted review values to two-state UI flags, soft-retiring absent/human to auto", () => {
    expect(reviewToFlag("auto")).toBe("auto");
    expect(reviewToFlag("human-flagged-wrong")).toBe("wrong");
    // Deprecated absent and forward-compat human both read as auto (ADR 0005).
    expect(reviewToFlag("human-flagged-absent")).toBe("auto");
    expect(reviewToFlag("human")).toBe("auto");
  });
});

describe("applyReviewFlag", () => {
  const seedPresent: GroundTruthFrame = {
    frameIndex: 1,
    timestamp: 0.5,
    state: "present",
    review: "auto",
    verified: false,
    joints: { nose: { x: 0.5, y: 0.2, occluded: false } },
  };
  const seedAbsent: GroundTruthFrame = {
    frameIndex: 2,
    timestamp: 1.0,
    state: "absent",
    review: "auto",
    verified: false,
    joints: {},
  };

  it("restores the seed verbatim when unflagged back to auto", () => {
    const wrong = applyReviewFlag(seedPresent, "wrong");
    expect(applyReviewFlag(wrong, "auto")).toMatchObject({ review: "auto", state: "present" });
    expect(applyReviewFlag(seedPresent, "auto").joints).toEqual(seedPresent.joints);
  });

  it("flags Wrong as present, keeping the seed joints as known-bad", () => {
    const out = applyReviewFlag(seedPresent, "wrong");
    expect(out).toMatchObject({ review: "human-flagged-wrong", state: "present" });
    expect(out.joints).toEqual(seedPresent.joints);
  });

  it("flips a seeded-absent frame flagged Wrong to present with empty joints", () => {
    const out = applyReviewFlag(seedAbsent, "wrong");
    expect(out).toMatchObject({ review: "human-flagged-wrong", state: "present" });
    expect(out.joints).toEqual({});
  });

  it("never mutates the input seed frame", () => {
    applyReviewFlag(seedPresent, "wrong");
    expect(seedPresent.review).toBe("auto");
    expect(seedPresent.joints.nose).toBeDefined();
  });
});

describe("deriveFrameFlags", () => {
  // A seeded frame poses somebody (present) or nobody (seeded-absent, 0 joints).
  function seed(frameIndex: number, hasJoints: boolean): GroundTruthFrame {
    return {
      frameIndex,
      timestamp: frameIndex * 0.1,
      state: hasJoints ? "present" : "absent",
      review: "auto",
      verified: false,
      joints: hasJoints ? { nose: { x: 0.5, y: 0.5, occluded: false } } : {},
    };
  }

  function fills(frames: GroundTruthFrame[], cps: Map<number, ReviewFlag>): ReviewFlag[] {
    const flags = deriveFrameFlags(frames, cps);
    return frames.map((f) => flags.get(f.frameIndex)!);
  }

  it("fills each frame from the nearest preceding control point, defaulting to auto", () => {
    const frames = [0, 1, 2, 3, 4].map((i) => seed(i, true));
    const cps = new Map<number, ReviewFlag>([
      [1, "wrong"],
      [3, "auto"],
    ]);
    expect(fills(frames, cps)).toEqual(["auto", "wrong", "wrong", "auto", "auto"]);
  });

  it("sorts by frame index before deriving", () => {
    const frames = [seed(2, true), seed(0, true), seed(1, true)];
    expect(fills(frames, new Map([[0, "wrong"]]))).toEqual(["wrong", "wrong", "wrong"]);
  });

  it("keeps a zero-joint frame seeded-absent and bridges a Wrong stretch across it", () => {
    // Frame 2 posed nobody: it stays auto, and the Wrong from frame 1 continues.
    const frames = [seed(0, true), seed(1, true), seed(2, false), seed(3, true)];
    const flags = deriveFrameFlags(frames, new Map([[1, "wrong"]]));
    expect(flags.get(1)).toBe("wrong");
    expect(flags.get(2)).toBe("auto"); // empty-joint exception
    expect(flags.get(3)).toBe("wrong"); // bridged across the gap
  });

  it("ignores a control point that lands on a zero-joint frame", () => {
    const frames = [seed(0, true), seed(1, false), seed(2, true)];
    // The Auto on the empty frame is a no-op — it must not terminate the stretch.
    const flags = deriveFrameFlags(
      frames,
      new Map<number, ReviewFlag>([
        [0, "wrong"],
        [1, "auto"],
      ]),
    );
    expect(flags.get(2)).toBe("wrong");
  });
});

describe("materializeReview", () => {
  function seed(frameIndex: number, hasJoints: boolean): GroundTruthFrame {
    return {
      frameIndex,
      timestamp: frameIndex * 0.1,
      state: hasJoints ? "present" : "absent",
      review: "auto",
      verified: false,
      joints: hasJoints ? { nose: { x: 0.5, y: 0.5, occluded: false } } : {},
    };
  }

  it("materializes a Wrong segment to human-flagged-wrong, keeping the seed joints", () => {
    const frames = [seed(0, true), seed(1, true), seed(2, true)];
    const out = materializeReview(frames, new Map([[1, "wrong"]]));
    expect(out[0]).toMatchObject({ review: "auto", state: "present" });
    expect(out[1]).toMatchObject({ review: "human-flagged-wrong", state: "present" });
    expect(out[1].joints).toEqual(frames[1].joints);
    expect(out[2].review).toBe("human-flagged-wrong");
  });

  it("never emits human-flagged-absent: zero-joint frames stay auto/absent even under a Wrong stretch", () => {
    const frames = [seed(0, true), seed(1, false), seed(2, true)];
    const out = materializeReview(frames, new Map([[0, "wrong"]]));
    expect(out[1]).toMatchObject({ review: "auto", state: "absent" });
    expect(out[1].joints).toEqual({});
    expect(out.some((f) => f.review === "human-flagged-absent")).toBe(false);
    // The Wrong stretch still bridged across the seeded-absent gap.
    expect(out[2].review).toBe("human-flagged-wrong");
  });
});

describe("reconstructControlPoints", () => {
  function seed(frameIndex: number, hasJoints: boolean): GroundTruthFrame {
    return {
      frameIndex,
      timestamp: frameIndex * 0.1,
      state: hasJoints ? "present" : "absent",
      review: "auto",
      verified: false,
      joints: hasJoints ? { nose: { x: 0.5, y: 0.5, occluded: false } } : {},
    };
  }
  function wrong(frameIndex: number): GroundTruthFrame {
    return { ...seed(frameIndex, true), review: "human-flagged-wrong" };
  }

  it("plants a control point only where a seeded frame's flag changes", () => {
    // auto, auto, wrong, wrong, auto → boundaries at index 2 (wrong) and 4 (auto).
    const frames = [seed(0, true), seed(1, true), wrong(2), wrong(3), seed(4, true)];
    expect([...reconstructControlPoints(frames).entries()]).toEqual([
      [2, "wrong"],
      [4, "auto"],
    ]);
  });

  it("skips a seeded-absent gap inside a Wrong stretch, adding no boundary", () => {
    // wrong, (absent gap), wrong → one stretch, so only the opening boundary.
    const frames = [seed(0, true), wrong(1), seed(2, false), wrong(3)];
    expect([...reconstructControlPoints(frames).entries()]).toEqual([[1, "wrong"]]);
  });

  it("returns no control points for an all-auto scaffold", () => {
    const frames = [seed(0, true), seed(1, false), seed(2, true)];
    expect(reconstructControlPoints(frames).size).toBe(0);
  });
});

describe("derive/materialize/reconstruct round-trip", () => {
  function frames(spec: boolean[]): GroundTruthFrame[] {
    return spec.map(
      (hasJoints, i): GroundTruthFrame => ({
        frameIndex: i,
        timestamp: i * 0.1,
        state: hasJoints ? "present" : "absent",
        review: "auto",
        verified: false,
        joints: hasJoints ? { nose: { x: 0.5, y: 0.5, occluded: false } } : {},
      }),
    );
  }

  function fill(seeds: GroundTruthFrame[], cps: Map<number, ReviewFlag>): ReviewFlag[] {
    const derived = deriveFrameFlags(seeds, cps);
    return seeds.map((f) => derived.get(f.frameIndex)!);
  }

  it("reconstruct(materialize(...)) preserves the derived fill, gaps and all", () => {
    // Seeded frames with a zero-joint gap at index 3.
    const seeds = frames([true, true, true, false, true, true]);
    const cases: Map<number, ReviewFlag>[] = [
      new Map([[1, "wrong"]]), // Wrong bridging the gap at 3
      new Map([
        [1, "wrong"],
        [4, "auto"],
      ]),
      new Map([[0, "wrong"]]), // Wrong from the very first frame
      new Map(), // all auto
    ];
    for (const cps of cases) {
      const materialized = materializeReview(seeds, cps);
      const reconstructed = reconstructControlPoints(materialized);
      expect(fill(seeds, reconstructed)).toEqual(fill(seeds, cps));
    }
  });
});

describe("hasAcceptedGroundTruth", () => {
  const frame: GroundTruthFrame = {
    frameIndex: 0,
    timestamp: 0,
    state: "present",
    review: "auto",
    verified: true,
    joints: {},
  };

  it("is false with no truth at all, or truth holding no frames", () => {
    expect(hasAcceptedGroundTruth(null)).toBe(false);
    expect(hasAcceptedGroundTruth({ setupHash: "setup-1", frames: [] })).toBe(false);
  });

  it("is true for saved truth holding frames, whatever setup seeded it", () => {
    expect(hasAcceptedGroundTruth({ setupHash: "setup-OLD", frames: [frame] })).toBe(true);
    // Legacy hash-less truth counts too — accepted truth is keyed to the video.
    expect(hasAcceptedGroundTruth({ setupHash: "", frames: [frame] })).toBe(true);
  });
});

describe("countSeedCoverage", () => {
  it("counts posed and seeded-absent frames, ignoring legacy skip", () => {
    const frames: GroundTruthFrame[] = [
      { frameIndex: 0, timestamp: 0, state: "present", review: "auto", verified: true, joints: {} },
      { frameIndex: 1, timestamp: 1, state: "absent", review: "auto", verified: true, joints: {} },
      { frameIndex: 2, timestamp: 2, state: "present", review: "auto", verified: true, joints: {} },
      { frameIndex: 3, timestamp: 3, state: "skip", review: "auto", verified: true, joints: {} },
    ];
    expect(countSeedCoverage(frames)).toEqual({ posed: 2, seededAbsent: 1 });
  });
});

describe("frameReviewMark", () => {
  function frame(review: GroundTruthFrame["review"], state: GroundTruthFrame["state"]): GroundTruthFrame {
    return { frameIndex: 0, timestamp: 0, state, review, verified: true, joints: {} };
  }

  it("maps human flags to their own marks, regardless of state", () => {
    expect(frameReviewMark(frame("human-flagged-wrong", "present"))).toBe("flagged-wrong");
    expect(frameReviewMark(frame("human-flagged-absent", "absent"))).toBe("flagged-absent");
  });

  it("marks an auto frame the seed left untracked as seeded-absent", () => {
    expect(frameReviewMark(frame("auto", "absent"))).toBe("seeded-absent");
  });

  it("gives an ordinary auto pose no distinguishing mark", () => {
    expect(frameReviewMark(frame("auto", "present"))).toBe("auto");
    // Legacy skip frames read as auto — the new flow never produces them.
    expect(frameReviewMark(frame("auto", "skip"))).toBe("auto");
  });
});

describe("reseedAffordanceDecision", () => {
  const scaffold = (setupHash: string | undefined, posed: boolean): ViTPoseScaffold => ({
    version: 1,
    ...(setupHash ? { setupHash } : {}),
    frames: [{ timestamp: 0.1, keypoints: posed ? [{ name: "nose", x: 0.5, y: 0.5, score: 0.9 }] : [] }],
  });

  it("offers review-seed for a fresh, posed scaffold", () => {
    expect(reseedAffordanceDecision(scaffold("h1", true), "h1")).toBe("review-seed");
  });

  it("offers review-seed for a legacy unstamped scaffold (freshness fallback)", () => {
    expect(reseedAffordanceDecision(scaffold(undefined, true), "h1")).toBe("review-seed");
  });

  it("falls back to run-job when the scaffold is stale or missing", () => {
    expect(reseedAffordanceDecision(scaffold("old", true), "new")).toBe("run-job");
    expect(reseedAffordanceDecision(null, "h1")).toBe("run-job");
  });

  it("falls back to run-job for a poseless scaffold — authoring would refuse it", () => {
    expect(reseedAffordanceDecision(scaffold("h1", false), "h1")).toBe("run-job");
  });
});

describe("seedGateDecision", () => {
  it("enables authoring once ViTPose lands with a posed frame", () => {
    expect(
      seedGateDecision({ vitposeStatus: "ready", vitposeError: null, seedHasPose: true }),
    ).toEqual({ authoring: "ready" });
  });

  it("disables authoring when ViTPose landed but tracked no climber", () => {
    expect(
      seedGateDecision({ vitposeStatus: "ready", vitposeError: null, seedHasPose: false }),
    ).toEqual({ authoring: "disabled", reason: "ViTPose tracked no climber." });
  });

  it("disables authoring with the error on ViTPose failure", () => {
    expect(
      seedGateDecision({ vitposeStatus: "failed", vitposeError: "job timed out", seedHasPose: false }),
    ).toEqual({ authoring: "disabled", reason: "job timed out" });
    expect(
      seedGateDecision({ vitposeStatus: "failed", vitposeError: null, seedHasPose: false }),
    ).toEqual({ authoring: "disabled", reason: "ViTPose scaffold failed." });
  });

  it("is pending while the job is idle, requesting, or polling", () => {
    for (const vitposeStatus of ["idle", "requesting", "polling"] as const) {
      expect(seedGateDecision({ vitposeStatus, vitposeError: null, seedHasPose: false })).toEqual({
        authoring: "pending",
      });
    }
  });
});

