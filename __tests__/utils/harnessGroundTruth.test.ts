import { describe, it, expect } from "vitest";
import {
  canonicalGroundTruthInput,
  hashGroundTruthInput,
  parseGroundTruthInput,
  CORE_JOINT_NAMES,
  GROUND_TRUTH_VERSION,
  type GroundTruthInput,
} from "@/utils/harnessGroundTruth";

const base: GroundTruthInput = {
  frames: [
    {
      frameIndex: 0,
      timestamp: 0,
      state: "present",
      verified: true,
      joints: {
        left_shoulder: { x: 0.4, y: 0.3, occluded: false },
        right_shoulder: { x: 0.6, y: 0.3, occluded: true },
      },
    },
    {
      frameIndex: 5,
      timestamp: 0.5,
      state: "absent",
      verified: false,
      joints: {},
    },
  ],
};

describe("CORE_JOINT_NAMES", () => {
  it("is the 13-joint core body set with a head anchor", () => {
    expect(CORE_JOINT_NAMES).toHaveLength(13);
    expect(CORE_JOINT_NAMES).toContain("nose");
    expect(CORE_JOINT_NAMES).toContain("left_ankle");
    expect(CORE_JOINT_NAMES).not.toContain("left_eye");
  });
});

describe("canonicalGroundTruthInput", () => {
  it("is stable regardless of frame order", () => {
    const reordered: GroundTruthInput = { frames: [base.frames[1], base.frames[0]] };
    expect(canonicalGroundTruthInput(reordered)).toBe(canonicalGroundTruthInput(base));
  });

  it("is stable regardless of joint key order", () => {
    const reordered: GroundTruthInput = {
      frames: [
        {
          ...base.frames[0],
          joints: {
            right_shoulder: { x: 0.6, y: 0.3, occluded: true },
            left_shoulder: { x: 0.4, y: 0.3, occluded: false },
          },
        },
        base.frames[1],
      ],
    };
    expect(canonicalGroundTruthInput(reordered)).toBe(canonicalGroundTruthInput(base));
  });

  it("rounds float noise below 1e-6 to the same string", () => {
    const noisy: GroundTruthInput = {
      frames: [
        {
          ...base.frames[0],
          joints: {
            ...base.frames[0].joints,
            left_shoulder: { x: 0.4 + 1e-9, y: 0.3, occluded: false },
          },
        },
        base.frames[1],
      ],
    };
    expect(canonicalGroundTruthInput(noisy)).toBe(canonicalGroundTruthInput(base));
  });

  it("folds the joint-set definition into the pre-image", () => {
    expect(canonicalGroundTruthInput(base)).toContain(JSON.stringify(CORE_JOINT_NAMES));
  });
});

describe("hashGroundTruthInput", () => {
  it("is deterministic for equal content and a 64-char hex digest", async () => {
    const a = await hashGroundTruthInput(base);
    const b = await hashGroundTruthInput({ frames: [...base.frames] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a joint position changes", async () => {
    const a = await hashGroundTruthInput(base);
    const moved: GroundTruthInput = {
      frames: [
        {
          ...base.frames[0],
          joints: {
            ...base.frames[0].joints,
            left_shoulder: { x: 0.41, y: 0.3, occluded: false },
          },
        },
        base.frames[1],
      ],
    };
    expect(await hashGroundTruthInput(moved)).not.toBe(a);
  });

  it("changes when a frame's verified flag flips", async () => {
    const a = await hashGroundTruthInput(base);
    const flipped: GroundTruthInput = {
      frames: [{ ...base.frames[0], verified: false }, base.frames[1]],
    };
    expect(await hashGroundTruthInput(flipped)).not.toBe(a);
  });
});

describe("parseGroundTruthInput", () => {
  it("accepts a well-formed body and defaults missing joints to empty", () => {
    const parsed = parseGroundTruthInput({
      frames: [{ frameIndex: 1, timestamp: 0.1, state: "skip", verified: false }],
    });
    expect(parsed).toEqual({
      frames: [{ frameIndex: 1, timestamp: 0.1, state: "skip", verified: false, joints: {} }],
    });
  });

  it("round-trips the base fixture", () => {
    expect(parseGroundTruthInput(base)).toEqual(base);
  });

  it("rejects malformed bodies", () => {
    expect(parseGroundTruthInput(null)).toBeNull();
    expect(parseGroundTruthInput({ frames: "no" })).toBeNull();
    expect(
      parseGroundTruthInput({ frames: [{ frameIndex: -1, timestamp: 0, state: "present", verified: true }] }),
    ).toBeNull();
    expect(
      parseGroundTruthInput({ frames: [{ frameIndex: 1.5, timestamp: 0, state: "present", verified: true }] }),
    ).toBeNull();
    expect(
      parseGroundTruthInput({ frames: [{ frameIndex: 0, timestamp: 0, state: "bogus", verified: true }] }),
    ).toBeNull();
    expect(
      parseGroundTruthInput({ frames: [{ frameIndex: 0, timestamp: 0, state: "present", verified: "yes" }] }),
    ).toBeNull();
  });

  it("rejects non-core joint names", () => {
    expect(
      parseGroundTruthInput({
        frames: [
          {
            frameIndex: 0,
            timestamp: 0,
            state: "present",
            verified: true,
            joints: { left_eye: { x: 0.5, y: 0.5, occluded: false } },
          },
        ],
      }),
    ).toBeNull();
  });

  it("rejects joints with non-finite coordinates or a missing occluded flag", () => {
    expect(
      parseGroundTruthInput({
        frames: [
          {
            frameIndex: 0,
            timestamp: 0,
            state: "present",
            verified: true,
            joints: { nose: { x: NaN, y: 0.5, occluded: false } },
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseGroundTruthInput({
        frames: [
          {
            frameIndex: 0,
            timestamp: 0,
            state: "present",
            verified: true,
            joints: { nose: { x: 0.5, y: 0.5 } },
          },
        ],
      }),
    ).toBeNull();
  });

  it("rejects duplicate frame indices", () => {
    expect(
      parseGroundTruthInput({
        frames: [
          { frameIndex: 3, timestamp: 0, state: "skip", verified: false },
          { frameIndex: 3, timestamp: 0.3, state: "skip", verified: false },
        ],
      }),
    ).toBeNull();
  });
});

describe("GROUND_TRUTH_VERSION", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(GROUND_TRUTH_VERSION)).toBe(true);
    expect(GROUND_TRUTH_VERSION).toBeGreaterThan(0);
  });
});
