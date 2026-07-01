import { describe, it, expect } from "vitest";
import {
  poseCentroid,
  poseBBox,
  predictCentroid,
  scorePoseFrame,
  selectClimberPose,
  selectClimberByPoint,
  deriveClimberCrop,
  findMissingLimbs,
  expandCropBox,
  pickAcquisitionRegion,
  predictDetectionRegion,
  DEFAULT_GATE,
  ABS_MIN_CROP_FRAC,
  REACH_MAX_EXPANSION,
  REGION_BASE_SLACK,
} from "@/pipeline/tracking/climberTracker";
import type { Keypoint, PoseFrame } from "@/pipeline/pose/poseDetection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kp(name: string, x: number, y: number, score = 0.9): Keypoint {
  return { name, x, y, score };
}

/**
 * A complete "person": torso, head, and both full limb chains (elbows/wrists,
 * knees/ankles). All limb keypoints sit inside the torso↔ankle bbox so the box
 * extent is set by shoulders/hips/nose/ankles — i.e. adding the limbs does not
 * change the bbox, but the pose has **no missing limbs**, so the reach-disk
 * expansion (ADR 0014) does not fire on it. `spread` controls torso
 * half-width/height. Centroid of the symmetric torso lands exactly on (cx, cy).
 */
function makePose(cx: number, cy: number, score = 0.9, spread = 0.05): PoseFrame {
  return {
    timestamp: 0,
    keypoints: [
      kp("nose", cx, cy - 0.18, score),
      kp("left_shoulder", cx - spread, cy - spread, score),
      kp("right_shoulder", cx + spread, cy - spread, score),
      kp("left_elbow", cx - spread, cy, score),
      kp("right_elbow", cx + spread, cy, score),
      kp("left_wrist", cx - spread, cy + spread, score),
      kp("right_wrist", cx + spread, cy + spread, score),
      kp("left_hip", cx - spread, cy + spread, score),
      kp("right_hip", cx + spread, cy + spread, score),
      kp("left_knee", cx - spread, cy + 0.1, score),
      kp("right_knee", cx + spread, cy + 0.1, score),
      kp("left_ankle", cx - spread, cy + 0.18, score),
      kp("right_ankle", cx + spread, cy + 0.18, score),
    ],
  };
}

