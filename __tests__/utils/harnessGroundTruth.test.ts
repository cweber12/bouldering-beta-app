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
  setupHash: "abc123",
  frames: [
    {
      frameIndex: 0,
      timestamp: 0,
      state: "present",
      review: "auto",
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
      review: "human-flagged-absent",
      verified: true,
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
    const reordered: GroundTruthInput = { ...base, frames: [base.frames[1], base.frames[0]] };
    expect(canonicalGroundTruthInput(reordered)).toBe(canonicalGroundTruthInput(base));
  });

  it("is stable regardless of joint key order", () => {
    const reordered: GroundTruthInput = {
      ...base,
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
      ...base,
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

  it("folds the setupHash into the pre-image", () => {
    expect(canonicalGroundTruthInput(base)).toContain("abc123");
  });

  // Ground Truth is video-keyed as *semantics*: `setupHash` demoted to seed
  // provenance, staleness-discard gone, carry-forward re-keyed to timestamps —
  // none of which may touch a stored byte. Pin the exact pre-image so any change
  // to the shape (which would silently re-hash the whole corpus and stale every
  // score) has to be a deliberate edit here.
  it("pins the exact canonical pre-image — the schema is frozen", () => {
    expect(canonicalGroundTruthInput(base)).toBe(
      `{"v":1,"jointSet":${JSON.stringify(CORE_JOINT_NAMES)},"setupHash":"abc123","frames":[` +
        `{"i":0,"t":0,"s":"present","r":"auto","v":true,"j":[` +
        `{"n":"left_shoulder","x":0.4,"y":0.3,"o":false},` +
        `{"n":"right_shoulder","x":0.6,"y":0.3,"o":true}]},` +
        `{"i":5,"t":0.5,"s":"absent","r":"human-flagged-absent","v":true,"j":[]}]}`,
    );
  });
});

describe("hashGroundTruthInput", () => {
  it("is deterministic for equal content and a 64-char hex digest", async () => {
    const a = await hashGroundTruthInput(base);
    const b = await hashGroundTruthInput({ ...base, frames: [...base.frames] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a joint position changes", async () => {
    const a = await hashGroundTruthInput(base);
    const moved: GroundTruthInput = {
      ...base,
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
      ...base,
      frames: [{ ...base.frames[0], verified: false }, base.frames[1]],
    };
    expect(await hashGroundTruthInput(flipped)).not.toBe(a);
  });

  it("changes when a frame's review flag changes", async () => {
    const a = await hashGroundTruthInput(base);
    const reflagged: GroundTruthInput = {
      ...base,
      frames: [{ ...base.frames[0], review: "human-flagged-wrong" }, base.frames[1]],
    };
    expect(await hashGroundTruthInput(reflagged)).not.toBe(a);
  });

  // Scaffold provenance records where the reference came from, not what it is.
  // Folding it into the pre-image would re-hash every truth that gains a stamp
  // without a frame moving, staling scores that are still perfectly valid.
  it("does not change when the scaffoldSeedHash is stamped or moves", async () => {
    const unstamped = await hashGroundTruthInput(base);
    expect(await hashGroundTruthInput({ ...base, scaffoldSeedHash: "seed-old" })).toBe(unstamped);
    expect(await hashGroundTruthInput({ ...base, scaffoldSeedHash: "seed-new" })).toBe(unstamped);
    expect(canonicalGroundTruthInput({ ...base, scaffoldSeedHash: "seed-old" })).not.toContain(
      "seed-old",
    );
  });

  it("changes when the setupHash changes", async () => {
    const a = await hashGroundTruthInput(base);
    expect(await hashGroundTruthInput({ ...base, setupHash: "different" })).not.toBe(a);
  });
});

describe("parseGroundTruthInput", () => {
  it("accepts a well-formed body and defaults missing joints to empty", () => {
    const parsed = parseGroundTruthInput({
      setupHash: "abc123",
      frames: [{ frameIndex: 1, timestamp: 0.1, state: "present", review: "auto", verified: true }],
    });
    expect(parsed).toEqual({
      setupHash: "abc123",
      frames: [
        { frameIndex: 1, timestamp: 0.1, state: "present", review: "auto", verified: true, joints: {} },
      ],
    });
  });

  it("round-trips the base fixture", () => {
    expect(parseGroundTruthInput(base)).toEqual(base);
  });

  it("accepts all four contract review values", () => {
    for (const review of ["auto", "human-flagged-wrong", "human-flagged-absent", "human"] as const) {
      const state = review === "human-flagged-absent" ? "absent" : "present";
      const parsed = parseGroundTruthInput({
        setupHash: "abc123",
        frames: [{ frameIndex: 0, timestamp: 0, state, review, verified: true }],
      });
      expect(parsed?.frames[0].review).toBe(review);
    }
  });

  it("rejects a write missing the per-frame review", () => {
    expect(
      parseGroundTruthInput({
        setupHash: "abc123",
        frames: [{ frameIndex: 0, timestamp: 0, state: "present", verified: true }],
      }),
    ).toBeNull();
  });

  it("rejects an unknown review value", () => {
    expect(
      parseGroundTruthInput({
        setupHash: "abc123",
        frames: [{ frameIndex: 0, timestamp: 0, state: "present", review: "skip", verified: true }],
      }),
    ).toBeNull();
  });

  it("rejects a write missing the top-level setupHash", () => {
    expect(
      parseGroundTruthInput({
        frames: [{ frameIndex: 0, timestamp: 0, state: "present", review: "auto", verified: true }],
      }),
    ).toBeNull();
    expect(
      parseGroundTruthInput({
        setupHash: "",
        frames: [{ frameIndex: 0, timestamp: 0, state: "present", review: "auto", verified: true }],
      }),
    ).toBeNull();
  });

  it("enforces human-flagged-absent ⇒ state absent", () => {
    expect(
      parseGroundTruthInput({
        setupHash: "abc123",
        frames: [
          { frameIndex: 0, timestamp: 0, state: "present", review: "human-flagged-absent", verified: true },
        ],
      }),
    ).toBeNull();
  });

  it("reads a legacy file without review as all-auto and tolerates a missing setupHash", () => {
    const parsed = parseGroundTruthInput(
      {
        frames: [
          { frameIndex: 0, timestamp: 0, state: "present", verified: true },
          { frameIndex: 1, timestamp: 0.1, state: "absent", verified: true },
        ],
      },
      { legacy: true },
    );
    expect(parsed?.setupHash).toBe("");
    expect(parsed?.frames.map((f) => f.review)).toEqual(["auto", "auto"]);
  });

  it("carries a scaffoldSeedHash through, and omits it when absent or blank", () => {
    const body = { ...base, scaffoldSeedHash: "3c6b5831a1b2c3d4" };
    expect(parseGroundTruthInput(body)?.scaffoldSeedHash).toBe("3c6b5831a1b2c3d4");
    // A scaffold that predates ADR 0007 has nothing to stamp — omit rather than
    // invent, so provenance reads as unknown instead of as an empty mismatch.
    expect(parseGroundTruthInput(base)).not.toHaveProperty("scaffoldSeedHash");
    expect(parseGroundTruthInput({ ...base, scaffoldSeedHash: "" })).not.toHaveProperty(
      "scaffoldSeedHash",
    );
  });

  it("rejects a non-string scaffoldSeedHash", () => {
    expect(parseGroundTruthInput({ ...base, scaffoldSeedHash: 123 })).toBeNull();
  });

  it("rejects malformed bodies", () => {
    expect(parseGroundTruthInput(null)).toBeNull();
    expect(parseGroundTruthInput({ setupHash: "abc123", frames: "no" })).toBeNull();
    expect(
      parseGroundTruthInput({
        setupHash: "abc123",
        frames: [{ frameIndex: -1, timestamp: 0, state: "present", review: "auto", verified: true }],
      }),
    ).toBeNull();
    expect(
      parseGroundTruthInput({
        setupHash: "abc123",
        frames: [{ frameIndex: 1.5, timestamp: 0, state: "present", review: "auto", verified: true }],
      }),
    ).toBeNull();
    expect(
      parseGroundTruthInput({
        setupHash: "abc123",
        frames: [{ frameIndex: 0, timestamp: 0, state: "bogus", review: "auto", verified: true }],
      }),
    ).toBeNull();
    expect(
      parseGroundTruthInput({
        setupHash: "abc123",
        frames: [{ frameIndex: 0, timestamp: 0, state: "present", review: "auto", verified: "yes" }],
      }),
    ).toBeNull();
  });

  it("rejects non-core joint names", () => {
    expect(
      parseGroundTruthInput({
        setupHash: "abc123",
        frames: [
          {
            frameIndex: 0,
            timestamp: 0,
            state: "present",
            review: "auto",
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
        setupHash: "abc123",
        frames: [
          {
            frameIndex: 0,
            timestamp: 0,
            state: "present",
            review: "auto",
            verified: true,
            joints: { nose: { x: NaN, y: 0.5, occluded: false } },
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseGroundTruthInput({
        setupHash: "abc123",
        frames: [
          {
            frameIndex: 0,
            timestamp: 0,
            state: "present",
            review: "auto",
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
        setupHash: "abc123",
        frames: [
          { frameIndex: 3, timestamp: 0, state: "present", review: "auto", verified: true },
          { frameIndex: 3, timestamp: 0.3, state: "present", review: "auto", verified: true },
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

  // Video-keying changed no shape, so no stored file is rewritten and no
  // migration runs. Bumping this is what would break that promise.
  it("is still 1 — video-keying needed no migration", () => {
    expect(GROUND_TRUTH_VERSION).toBe(1);
  });
});
