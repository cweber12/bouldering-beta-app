import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useScanHolds } from "@/hooks/useScanHolds";
import {
  saveAttempt,
  getAttempt,
  clearStore,
  type RouteAttempt,
} from "@/storage/sessionStore";

function makeAttempt(overrides?: Partial<RouteAttempt>): RouteAttempt {
  return {
    id: "run-1",
    videoMeta: { name: "v.mp4", duration: 2, fps: 30, width: 1000, height: 1000 },
    // One detected frame at t=0 with a left-hand grip and a right foot.
    frames: [
      {
        timestamp: 0,
        keypoints: [
          { name: "left_index", x: 0.5, y: 0.4, score: 0.9 },
          { name: "left_pinky", x: 0.5, y: 0.4, score: 0.9 },
          { name: "left_wrist", x: 0.5, y: 0.45, score: 0.9 },
          { name: "right_foot_index", x: 0.7, y: 0.8, score: 0.9 },
          { name: "right_heel", x: 0.7, y: 0.8, score: 0.9 },
          { name: "right_ankle", x: 0.7, y: 0.78, score: 0.9 },
        ],
      },
    ],
    orbFeatures: null,
    matchesPerFrame: null,
    state: "",
    area: "",
    route: "",
    runType: "attempt",
    frameCaptures: null,
    ...overrides,
  };
}

describe("useScanHolds", () => {
  beforeEach(() => clearStore());

  it("seeds from the Run's stored Holds and projects them to video pixels", () => {
    const attempt = makeAttempt({
      holds: [{ x: 0.5, y: 0.4, kind: "hand", firstUseTime: 0 }],
    });
    saveAttempt(attempt);
    const { result } = renderHook(() => useScanHolds(attempt, true));
    expect(result.current.count).toBe(1);
    expect(result.current.previewHolds[0]).toMatchObject({ x: 500, y: 400, order: 1, kind: "hand" });
  });

  it("adds a Hold snapped to the chosen limb and persists it to the Run", () => {
    const attempt = makeAttempt({ holds: [] });
    saveAttempt(attempt);
    const { result } = renderHook(() => useScanHolds(attempt, true));

    act(() => {
      result.current.addLimb("hand", "left", 0);
    });

    expect(result.current.count).toBe(1);
    expect(result.current.entries[0]).toMatchObject({ order: 1 });
    expect(result.current.entries[0].hold).toMatchObject({ x: 0.5, y: 0.4, kind: "hand", firstUseTime: 0 });
    // Written back to the store so it saves and shows on the Route Overlay.
    expect(getAttempt("run-1")?.holds).toHaveLength(1);
  });

  it("removes a Hold and renumbers the rest", () => {
    const attempt = makeAttempt({
      holds: [
        { x: 0.5, y: 0.4, kind: "hand", firstUseTime: 0 },
        { x: 0.7, y: 0.8, kind: "foot", firstUseTime: 1 },
      ],
    });
    saveAttempt(attempt);
    const { result } = renderHook(() => useScanHolds(attempt, true));

    const first = result.current.entries[0].hold;
    act(() => {
      result.current.removeHold(first);
    });

    expect(result.current.count).toBe(1);
    expect(result.current.entries[0]).toMatchObject({ order: 1 });
    expect(result.current.entries[0].hold.kind).toBe("foot");
  });

  it("is inert when not editable (Panning Capture / legacy)", () => {
    const attempt = makeAttempt({ holds: [{ x: 0.5, y: 0.4, kind: "hand", firstUseTime: 0 }] });
    saveAttempt(attempt);
    const { result } = renderHook(() => useScanHolds(attempt, false));
    expect(result.current.count).toBe(0);
    act(() => {
      expect(result.current.addLimb("hand", "left", 0)).toBe(false);
    });
    expect(result.current.count).toBe(0);
  });
});
