import { describe, it, expect, beforeEach } from "vitest";
import {
  saveAttempt,
  getAttempt,
  listAttemptIds,
  deleteAttempt,
  clearStore,
  type RouteAttempt,
} from "@/storage/sessionStore";

// Helper — builds a minimal valid RouteAttempt.
function makeAttempt(id: string, frameCount = 0): RouteAttempt {
  return {
    id,
    videoMeta: {
      name: `${id}.mp4`,
      duration: frameCount * 0.1,
      fps: 10,
      width: 1280,
      height: 720,
    },
    frames: Array.from({ length: frameCount }, (_, i) => ({
      timestamp: i * 0.1,
      keypoints: [{ name: "nose", x: 0.5, y: 0.5, score: 0.9 }],
    })),
    orbFeatures: null,
    matchesPerFrame: null,
    frameCaptures: null,
  };
}

// Wipe the store before every test so they are independent.
beforeEach(() => clearStore());

describe("sessionStore — saveAttempt / getAttempt", () => {
  it("retrieves an attempt that was saved", () => {
    const a = makeAttempt("a1");
    saveAttempt(a);
    expect(getAttempt("a1")).toEqual(a);
  });

  it("returns undefined for an unknown id", () => {
    expect(getAttempt("does-not-exist")).toBeUndefined();
  });

  it("overwrites an existing attempt with the same id", () => {
    saveAttempt(makeAttempt("a1", 5));
    const updated = makeAttempt("a1", 10);
    saveAttempt(updated);
    expect(getAttempt("a1")?.frames).toHaveLength(10);
  });

  it("preserves all frames and videoMeta", () => {
    const a = makeAttempt("a2", 3);
    saveAttempt(a);
    const retrieved = getAttempt("a2")!;
    expect(retrieved.videoMeta.width).toBe(1280);
    expect(retrieved.frames).toHaveLength(3);
    expect(retrieved.frames[0].timestamp).toBe(0);
    expect(retrieved.frames[2].timestamp).toBeCloseTo(0.2);
  });
});

describe("sessionStore — listAttemptIds", () => {
  it("returns empty array when store is empty", () => {
    expect(listAttemptIds()).toEqual([]);
  });

  it("returns all saved ids", () => {
    saveAttempt(makeAttempt("x"));
    saveAttempt(makeAttempt("y"));
    saveAttempt(makeAttempt("z"));
    expect(listAttemptIds().sort()).toEqual(["x", "y", "z"]);
  });

  it("does not include deleted ids", () => {
    saveAttempt(makeAttempt("keep"));
    saveAttempt(makeAttempt("drop"));
    deleteAttempt("drop");
    expect(listAttemptIds()).toEqual(["keep"]);
  });
});

describe("sessionStore — deleteAttempt", () => {
  it("removes a saved attempt", () => {
    saveAttempt(makeAttempt("del1"));
    deleteAttempt("del1");
    expect(getAttempt("del1")).toBeUndefined();
  });

  it("is a no-op for an unknown id (does not throw)", () => {
    expect(() => deleteAttempt("ghost")).not.toThrow();
  });
});

describe("sessionStore — clearStore", () => {
  it("removes all entries", () => {
    saveAttempt(makeAttempt("c1"));
    saveAttempt(makeAttempt("c2"));
    clearStore();
    expect(listAttemptIds()).toHaveLength(0);
  });
});

describe("sessionStore — matchesPerFrame", () => {
  it("stores null matchesPerFrame when not provided", () => {
    saveAttempt(makeAttempt("mpf-none"));
    expect(getAttempt("mpf-none")?.matchesPerFrame).toBeNull();
  });

  it("stores and retrieves populated matchesPerFrame", () => {
    const matchesPerFrame = [
      [], // frame 0 — reference
      [{ queryIdx: 0, trainIdx: 1, distance: 30 }],
      [{ queryIdx: 1, trainIdx: 0, distance: 20 }, { queryIdx: 2, trainIdx: 3, distance: 55 }],
    ];
    const a: RouteAttempt = { ...makeAttempt("mpf-full", 3), matchesPerFrame };
    saveAttempt(a);

    const retrieved = getAttempt("mpf-full")!;
    expect(retrieved.matchesPerFrame).toHaveLength(3);
    expect(retrieved.matchesPerFrame![0]).toEqual([]);
    expect(retrieved.matchesPerFrame![1]).toHaveLength(1);
    expect(retrieved.matchesPerFrame![1][0]).toMatchObject({ queryIdx: 0, trainIdx: 1, distance: 30 });
    expect(retrieved.matchesPerFrame![2]).toHaveLength(2);
  });

  it("matchesPerFrame is replaced when an attempt is overwritten", () => {
    const initial: RouteAttempt = {
      ...makeAttempt("mpf-overwrite"),
      matchesPerFrame: [[{ queryIdx: 0, trainIdx: 0, distance: 10 }]],
    };
    saveAttempt(initial);

    const updated: RouteAttempt = { ...makeAttempt("mpf-overwrite"), matchesPerFrame: null };
    saveAttempt(updated);

    expect(getAttempt("mpf-overwrite")?.matchesPerFrame).toBeNull();
  });
});

describe("sessionStore — orbFeatures", () => {
  it("stores null orbFeatures when none were extracted", () => {
    const a = makeAttempt("orb-none");
    saveAttempt(a);
    expect(getAttempt("orb-none")?.orbFeatures).toBeNull();
  });

  it("stores and retrieves orbFeatures with keypoints and descriptors", () => {
    const descriptors = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const a: RouteAttempt = {
      ...makeAttempt("orb-full"),
      orbFeatures: {
        keypoints: [
          { pt: { x: 10, y: 20 }, size: 3, angle: 90, response: 0.8, octave: 0 },
        ],
        descriptors,
      },
    };
    saveAttempt(a);

    const retrieved = getAttempt("orb-full")!;
    expect(retrieved.orbFeatures).not.toBeNull();
    expect(retrieved.orbFeatures!.keypoints).toHaveLength(1);
    expect(retrieved.orbFeatures!.keypoints[0].pt).toEqual({ x: 10, y: 20 });
    expect(retrieved.orbFeatures!.descriptors).toBe(descriptors);
  });

  it("orbFeatures is preserved when an attempt is overwritten", () => {
    const descriptors = new Uint8Array([1, 2]);
    const initial: RouteAttempt = {
      ...makeAttempt("orb-overwrite"),
      orbFeatures: {
        keypoints: [{ pt: { x: 1, y: 1 }, size: 1, angle: 0, response: 0.5, octave: 0 }],
        descriptors,
      },
    };
    saveAttempt(initial);

    const updated: RouteAttempt = { ...makeAttempt("orb-overwrite", 2), orbFeatures: null };
    saveAttempt(updated);

    expect(getAttempt("orb-overwrite")?.orbFeatures).toBeNull();
    expect(getAttempt("orb-overwrite")?.frames).toHaveLength(2);
  });
});
