import { describe, it, expect } from "vitest";
import {
  sanitizeDirName,
  attemptTimestampLabel,
  parseRunType,
  serializeAttemptForJson,
  loadAttemptFromJson,
} from "@/utils/fsHelpers";
import type { RouteAttempt } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// sanitizeDirName
// ---------------------------------------------------------------------------

describe("sanitizeDirName", () => {
  it("strips Windows-illegal characters", () => {
    expect(sanitizeDirName('Foo<Bar>:Baz"/\\|?*')).toBe("Foo_Bar__Baz______");
  });

  it("returns 'Unknown' for empty strings", () => {
    expect(sanitizeDirName("")).toBe("Unknown");
  });

  it("returns 'Unknown' for whitespace-only strings", () => {
    expect(sanitizeDirName("   ")).toBe("Unknown");
  });

  it("trims leading/trailing whitespace", () => {
    expect(sanitizeDirName("  Red Rocks  ")).toBe("Red Rocks");
  });

  it("passes through a normal name unchanged", () => {
    expect(sanitizeDirName("The Classic")).toBe("The Classic");
  });
});

// ---------------------------------------------------------------------------
// attemptTimestampLabel
// ---------------------------------------------------------------------------

describe("attemptTimestampLabel", () => {
  it("formats a valid legacy attempt filename as a date string", () => {
    const label = attemptTimestampLabel("attempt-1700000000000.json");
    // Just check it's not the raw filename and contains a year
    expect(label).not.toBe("attempt-1700000000000.json");
    expect(label).toMatch(/2023/);
  });

  it("formats a new-format run filename as a date string", () => {
    const label = attemptTimestampLabel("run-1700000000000-attempt.json");
    expect(label).not.toBe("run-1700000000000-attempt.json");
    expect(label).toMatch(/2023/);
  });

  it("formats a send filename as a date string", () => {
    const label = attemptTimestampLabel("run-1700000000000-send.json");
    expect(label).not.toBe("run-1700000000000-send.json");
    expect(label).toMatch(/2023/);
  });

  it("returns the raw filename when no timestamp is found", () => {
    expect(attemptTimestampLabel("notes.txt")).toBe("notes.txt");
  });
});

// ---------------------------------------------------------------------------
// parseRunType
// ---------------------------------------------------------------------------

describe("parseRunType", () => {
  it("parses 'attempt' from new-format filename", () => {
    expect(parseRunType("run-1234-attempt.json")).toBe("attempt");
  });

  it("parses 'send' from new-format filename", () => {
    expect(parseRunType("run-1234-send.json")).toBe("send");
  });

  it("defaults to 'attempt' for legacy filenames", () => {
    expect(parseRunType("attempt-1234.json")).toBe("attempt");
  });

  it("defaults to 'attempt' for unrecognised filenames", () => {
    expect(parseRunType("notes.txt")).toBe("attempt");
  });
});

// ---------------------------------------------------------------------------
// serializeAttemptForJson
// ---------------------------------------------------------------------------

function makeAttempt(overrides?: Partial<RouteAttempt>): RouteAttempt {
  return {
    id: "attempt-1",
    videoMeta: { width: 640, height: 480, fps: 30, duration: 10 },
    frames: [],
    orbFeatures: {
      keypoints: [{ x: 10, y: 20, size: 5, angle: 0, response: 1, octave: 0 }],
      descriptors: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      width: 640,
      height: 480,
    },
    matchesPerFrame: null,
    state: "Colorado",
    area: "Red Rocks",
    route: "The Classic",
    runType: "attempt",
    frameCaptures: null,
    ...overrides,
  } as RouteAttempt;
}

describe("serializeAttemptForJson", () => {
  it("converts descriptors from Uint8Array to a plain number[]", () => {
    const attempt = makeAttempt();
    const out = serializeAttemptForJson(attempt);
    const orb = out.orbFeatures as Record<string, unknown>;
    expect(Array.isArray(orb.descriptors)).toBe(true);
    expect(orb.descriptors).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("preserves null orbFeatures", () => {
    const attempt = makeAttempt({ orbFeatures: null });
    const out = serializeAttemptForJson(attempt);
    expect(out.orbFeatures).toBeNull();
  });

  it("result is JSON-serialisable", () => {
    const attempt = makeAttempt();
    const out = serializeAttemptForJson(attempt);
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it("does not mutate the original attempt", () => {
    const attempt = makeAttempt();
    const origDesc = attempt.orbFeatures!.descriptors;
    serializeAttemptForJson(attempt);
    expect(attempt.orbFeatures!.descriptors).toBe(origDesc);
    expect(attempt.orbFeatures!.descriptors).toBeInstanceOf(Uint8Array);
  });
});

// ---------------------------------------------------------------------------
// loadAttemptFromJson
// ---------------------------------------------------------------------------

describe("loadAttemptFromJson", () => {
  it("re-hydrates descriptors from number[] to Uint8Array", () => {
    const raw = {
      id: "attempt-1",
      orbFeatures: {
        keypoints: [],
        descriptors: [0xde, 0xad],
        width: 640,
        height: 480,
      },
      frames: [],
    };
    const attempt = loadAttemptFromJson(raw);
    expect(attempt.orbFeatures!.descriptors).toBeInstanceOf(Uint8Array);
    expect(attempt.orbFeatures!.descriptors).toEqual(new Uint8Array([0xde, 0xad]));
  });

  it("handles null orbFeatures gracefully", () => {
    const attempt = loadAttemptFromJson({ id: "a", orbFeatures: null, frames: [] });
    expect(attempt.orbFeatures).toBeNull();
  });

  it("defaults state/area/route/runType when missing", () => {
    const attempt = loadAttemptFromJson({ id: "a", frames: [] });
    expect(attempt.state).toBe("");
    expect(attempt.area).toBe("");
    expect(attempt.route).toBe("");
    expect(attempt.runType).toBe("attempt");
  });

  it("throws for null input", () => {
    expect(() => loadAttemptFromJson(null)).toThrow("Invalid attempt data.");
  });

  it("throws for non-object input", () => {
    expect(() => loadAttemptFromJson("oops")).toThrow("Invalid attempt data.");
  });

  it("round-trips through serializeAttemptForJson", () => {
    const attempt = makeAttempt();
    const serialized = serializeAttemptForJson(attempt);
    const parsed = JSON.parse(JSON.stringify(serialized));
    const restored = loadAttemptFromJson(parsed);
    expect(restored.id).toBe(attempt.id);
    expect(restored.orbFeatures!.descriptors).toBeInstanceOf(Uint8Array);
    expect(restored.orbFeatures!.descriptors).toEqual(attempt.orbFeatures!.descriptors);
  });
});
