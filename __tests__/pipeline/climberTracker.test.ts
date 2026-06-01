import { describe, it, expect } from "vitest";
import {
  poseCentroid,
  poseBBox,
  predictCentroid,
  selectClimberPose,
  selectClimberByPoint,
  deriveClimberCrop,
  expandCropBox,
  DEFAULT_GATE,
} from "@/pipeline/climberTracker";
import type { Keypoint, PoseFrame } from "@/pipeline/poseDetection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kp(name: string, x: number, y: number, score = 0.9): Keypoint {
  return { name, x, y, score };
}

/**
 * A simple "person": four torso keypoints centred on (cx, cy) plus a head and
 * two ankles so the bbox has realistic vertical extent. `spread` controls torso
 * half-width/height. Centroid of the symmetric torso lands exactly on (cx, cy).
 */
function makePose(cx: number, cy: number, score = 0.9, spread = 0.05): PoseFrame {
  return {
    timestamp: 0,
    keypoints: [
      kp("nose", cx, cy - 0.18, score),
      kp("left_shoulder", cx - spread, cy - spread, score),
      kp("right_shoulder", cx + spread, cy - spread, score),
      kp("left_hip", cx - spread, cy + spread, score),
      kp("right_hip", cx + spread, cy + spread, score),
      kp("left_ankle", cx - spread, cy + 0.18, score),
      kp("right_ankle", cx + spread, cy + 0.18, score),
    ],
  };
}

// ---------------------------------------------------------------------------
// poseCentroid
// ---------------------------------------------------------------------------

