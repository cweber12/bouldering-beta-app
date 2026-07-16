import { describe, it, expect } from "vitest";
import {
  coreJointsFromKeypoints,
  keypointsToPositions,
  contextKeypointsAt,
  buildGroundTruthScaffold,
  applyReviewFlag,
  reviewToFlag,
  hasAcceptedGroundTruth,
  countSeedCoverage,
  frameReviewMark,
  seedGateDecision,
  OCCLUSION_SEED_SCORE,
} from "@/utils/harnessGroundTruthScaffold";
import type { Keypoint } from "@/pipeline/pose/poseDetection";
import type { GroundTruthFrame, GroundTruthInput } from "@/utils/harnessGroundTruth";

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

  it("carries prior human flags onto the fresh seed by timestamp", () => {
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
        // Absent flag carries and clears joints.
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

    expect(gt.frames[1]).toMatchObject({ review: "human-flagged-absent", state: "absent" });
    expect(gt.frames[1].joints).toEqual({});

    // Unflagged frame re-seeds clean as auto.
    expect(gt.frames[2]).toMatchObject({ review: "auto", state: "present" });
  });

  it("carries flags across a Scan Setup change — truth is video-keyed, not setup-keyed", () => {
    const existing: GroundTruthInput = {
      setupHash: "setup-OLD",
      frames: [
        {
          frameIndex: 0,
          timestamp: 0.0,
          state: "absent",
          review: "human-flagged-absent",
          verified: true,
          joints: {},
        },
      ],
    };
    const gt = buildGroundTruthScaffold(detectionFrames, poseFrames, "setup-NEW", existing);
    // The setup changed, but a crop edit cannot invalidate full-frame truth.
    expect(gt.frames[0]).toMatchObject({ review: "human-flagged-absent", state: "absent" });
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
          state: "absent",
          review: "human-flagged-absent",
          verified: true,
          joints: {},
        },
      ],
    };
    const dense = Array.from({ length: 11 }, (_, i) => ({ timestamp: i * 0.1 }));
    const gt = buildGroundTruthScaffold(dense, poseFrames, "setup-1", existing);

    expect(gt.frames).toHaveLength(11);
    expect(gt.frames[5]).toMatchObject({ timestamp: 0.5, review: "human-flagged-absent" });
    // Frames the sparse grid never held arrive auto-accepted.
    expect(gt.frames[1]).toMatchObject({ timestamp: 0.1, review: "auto" });
  });
});

describe("reviewToFlag", () => {
  it("maps persisted review values to UI flags, legacy human as auto", () => {
    expect(reviewToFlag("auto")).toBe("auto");
    expect(reviewToFlag("human-flagged-wrong")).toBe("wrong");
    expect(reviewToFlag("human-flagged-absent")).toBe("absent");
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

  it("flags Absent as absent, clearing the joints", () => {
    const out = applyReviewFlag(seedPresent, "absent");
    expect(out).toMatchObject({ review: "human-flagged-absent", state: "absent" });
    expect(out.joints).toEqual({});
    expect(seedPresent.joints.nose).toBeDefined(); // input not mutated
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

