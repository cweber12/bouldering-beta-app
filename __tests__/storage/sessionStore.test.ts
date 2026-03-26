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
