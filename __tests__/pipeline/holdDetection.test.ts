import { describe, it, expect } from "vitest";
import { detectHolds, type HoldProjector } from "@/pipeline/holdDetection";
import type { PoseFrame, Keypoint } from "@/pipeline/poseDetection";

// ---------------------------------------------------------------------------
// Test scaffolding
//
// detectHolds is pure — no OpenCV. We feed it synthetic scored PoseFrames in
// normalized [0,1] space plus a simple projector that scales to a 1000px photo,
// and an explicit photo-space bodyScale (~shoulder width). All radii/margins are
// fractions of that scale (Balanced defaults), so at bodyScale=100:
//   stationary 18px · merge 25px · above-wrist 5px · braced offset 15px.
// ---------------------------------------------------------------------------

const SCALE = 1000;
const BODY_SCALE = 100;
const project: HoldProjector = (pt) => ({ x: pt.x * SCALE, y: pt.y * SCALE });

function kp(name: string, x: number, y: number, score = 0.8): Keypoint {
  return { name, x, y, score };
}

/** Five evenly-spaced sample timestamps spanning 0.8s (> the 0.5s min dwell). */
const DEFAULT_TS = [0, 0.2, 0.4, 0.6, 0.8];

/** A stationary left-hand grip: index/pinky above the wrist, all detected. */
function handFrames(opts: {
  x?: number;
  handY?: number;
  wristY?: number;
  score?: number;
  ts?: number[];
  side?: "left" | "right";
} = {}): PoseFrame[] {
  const { x = 0.5, handY = 0.45, wristY = 0.5, score = 0.8, ts = DEFAULT_TS, side = "left" } = opts;
  return ts.map((t) => ({
    timestamp: t,
    keypoints: [
      kp(`${side}_index`, x, handY, score),
      kp(`${side}_pinky`, x, handY, score),
      kp(`${side}_wrist`, x, wristY, score),
    ],
  }));
}

/** A left-leg foot sample with the foot fixed and the leg posed as given. */
function footFrame(
  t: number,
  leg: { foot: [number, number]; ankle: [number, number]; knee: [number, number]; hip: [number, number] },
  score = 0.8,
): PoseFrame {
  return {
    timestamp: t,
    keypoints: [
      kp("left_foot_index", leg.foot[0], leg.foot[1], score),
      kp("left_heel", leg.foot[0], leg.foot[1], score),
      kp("left_ankle", leg.ankle[0], leg.ankle[1], score),
      kp("left_knee", leg.knee[0], leg.knee[1], score),
      kp("left_hip", leg.hip[0], leg.hip[1], score),
    ],
  };
}

