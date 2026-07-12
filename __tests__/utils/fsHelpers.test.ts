import { describe, it, expect } from "vitest";
import {
  sanitizeDirName,
  attemptTimestampLabel,
  parseRunType,
  serializeAttemptForJson,
  serializeAttemptMetadata,
  serializeAttemptData,
  loadAttemptFromJson,
  uint8ToBase64,
  base64ToUint8,
  ROUTE_TEXT_LIMIT,
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

// ---------------------------------------------------------------------------
// base64 helpers
// ---------------------------------------------------------------------------

describe("uint8ToBase64 / base64ToUint8", () => {
  it("round-trips an empty array", () => {
    expect(base64ToUint8(uint8ToBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  it("round-trips a small array", () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
    expect(base64ToUint8(uint8ToBase64(bytes))).toEqual(bytes);
  });

  it("round-trips a large array spanning multiple chunks", () => {
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    expect(base64ToUint8(uint8ToBase64(bytes))).toEqual(bytes);
  });
});

// ---------------------------------------------------------------------------
// split serialisation (v2 metadata + data)
// ---------------------------------------------------------------------------

describe("serializeAttemptMetadata", () => {
  it("stamps a schema version and excludes heavy fields", () => {
    const meta = serializeAttemptMetadata(makeAttempt());
    expect(meta.schemaVersion).toBe(2);
    expect(meta.frames).toBeUndefined();
    expect(meta.matchesPerFrame).toBeUndefined();
    expect(meta.frameCaptures).toBeUndefined();
    expect(meta.orbFeatures).toBeUndefined();
  });

  it("keeps queryable metadata used by list/detail readers", () => {
    const meta = serializeAttemptMetadata(makeAttempt({ rating: "V4", notes: "crux at the top" }));
    expect(meta.state).toBe("Colorado");
    expect(meta.route).toBe("The Classic");
    expect(meta.runType).toBe("attempt");
    expect(meta.rating).toBe("V4");
    expect(meta.notes).toBe("crux at the top");
    expect(meta.videoMeta).toEqual({ width: 640, height: 480, fps: 30, duration: 10 });
  });

  it("clamps over-limit text fields to ROUTE_TEXT_LIMIT", () => {
    const long = "x".repeat(ROUTE_TEXT_LIMIT + 50);
    const meta = serializeAttemptMetadata(
      makeAttempt({ state: long, area: long, route: long, rating: long, notes: long }),
    );
    for (const k of ["state", "area", "route", "rating", "notes"] as const) {
      expect((meta[k] as string).length).toBe(ROUTE_TEXT_LIMIT);
    }
  });

  it("keeps text fields exactly at the limit intact", () => {
    const atLimit = "y".repeat(ROUTE_TEXT_LIMIT);
    const meta = serializeAttemptMetadata(makeAttempt({ notes: atLimit }));
    expect(meta.notes).toBe(atLimit);
  });

  it("trims surrounding whitespace on text fields", () => {
    const meta = serializeAttemptMetadata(makeAttempt({ route: "  The Classic  " }));
    expect(meta.route).toBe("The Classic");
  });

  it("leaves non-text fields (videoMeta) untouched by clamping", () => {
    const meta = serializeAttemptMetadata(makeAttempt());
    expect(meta.videoMeta).toEqual({ width: 640, height: 480, fps: 30, duration: 10 });
  });
});

describe("serializeAttemptData", () => {
  it("base64-encodes descriptors and carries heavy fields", () => {
    const data = serializeAttemptData(makeAttempt());
    const orb = data.orbFeatures as Record<string, unknown>;
    expect(typeof orb.descriptors).toBe("string");
    expect("frames" in data).toBe(true);
    expect("matchesPerFrame" in data).toBe(true);
  });

  it("preserves null orbFeatures", () => {
    expect(serializeAttemptData(makeAttempt({ orbFeatures: null })).orbFeatures).toBeNull();
  });
});

describe("split round-trip", () => {
  it("metadata + data merge back into the original attempt", () => {
    const attempt = makeAttempt();
    const meta = JSON.parse(JSON.stringify(serializeAttemptMetadata(attempt)));
    const data = JSON.parse(JSON.stringify(serializeAttemptData(attempt)));
    const restored = loadAttemptFromJson({ ...meta, ...data });
    expect(restored.id).toBe(attempt.id);
    expect(restored.route).toBe(attempt.route);
    expect(restored.orbFeatures!.descriptors).toBeInstanceOf(Uint8Array);
    expect(restored.orbFeatures!.descriptors).toEqual(attempt.orbFeatures!.descriptors);
  });
});

// ---------------------------------------------------------------------------
// Authored, persisted Holds (ADR 0009)
// ---------------------------------------------------------------------------

describe("holds persistence", () => {
  const holds = [
    { x: 0.25, y: 0.4, kind: "hand" as const, firstUseTime: 1.2 },
    { x: 0.7, y: 0.8, kind: "foot" as const, firstUseTime: 2.5 },
  ];

  it("rides in the queryable metadata payload, not the heavy data payload", () => {
    const meta = serializeAttemptMetadata(makeAttempt({ holds }));
    const data = serializeAttemptData(makeAttempt({ holds }));
    expect(meta.holds).toEqual(holds);
    expect("holds" in data).toBe(false);
  });

  it("round-trips through the v2 split format", () => {
    const attempt = makeAttempt({ holds });
    const meta = JSON.parse(JSON.stringify(serializeAttemptMetadata(attempt)));
    const data = JSON.parse(JSON.stringify(serializeAttemptData(attempt)));
    const restored = loadAttemptFromJson({ ...meta, ...data });
    expect(restored.holds).toEqual(holds);
  });

  it("loads a legacy attempt with no holds field as undefined (on-the-fly fallback)", () => {
    const restored = loadAttemptFromJson({ id: "a", frames: [] });
    expect(restored.holds).toBeUndefined();
  });

  it("preserves an empty holds array (authored 'no holds', not a fallback)", () => {
    const attempt = makeAttempt({ holds: [] });
    const meta = JSON.parse(JSON.stringify(serializeAttemptMetadata(attempt)));
    const restored = loadAttemptFromJson(meta);
    expect(restored.holds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Panning Capture keyframes
// ---------------------------------------------------------------------------

function makeKeyframes(): RouteAttempt["keyframes"] {
  return [
    {
      timestamp: 0,
      features: {
        keypoints: [{ pt: { x: 1, y: 2 }, size: 5, angle: 0, response: 1, octave: 0 }],
        descriptors: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
      },
    },
    {
      timestamp: 0.75,
      features: {
        keypoints: [{ pt: { x: 9, y: 8 }, size: 7, angle: 90, response: 2, octave: 1 }],
        descriptors: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]),
        cropBox: { x: 5, y: 5, width: 100, height: 200, srcWidth: 640, srcHeight: 480 },
      },
    },
  ];
}

describe("keyframe serialisation", () => {
  it("base64-encodes each keyframe's descriptors in the data payload", () => {
    const data = serializeAttemptData(makeAttempt({ keyframes: makeKeyframes() }));
    const kfs = data.keyframes as Array<Record<string, unknown>>;
    expect(kfs).toHaveLength(2);
    expect(kfs[0].timestamp).toBe(0);
    const feats = kfs[1].features as Record<string, unknown>;
    expect(typeof feats.descriptors).toBe("string");
  });

  it("keeps keyframes out of the queryable metadata payload", () => {
    const meta = serializeAttemptMetadata(makeAttempt({ keyframes: makeKeyframes() }));
    expect(meta.keyframes).toBeUndefined();
  });

  it("round-trips keyframes through the v2 split format", () => {
    const attempt = makeAttempt({ keyframes: makeKeyframes() });
    const meta = JSON.parse(JSON.stringify(serializeAttemptMetadata(attempt)));
    const data = JSON.parse(JSON.stringify(serializeAttemptData(attempt)));
    const restored = loadAttemptFromJson({ ...meta, ...data });
    expect(restored.keyframes).toHaveLength(2);
    expect(restored.keyframes![0].timestamp).toBe(0);
    expect(restored.keyframes![1].timestamp).toBe(0.75);
    expect(restored.keyframes![0].features.descriptors).toBeInstanceOf(Uint8Array);
    expect(restored.keyframes![0].features.descriptors).toEqual(
      new Uint8Array([0x01, 0x02, 0x03, 0x04]),
    );
    expect(restored.keyframes![1].features.cropBox).toEqual({
      x: 5,
      y: 5,
      width: 100,
      height: 200,
      srcWidth: 640,
      srcHeight: 480,
    });
  });

  it("round-trips keyframes through the legacy v1 combined format", () => {
    const attempt = makeAttempt({ keyframes: makeKeyframes() });
    const serialized = JSON.parse(JSON.stringify(serializeAttemptForJson(attempt)));
    const kfs = serialized.keyframes as Array<Record<string, unknown>>;
    const feats = kfs[0].features as Record<string, unknown>;
    expect(Array.isArray(feats.descriptors)).toBe(true);
    const restored = loadAttemptFromJson(serialized);
    expect(restored.keyframes![1].features.descriptors).toEqual(
      new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]),
    );
  });

  it("loads a Fixed Capture / legacy attempt that has no keyframes field", () => {
    const attempt = makeAttempt();
    const data = JSON.parse(JSON.stringify(serializeAttemptData(attempt)));
    const restored = loadAttemptFromJson(data);
    // Absent keyframes serialise to null and load back as null — not an error.
    expect(restored.keyframes ?? null).toBeNull();
    expect(restored.orbFeatures!.descriptors).toEqual(attempt.orbFeatures!.descriptors);
  });
});
