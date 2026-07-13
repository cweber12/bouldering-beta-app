import { describe, it, expect } from "vitest";
import {
  coreJointsFromKeypoints,
  keypointsToPositions,
  contextKeypointsAt,
  buildGroundTruthScaffold,
  moveJoint,
  setJoint,
  translateJoints,
  jointDrift,
  OCCLUSION_SEED_SCORE,
} from "@/utils/harnessGroundTruthScaffold";
import type { Keypoint } from "@/pipeline/pose/poseDetection";
import type { GroundTruthInput, GroundTruthJoint } from "@/utils/harnessGroundTruth";

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
  const detectionFrames = [
    { timestamp: 0.0, status: "detected" },
    { timestamp: 0.5, status: "missing" },
    { timestamp: 1.0, status: "weak" },
  ];
  const poseFrames = [
    { timestamp: 0.0, keypoints: [kp("nose", 0.5, 0.1), kp("left_wrist", 0.4, 0.6)] },
    { timestamp: 1.0, keypoints: [kp("nose", 0.5, 0.2)] },
  ];

  it("seeds present frames from the scaffold and absent for missing frames", () => {
    const gt = buildGroundTruthScaffold(detectionFrames, poseFrames, null);
    expect(gt.frames).toHaveLength(3);

    expect(gt.frames[0]).toMatchObject({ frameIndex: 0, state: "present", verified: false });
    expect(Object.keys(gt.frames[0].joints).sort()).toEqual(["left_wrist", "nose"]);

    // Missing status → absent, no joints, even if a pose existed nearby.
    expect(gt.frames[1]).toMatchObject({ frameIndex: 1, state: "absent" });
    expect(gt.frames[1].joints).toEqual({});

    // Weak but detected → present with whatever joints exist.
    expect(gt.frames[2]).toMatchObject({ frameIndex: 2, state: "present" });
  });

  it("marks a frame absent when no scaffold pose matches its timestamp", () => {
    const gt = buildGroundTruthScaffold([{ timestamp: 9.0, status: "detected" }], poseFrames, null);
    expect(gt.frames[0]).toMatchObject({ state: "absent" });
    expect(gt.frames[0].joints).toEqual({});
  });

  it("preserves previously-authored frames across a re-scan", () => {
    const existing: GroundTruthInput = {
      frames: [
        {
          frameIndex: 0,
          timestamp: 0.0,
          state: "present",
          verified: true,
          joints: { nose: { x: 0.9, y: 0.9, occluded: false } },
        },
      ],
    };
    const gt = buildGroundTruthScaffold(detectionFrames, poseFrames, existing);
    // Frame 0 kept verbatim from the human's prior edit; others re-seeded.
    expect(gt.frames[0]).toEqual(existing.frames[0]);
    expect(gt.frames[1].verified).toBe(false);
  });
});

describe("moveJoint / translateJoints", () => {
  const joints: Record<string, GroundTruthJoint> = {
    nose: { x: 0.5, y: 0.2, occluded: false },
    left_wrist: { x: 0.4, y: 0.6, occluded: true },
  };

  it("moves one joint and clamps, leaving others untouched", () => {
    const out = moveJoint(joints, "nose", 1.5, 0.3);
    expect(out.nose).toEqual({ x: 1, y: 0.3, occluded: false });
    expect(out.left_wrist).toBe(joints.left_wrist);
  });

  it("ignores a move for an absent joint", () => {
    expect(moveJoint(joints, "right_ankle", 0.1, 0.1)).toBe(joints);
  });

  it("translates every joint, preserving occluded flags and clamping", () => {
    const out = translateJoints(joints, 0.7, -0.1);
    expect(out.nose).toEqual({ x: 1, y: 0.1, occluded: false }); // 0.5+0.7 clamps to 1
    expect(out.left_wrist).toEqual({ x: 1, y: 0.5, occluded: true }); // 0.4+0.7 clamps to 1
  });
});

describe("setJoint", () => {
  it("places a missing joint, clamped, without touching others", () => {
    const joints: Record<string, GroundTruthJoint> = {
      nose: { x: 0.5, y: 0.2, occluded: false },
    };
    const out = setJoint(joints, "left_wrist", 1.2, 0.4);
    expect(out.left_wrist).toEqual({ x: 1, y: 0.4, occluded: false });
    expect(out.nose).toBe(joints.nose);
  });

  it("replaces an existing joint and can seed it occluded", () => {
    const out = setJoint({ nose: { x: 0.1, y: 0.1, occluded: false } }, "nose", 0.5, 0.5, true);
    expect(out.nose).toEqual({ x: 0.5, y: 0.5, occluded: true });
  });
});

describe("jointDrift", () => {
  it("reports max, mean, and moved count against the seed", () => {
    const seed: Record<string, GroundTruthJoint> = {
      nose: { x: 0.5, y: 0.5, occluded: false },
      left_wrist: { x: 0.5, y: 0.5, occluded: false },
    };
    const current: Record<string, GroundTruthJoint> = {
      nose: { x: 0.5, y: 0.5, occluded: false }, // unmoved
      left_wrist: { x: 0.8, y: 0.5, occluded: false }, // moved 0.3
    };
    const drift = jointDrift(seed, current);
    expect(drift.maxDist).toBeCloseTo(0.3, 6);
    expect(drift.meanDist).toBeCloseTo(0.15, 6);
    expect(drift.movedJoints).toBe(1);
  });

  it("ignores joints missing from the seed", () => {
    const drift = jointDrift({}, { nose: { x: 0.1, y: 0.1, occluded: false } });
    expect(drift).toEqual({ maxDist: 0, meanDist: 0, movedJoints: 0 });
  });
});