describe("poseCentroid", () => {
  it("uses the torso keypoints (ignores head/limbs) for a stable centre", () => {
    const c = poseCentroid(makePose(0.5, 0.5).keypoints);
    expect(c!.x).toBeCloseTo(0.5);
    expect(c!.y).toBeCloseTo(0.5);
  });

  it("falls back to the mean of all keypoints when no torso keypoints exist", () => {
    const c = poseCentroid([kp("nose", 0.2, 0.2), kp("left_wrist", 0.4, 0.4)]);
    expect(c!.x).toBeCloseTo(0.3);
    expect(c!.y).toBeCloseTo(0.3);
  });

  it("returns null for an empty pose", () => {
    expect(poseCentroid([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// poseBBox
// ---------------------------------------------------------------------------

describe("poseBBox", () => {
  it("spans the min/max of all keypoints", () => {
    const bb = poseBBox([kp("a", 0.2, 0.3), kp("b", 0.6, 0.9)])!;
    expect(bb.x).toBeCloseTo(0.2);
    expect(bb.y).toBeCloseTo(0.3);
    expect(bb.w).toBeCloseTo(0.4);
    expect(bb.h).toBeCloseTo(0.6);
  });

  it("returns null for an empty pose", () => {
    expect(poseBBox([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// predictCentroid
// ---------------------------------------------------------------------------

describe("predictCentroid", () => {
  it("returns null with no history", () => {
    expect(predictCentroid([])).toBeNull();
  });

  it("returns the single sample unchanged", () => {
    expect(predictCentroid([{ x: 0.4, y: 0.5 }])).toEqual({ x: 0.4, y: 0.5 });
  });

  it("extrapolates last position + velocity", () => {
    // moving +0.1 in x, -0.05 in y per step → next ≈ 0.5, 0.4
    const p = predictCentroid([
      { x: 0.3, y: 0.5 },
      { x: 0.4, y: 0.45 },
    ]);
    expect(p!.x).toBeCloseTo(0.5);
    expect(p!.y).toBeCloseTo(0.4);
  });
});

// ---------------------------------------------------------------------------
// selectClimberPose
// ---------------------------------------------------------------------------

describe("selectClimberPose", () => {
  it("with no prediction, returns the strongest pose (count × confidence)", () => {
    const weak = makePose(0.3, 0.5, 0.4);
    const strong = makePose(0.7, 0.5, 0.95);
    const chosen = selectClimberPose([weak, strong], null);
    expect(poseCentroid(chosen!.keypoints)!.x).toBeCloseTo(0.7);
  });

  it("picks the candidate nearest the predicted position", () => {
    const climber = makePose(0.52, 0.5);
    const bystander = makePose(0.85, 0.5);
    const chosen = selectClimberPose([bystander, climber], { x: 0.5, y: 0.5 });
    expect(poseCentroid(chosen!.keypoints)!.x).toBeCloseTo(0.52);
  });

  it("returns null when every candidate is beyond the gate (climber lost)", () => {
    const faraway = makePose(0.9, 0.9);
    expect(selectClimberPose([faraway], { x: 0.2, y: 0.2 }, DEFAULT_GATE)).toBeNull();
  });

  it("does NOT switch to a bystander as they cross over the climber", () => {
    // Climber drifts right slowly; a bystander sweeps across from the left.
    // Each frame we predict from history and must keep selecting the climber.
    let history = [
      { x: 0.50, y: 0.5 },
      { x: 0.51, y: 0.5 },
    ];
    const climberPath = [0.52, 0.53, 0.54, 0.55];
    const bystanderPath = [0.30, 0.45, 0.60, 0.75]; // passes through the climber

    for (let f = 0; f < climberPath.length; f++) {
      const climber = makePose(climberPath[f], 0.5);
      const bystander = makePose(bystanderPath[f], 0.5);
      const predicted = predictCentroid(history)!;
      const chosen = selectClimberPose([bystander, climber], predicted);
      const cx = poseCentroid(chosen!.keypoints)!.x;
      // Always the climber, never the bystander.
      expect(cx).toBeCloseTo(climberPath[f]);
      history = [...history, { x: cx, y: 0.5 }];
    }
  });

  it("returns null for an empty candidate list", () => {
    expect(selectClimberPose([], null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// selectClimberByPoint
// ---------------------------------------------------------------------------

describe("selectClimberByPoint", () => {
  it("prefers the pose whose bounding box contains the tap", () => {
    const left = makePose(0.25, 0.5);
    const right = makePose(0.75, 0.5);
    const chosen = selectClimberByPoint([left, right], { x: 0.75, y: 0.5 });
    expect(poseCentroid(chosen!.keypoints)!.x).toBeCloseTo(0.75);
  });

  it("falls back to nearest centroid when the tap is inside no box", () => {
    const left = makePose(0.2, 0.5);
    const right = makePose(0.8, 0.5);
    // Tap between the two, outside both boxes — nearest centroid wins.
    const chosen = selectClimberByPoint([left, right], { x: 0.45, y: 0.5 });
    expect(poseCentroid(chosen!.keypoints)!.x).toBeCloseTo(0.2);
  });

  it("returns null when there are no candidates", () => {
    expect(selectClimberByPoint([], { x: 0.5, y: 0.5 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deriveClimberCrop
// ---------------------------------------------------------------------------

describe("deriveClimberCrop", () => {
  it("produces a padded pixel box around the pose, clamped to the frame", () => {
    const pose = makePose(0.5, 0.5); // bbox roughly x∈[0.45,0.55], y∈[0.32,0.68]
    const crop = deriveClimberCrop(pose.keypoints, 1000, 1000, 0.25)!;
    // Centred on (500, 500), within frame, non-degenerate.
    expect(crop.x).toBeGreaterThan(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1000);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1000);
    const ccx = crop.x + crop.width / 2;
    expect(ccx).toBeCloseTo(500, -1);
  });

  it("enforces a minimum crop size for a collapsed pose", () => {
    // A near-degenerate pose (all points stacked) must still yield ≥ MIN_CROP_FRAC.
    const tiny: Keypoint[] = [
      kp("left_hip", 0.5, 0.5),
      kp("right_hip", 0.5, 0.5),
      kp("left_shoulder", 0.5, 0.5),
      kp("right_shoulder", 0.5, 0.5),
    ];
    const crop = deriveClimberCrop(tiny, 1000, 1000)!;
    expect(crop.width).toBeGreaterThanOrEqual(180); // 0.18 * 1000
    expect(crop.height).toBeGreaterThanOrEqual(180);
  });

  it("clamps a pose near the frame edge", () => {
    const pose = makePose(0.04, 0.5);
    const crop = deriveClimberCrop(pose.keypoints, 1000, 1000)!;
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1000);
  });

  it("returns null for an empty pose", () => {
    expect(deriveClimberCrop([], 100, 100)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// expandCropBox
// ---------------------------------------------------------------------------

describe("expandCropBox", () => {
  it("grows the box on each side and clamps to the frame", () => {
    const out = expandCropBox({ x: 100, y: 100, width: 200, height: 200 }, 1000, 1000, 0.1);
    // dx = 20, dy = 20 → x 80, y 80, width 240, height 240
    expect(out).toEqual({ x: 80, y: 80, width: 240, height: 240 });
  });

  it("does not exceed frame bounds at the edge", () => {
    const out = expandCropBox({ x: 0, y: 0, width: 1000, height: 1000 }, 1000, 1000, 0.5);
    expect(out).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
  });
});
