import { describe, it, expect } from "vitest";
import {
  parseHarnessContract,
  videoStatsGate,
  EXPECTED_HARNESS_API_VERSION,
} from "@/utils/harnessContract";

const FULL_CONTRACT = {
  service: "beta-scan-analysis-harness",
  apiVersion: 1,
  endpoints: ["/api/contract", "/api/video-stats", "/api/vitpose"],
  artifacts: { vitpose: 1, videoStats: 1 },
  suggestions: { available: true, fitDate: "2026-07-19", corpusSize: 39 },
};

describe("parseHarnessContract", () => {
  it("reduces a full contract to what the scanner gates on", () => {
    const c = parseHarnessContract(FULL_CONTRACT);
    expect(c).toEqual({
      apiVersion: 1,
      endpoints: ["/api/contract", "/api/video-stats", "/api/vitpose"],
      suggestionsAvailable: true,
    });
  });

  it("reads a missing/unfit suggestions block as unavailable", () => {
    expect(parseHarnessContract({ apiVersion: 1, endpoints: [] })?.suggestionsAvailable).toBe(
      false,
    );
    expect(
      parseHarnessContract({ apiVersion: 1, endpoints: [], suggestions: { available: false } })
        ?.suggestionsAvailable,
    ).toBe(false);
  });

  it("rejects non-contract shapes", () => {
    expect(parseHarnessContract(null)).toBeNull();
    expect(parseHarnessContract("nope")).toBeNull();
    expect(parseHarnessContract({ apiVersion: "1", endpoints: [] })).toBeNull();
    expect(parseHarnessContract({ apiVersion: 1 })).toBeNull();
  });
});

describe("videoStatsGate", () => {
  it("enables everything on a fit, advertised, version-matched contract", () => {
    const gate = videoStatsGate(parseHarnessContract(FULL_CONTRACT));
    expect(gate).toEqual({ statsEnabled: true, prefillEnabled: true, degradedReason: null });
  });

  it("degrades fully when the probe failed", () => {
    const gate = videoStatsGate(null);
    expect(gate.statsEnabled).toBe(false);
    expect(gate.prefillEnabled).toBe(false);
    expect(gate.degradedReason).toMatch(/unreachable/i);
  });

  it("degrades fully on an apiVersion mismatch", () => {
    const gate = videoStatsGate({
      apiVersion: EXPECTED_HARNESS_API_VERSION + 1,
      endpoints: ["/api/video-stats"],
      suggestionsAvailable: true,
    });
    expect(gate.statsEnabled).toBe(false);
    expect(gate.degradedReason).toMatch(/apiVersion/);
  });

  it("degrades fully when /api/video-stats is not advertised", () => {
    const gate = videoStatsGate({
      apiVersion: 1,
      endpoints: ["/api/contract", "/api/vitpose"],
      suggestionsAvailable: true,
    });
    expect(gate.statsEnabled).toBe(false);
    expect(gate.degradedReason).toMatch(/video-stats/);
  });

  it("still POSTs stats, without prefill, when suggestions are unfit", () => {
    const gate = videoStatsGate({
      apiVersion: 1,
      endpoints: ["/api/video-stats"],
      suggestionsAvailable: false,
    });
    expect(gate.statsEnabled).toBe(true);
    expect(gate.prefillEnabled).toBe(false);
    expect(gate.degradedReason).toMatch(/thresholds/i);
  });
});
