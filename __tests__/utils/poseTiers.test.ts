import { describe, it, expect } from "vitest";
import {
  TIER_CONFIGS,
  QUALITY_TIERS,
  DEFAULT_TIER,
  TIER_LABELS,
  getTierConfig,
  type QualityTier,
} from "@/utils/poseTiers";

describe("poseTiers", () => {
  it("exposes exactly the three quality tiers", () => {
    expect([...QUALITY_TIERS]).toEqual(["fast", "balanced", "accurate"]);
  });

  it("getTierConfig resolves each tier to its config bundle", () => {
    for (const tier of QUALITY_TIERS) {
      expect(getTierConfig(tier)).toBe(TIER_CONFIGS[tier]);
    }
  });

  it("Fast maps to the lightest config bundle", () => {
    expect(getTierConfig("fast")).toEqual({
      variant: "lite",
      maxPoses: 2,
      frameStep: 15,
      maxRecoveryFrames: 15,
      filterTolerance: 4,
    });
  });

  it("Balanced mirrors the historical defaults", () => {
    expect(getTierConfig("balanced")).toEqual({
      variant: "full",
      maxPoses: 3,
      frameStep: 10,
      maxRecoveryFrames: 30,
      filterTolerance: 3,
    });
  });

  it("Accurate maps to the heaviest config bundle", () => {
    expect(getTierConfig("accurate")).toEqual({
      variant: "heavy",
      maxPoses: 4,
      frameStep: 5,
      maxRecoveryFrames: 45,
      filterTolerance: 2,
    });
  });

  it("default tier is balanced (preserves prior behaviour)", () => {
    expect(DEFAULT_TIER).toBe("balanced");
  });

  it("frame step increases and filter tolerance loosens from accurate → fast", () => {
    const order: QualityTier[] = ["accurate", "balanced", "fast"];
    const steps = order.map(t => getTierConfig(t).frameStep);
    const tols = order.map(t => getTierConfig(t).filterTolerance);
    // Strictly increasing in both: denser→sparser sampling, stricter→looser filter.
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(tols).toEqual([...tols].sort((a, b) => a - b));
  });

  it("provides a human-readable label for every tier", () => {
    for (const tier of QUALITY_TIERS) {
      expect(TIER_LABELS[tier]).toBeTruthy();
    }
  });
});