/** Drop keypoints by name from a pose (to simulate a limb MediaPipe missed). */
function without(pose: PoseFrame, ...names: string[]): Keypoint[] {
  const drop = new Set(names);
  return pose.keypoints.filter((k) => !drop.has(k.name));
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

  it("pads generously and proportional to the climber, taller than wide", () => {
    const pose = makePose(0.5, 0.5); // bbox w=0.1, h=0.36
    const crop = deriveClimberCrop(pose.keypoints, 1000, 1000)!; // default pad 0.6, v-bias 1.25
    // Width ≈ 1.6 × bbox (0.1 → 0.16), height ≈ 1.75 × bbox (0.36 → 0.63).
    expect(crop.width).toBeCloseTo(160, -1);
    expect(crop.height).toBeCloseTo(630, -1);
    // The vertical pad fraction exceeds the horizontal one (upward-reach bias).
    const widthRatio = crop.width / (0.1 * 1000);
    const heightRatio = crop.height / (0.36 * 1000);
    expect(heightRatio).toBeGreaterThan(widthRatio);
  });

  it("falls back to only an absolute floor for a collapsed pose (climber-proportional, not frame-proportional)", () => {
    // A near-degenerate pose (all points stacked) hits the small absolute guard,
    // not the old 0.18-of-frame floor.
    const tiny: Keypoint[] = [
      kp("left_hip", 0.5, 0.5),
      kp("right_hip", 0.5, 0.5),
      kp("left_shoulder", 0.5, 0.5),
      kp("right_shoulder", 0.5, 0.5),
    ];
    const crop = deriveClimberCrop(tiny, 1000, 1000)!;
    expect(crop.width).toBeCloseTo(ABS_MIN_CROP_FRAC * 1000, -1); // ≈ 60
    expect(crop.height).toBeCloseTo(ABS_MIN_CROP_FRAC * 1000, -1);
    expect(crop.width).toBeLessThan(180); // smaller than the old frame-proportional floor
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
// findMissingLimbs (ADR 0014)
// ---------------------------------------------------------------------------

describe("findMissingLimbs", () => {
  it("reports nothing for a complete pose", () => {
    expect(findMissingLimbs(makePose(0.5, 0.5).keypoints)).toEqual([]);
  });

  it("flags a limb whose endpoint is absent but whose anchor is present", () => {
    const pose = without(makePose(0.5, 0.5), "left_wrist");
    expect(findMissingLimbs(pose)).toEqual(["left_arm"]);
  });

  it("is anchor-gated: a missing endpoint with no anchor is not actionable", () => {
    const pose = without(makePose(0.5, 0.5), "left_wrist", "left_shoulder");
    expect(findMissingLimbs(pose)).toEqual([]);
  });

  it("flags both legs when both ankles are gone", () => {
    const pose = without(makePose(0.5, 0.5), "left_ankle", "right_ankle");
    expect(findMissingLimbs(pose)).toEqual(["left_leg", "right_leg"]);
  });
});

// ---------------------------------------------------------------------------
// deriveClimberCrop — missing-limb reach expansion (ADR 0014)
// ---------------------------------------------------------------------------

describe("deriveClimberCrop reach expansion", () => {
  // makePose(0.5, 0.5): bbox x∈[0.45,0.55], y∈[0.32,0.68]. Normal box (pad 0.6,
  // v-bias 1.25): x∈[0.42,0.58] (420..580), y∈[0.185,0.815].
  const full = deriveClimberCrop(makePose(0.5, 0.5).keypoints, 1000, 1000)!;

  it("does not expand a complete pose", () => {
    expect(full.x).toBe(420);
    expect(full.width).toBe(160);
  });

  it("grows the box outward on the side of a missing limb", () => {
    // Left arm missing (wrist gone, shoulder present). The disk sits on the left
    // shoulder, pushing the left edge out; the bbox is unchanged by dropping the
    // wrist, so the only difference is the reach disk.
    const crop = deriveClimberCrop(without(makePose(0.5, 0.5), "left_wrist"), 1000, 1000)!;
    expect(crop.x).toBeLessThan(full.x); // left edge moved outward
    expect(crop.width).toBeGreaterThan(full.width);
  });

  it("sizes the disk from the contralateral (mirror) limb when present", () => {
    // Mirror right arm has segment sum 0.1 → radius 0.108. Left edge → ~0.342,
    // i.e. expanded but inside the cap floor (0.34).
    const crop = deriveClimberCrop(without(makePose(0.5, 0.5), "left_wrist"), 1000, 1000)!;
    expect(crop.x).toBeGreaterThan(340);
    expect(crop.x).toBeLessThan(420);
  });

  it("caps total expansion at REACH_MAX_EXPANSION × the normal half-extent", () => {
    // Both arms missing with no mirror on either side → torso-ratio fallback,
    // whose radius exceeds the cap, so both x edges pin to the cap floor/ceiling.
    const crop = deriveClimberCrop(
      without(makePose(0.5, 0.5), "left_wrist", "right_wrist", "left_elbow", "right_elbow"),
      1000,
      1000,
    )!;
    const normalHalfW = full.width / 2; // 80 px
    const cx = 500;
    expect(crop.x).toBe(cx - normalHalfW * REACH_MAX_EXPANSION); // 340
    expect(crop.x + crop.width).toBe(cx + normalHalfW * REACH_MAX_EXPANSION); // 660
  });

  it("does not expand when the missing limb's anchor is also absent", () => {
    // Anchor-gated: no shoulder → no disk → identical to the un-expanded box.
    const crop = deriveClimberCrop(
      without(makePose(0.5, 0.5), "left_wrist", "left_shoulder"),
      1000,
      1000,
    )!;
    expect(crop.x).toBe(full.x);
    expect(crop.width).toBe(full.width);
  });
});

// ---------------------------------------------------------------------------
// predictDetectionRegion
// ---------------------------------------------------------------------------

describe("predictDetectionRegion", () => {
  const box = { x: 400, y: 400, width: 200, height: 200 };

  it("translates the region toward the predicted centroid (upward move shifts up)", () => {
    // Climber rising: predicted is above last by 0.1 of the frame.
    const region = predictDetectionRegion(box, { x: 0.5, y: 0.4 }, { x: 0.5, y: 0.5 }, 1000, 1000);
    // Region top is higher than the box top, and its centre moved up.
    expect(region.y).toBeLessThan(box.y);
    const regionCenterY = region.y + region.height / 2;
    expect(regionCenterY).toBeLessThan(box.y + box.height / 2);
    // It also grew (motion margin), so it is larger than the original box.
    expect(region.width).toBeGreaterThan(box.width);
    expect(region.height).toBeGreaterThan(box.height);
  });

  it("grows the margin with move speed", () => {
    const slow = predictDetectionRegion(box, { x: 0.5, y: 0.48 }, { x: 0.5, y: 0.5 }, 1000, 1000);
    const fast = predictDetectionRegion(box, { x: 0.5, y: 0.30 }, { x: 0.5, y: 0.5 }, 1000, 1000);
    expect(fast.height).toBeGreaterThan(slow.height);
  });

  it("pins the region to the frame edge on overflow without inverting", () => {
    // A large upward prediction would push the top past 0 — it clamps to 0.
    const region = predictDetectionRegion(box, { x: 0.5, y: 0.02 }, { x: 0.5, y: 0.5 }, 1000, 1000);
    expect(region.y).toBe(0);
    expect(region.width).toBeGreaterThan(0);
    expect(region.height).toBeGreaterThan(0);
    expect(region.y + region.height).toBeLessThanOrEqual(1000);
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

describe("pickAcquisitionRegion", () => {
  const crop = { x: 100, y: 100, width: 300, height: 500 };

  it("seeds acquisition with the climber crop even when the climber was tapped", () => {
    // Regression: tapping previously forced a full-frame search (region=null),
    // so a small / distant climber was never acquired until they grew large.
    // The tap drives identity, not the search area, so the crop must win here.
    const region = pickAcquisitionRegion(null, crop, 1280, 720);
    expect(region).toEqual(crop);
  });

  it("uses the climber crop when there is no established track", () => {
    expect(pickAcquisitionRegion(null, crop, 1280, 720)).toEqual(crop);
  });

  it("slack-expands the last climber box when no motion is supplied", () => {
    const last = { x: 200, y: 200, width: 100, height: 100 };
    const region = pickAcquisitionRegion(last, crop, 1000, 1000);
    // Established track wins over the seed crop, expanded by the base slack.
    expect(region).toEqual(expandCropBox(last, 1000, 1000, REGION_BASE_SLACK));
  });

  it("builds a predictive region from the last box when motion is supplied", () => {
    const last = { x: 200, y: 200, width: 100, height: 100 };
    const motion = { predicted: { x: 0.3, y: 0.2 }, last: { x: 0.25, y: 0.25 } };
    const region = pickAcquisitionRegion(last, crop, 1000, 1000, motion);
    expect(region).toEqual(
      predictDetectionRegion(last, motion.predicted, motion.last, 1000, 1000),
    );
  });

  it("returns null (full-frame search) when neither a track nor a crop exists", () => {
    expect(pickAcquisitionRegion(null, null, 1280, 720)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// scorePoseFrame — pose ranking used to seed Climber Identity
// ---------------------------------------------------------------------------

describe("scorePoseFrame", () => {
  it("returns 0 for null frame", () => {
    expect(scorePoseFrame(null)).toBe(0);
  });

  it("returns 0 for empty keypoints", () => {
    expect(scorePoseFrame({ timestamp: 0, keypoints: [] })).toBe(0);
  });

  it("scores based on count × average confidence", () => {
    const frame: PoseFrame = {
      timestamp: 0,
      keypoints: [
        { name: "a", x: 0, y: 0, score: 0.8 },
        { name: "b", x: 0, y: 0, score: 0.6 },
      ],
    };
    // 2 × 0.7 = 1.4
    expect(scorePoseFrame(frame)).toBeCloseTo(1.4, 5);
  });
});