describe("detectHolds", () => {
  it("infers a Hand Hold from a gripped hand held above the wrist", () => {
    const holds = detectHolds(handFrames(), project, BODY_SCALE);
    expect(holds).toHaveLength(1);
    expect(holds[0].kind).toBe("hand");
    expect(holds[0].order).toBe(1);
    // Located at the projected contact point (mean index/pinky).
    expect(holds[0].x).toBeCloseTo(500, 1);
    expect(holds[0].y).toBeCloseTo(450, 1);
  });

  it("rejects a frozen, low-confidence (occluded) limb as a false Hold", () => {
    // Geometrically a perfect grip, but the contact keypoint never clears the
    // 0.4 detection threshold — the confidence guard drops it.
    const holds = detectHolds(handFrames({ score: 0.2 }), project, BODY_SCALE);
    expect(holds).toHaveLength(0);
  });

  it("rejects a hand at or below the wrist (a hang, not a grip)", () => {
    const holds = detectHolds(handFrames({ handY: 0.5, wristY: 0.5 }), project, BODY_SCALE);
    expect(holds).toHaveLength(0);
  });

  it("infers a Foot Hold when the knee straightens (stand-up)", () => {
    // Foot fixed; the knee swings from bent toward the hip–ankle line, so the
    // interior hip–knee–ankle angle increases well past +20°.
    const hip: [number, number] = [0.5, 0.5];
    const ankle: [number, number] = [0.5, 0.85];
    const foot: [number, number] = [0.5, 0.92];
    const kneeXs = [0.65, 0.62, 0.58, 0.54, 0.51];
    const frames = kneeXs.map((kx, i) =>
      footFrame(DEFAULT_TS[i], { foot, ankle, knee: [kx, 0.675], hip }),
    );
    const holds = detectHolds(frames, project, BODY_SCALE);
    expect(holds).toHaveLength(1);
    expect(holds[0].kind).toBe("foot");
  });

  it("infers a Foot Hold when the leg is braced (bent knee, no stand-up)", () => {
    const hip: [number, number] = [0.5, 0.5];
    const ankle: [number, number] = [0.5, 0.85];
    const foot: [number, number] = [0.5, 0.92];
    const knee: [number, number] = [0.65, 0.675]; // bent, constant (angle < 160°)
    const frames = DEFAULT_TS.map((t) => footFrame(t, { foot, ankle, knee, hip }));
    const holds = detectHolds(frames, project, BODY_SCALE);
    expect(holds).toHaveLength(1);
    expect(holds[0].kind).toBe("foot");
  });

  it("rejects a free-hanging plumb leg (straight knee, ankle under the hip)", () => {
    const hip: [number, number] = [0.5, 0.5];
    const knee: [number, number] = [0.5, 0.7]; // straight (~180°)
    const ankle: [number, number] = [0.5, 0.9]; // directly below the hip
    const foot: [number, number] = [0.5, 0.95];
    const frames = DEFAULT_TS.map((t) => footFrame(t, { foot, ankle, knee, hip }));
    const holds = detectHolds(frames, project, BODY_SCALE);
    expect(holds).toHaveLength(0);
  });

  it("rejects a tucked/swinging leg (bent knee, ankle not below the knee)", () => {
    // Knee bent enough to pass the braced clause, but the ankle is drawn up level
    // with the knee — the downward hip→knee→ankle stack is broken, so it is not a
    // weight-bearing foot (ADR 0008).
    const hip: [number, number] = [0.5, 0.5];
    const knee: [number, number] = [0.5, 0.7];
    const ankle: [number, number] = [0.6, 0.65]; // above the knee, tucked/swinging
    const foot: [number, number] = [0.62, 0.6];
    const frames = DEFAULT_TS.map((t) => footFrame(t, { foot, ankle, knee, hip }));
    const holds = detectHolds(frames, project, BODY_SCALE);
    expect(holds).toHaveLength(0);
  });

  it("treats a brief lift-off and return as one Dwell (gap-tolerant)", () => {
    // Two 0.4s halves at one spot, each too short alone, bridged by a single
    // out-of-radius excursion frame inside the 0.4s gap window — one Hold, not none
    // (and not two stacked numbers) (ADR 0008).
    const ts = [0, 0.2, 0.4, 0.6, 0.8];
    const xs = [0.5, 0.5, 0.85, 0.5, 0.5]; // frame 2 lifts well outside the radius
    const frames: PoseFrame[] = ts.map((t, i) => ({
      timestamp: t,
      keypoints: [
        kp("left_index", xs[i], 0.45),
        kp("left_pinky", xs[i], 0.45),
        kp("left_wrist", xs[i], 0.5),
      ],
    }));
    const holds = detectHolds(frames, project, BODY_SCALE);
    expect(holds).toHaveLength(1);
    expect(holds[0].kind).toBe("hand");
    // Located at the anchor, ignoring the excursion frame.
    expect(holds[0].x).toBeCloseTo(500, 1);
  });

  it("recovers the stronger hand when both hands would be rejected at once", () => {
    // Both hands are stationary, confident, but sit at the wrist (a hang/press, not
    // a grip) so both fail the grip gate. Since both hands can never dangle at once,
    // the stronger (left, higher score) is recovered (ADR 0008).
    const left = handFrames({ side: "left", x: 0.3, handY: 0.5, wristY: 0.5, score: 0.85 });
    const right = handFrames({ side: "right", x: 0.7, handY: 0.5, wristY: 0.5, score: 0.6 });
    const frames: PoseFrame[] = DEFAULT_TS.map((t, i) => ({
      timestamp: t,
      keypoints: [...left[i].keypoints, ...right[i].keypoints],
    }));
    const holds = detectHolds(frames, project, BODY_SCALE);
    expect(holds).toHaveLength(1);
    expect(holds[0].kind).toBe("hand");
    expect(holds[0].x).toBeCloseTo(300, 1); // the left hand (stronger)
  });

  it("does not recover a lone hanging hand (the other hand is absent)", () => {
    // A single hand at the wrist with no opposing candidate asserts nothing about
    // support, so it stays rejected (guards the soft rule against over-recovery).
    const holds = detectHolds(handFrames({ handY: 0.5, wristY: 0.5 }), project, BODY_SCALE);
    expect(holds).toHaveLength(0);
  });

  it("merges a two-hand match at one spot into a single numbered Hold", () => {
    // Left and right hands grip the same location — same kind + location, so the
    // two Dwells collapse into one Hold rather than two stacked numbers.
    const frames: PoseFrame[] = DEFAULT_TS.map((t) => ({
      timestamp: t,
      keypoints: [
        ...handFrames({ side: "left", ts: [t] })[0].keypoints,
        ...handFrames({ side: "right", ts: [t] })[0].keypoints,
      ],
    }));
    const holds = detectHolds(frames, project, BODY_SCALE);
    expect(holds).toHaveLength(1);
    expect(holds[0].kind).toBe("hand");
  });

  it("numbers Holds in one combined hand+foot first-use sequence", () => {
    // A hand grip first (t≈0), then a foot stand-up later (t≈2). Numbering is a
    // single chronological sequence — colour distinguishes the kind.
    const hand = handFrames(); // t 0..0.8
    const footTs = [2.0, 2.2, 2.4, 2.6, 2.8];
    const hip: [number, number] = [0.2, 0.5];
    const ankle: [number, number] = [0.2, 0.85];
    const foot: [number, number] = [0.2, 0.92];
    const kneeXs = [0.35, 0.32, 0.28, 0.24, 0.21];
    const footF = kneeXs.map((kx, i) => footFrame(footTs[i], { foot, ankle, knee: [kx, 0.675], hip }));

    const holds = detectHolds([...hand, ...footF], project, BODY_SCALE);
    expect(holds).toHaveLength(2);

    const byOrder = [...holds].sort((a, b) => a.order - b.order);
    expect(byOrder[0]).toMatchObject({ kind: "hand", order: 1, id: "hold-1" });
    expect(byOrder[1]).toMatchObject({ kind: "foot", order: 2, id: "hold-2" });
    expect(byOrder[0].firstUseTime).toBeLessThan(byOrder[1].firstUseTime);
  });
});
