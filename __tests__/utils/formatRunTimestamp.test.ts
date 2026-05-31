import { describe, expect, it } from "vitest";
import { runTimestampMs, formatRunTimestamp } from "@/utils/formatRunTimestamp";

// A fixed instant: 2021-11-14T22:13:20.000Z
const TS = 1636928000000;

describe("runTimestampMs", () => {
  it("parses the current run-{ms} id", () => {
    expect(runTimestampMs(`run-${TS}`)).toBe(TS);
  });

  it("parses the legacy attempt-{ms} id", () => {
    expect(runTimestampMs(`attempt-${TS}`)).toBe(TS);
  });

  it("parses the run-{ms}-{type}.json filename", () => {
    expect(runTimestampMs(`run-${TS}-send.json`)).toBe(TS);
  });

  it("returns null when no timestamp is present", () => {
    expect(runTimestampMs("not-a-run")).toBeNull();
  });
});

describe("formatRunTimestamp", () => {
  it("returns non-empty date and time parts for a valid id", () => {
    const parts = formatRunTimestamp(`run-${TS}`);
    expect(parts).not.toBeNull();
    expect(parts!.date.length).toBeGreaterThan(0);
    expect(parts!.time.length).toBeGreaterThan(0);
  });

  it("returns null for an unparseable id", () => {
    expect(formatRunTimestamp("garbage")).toBeNull();
  });
});
