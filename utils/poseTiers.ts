/**
 * Quality-tier presets for pose detection.
 *
 * A single user-facing **Fast / Balanced / Accurate** choice maps to a bundle
 * of low-level detection knobs so the scan UI and the processing pipeline read
 * one source of truth instead of exposing the raw model/stride controls.
 *
 * The advanced panel still lets power users override individual knobs
 * (model variant, frame step) after picking a tier.
 *
 * This module is framework-agnostic — no React imports. The MediaPipeVariant
 * type is imported type-only (erased at compile time).
 */

import type { MediaPipeVariant } from "@/hooks/usePoseModel";

/** User-facing quality tier. */
export type QualityTier = "fast" | "balanced" | "accurate";

/** Resolved configuration bundle for a quality tier. */
export interface TierConfig {
  /** MediaPipe Pose Landmarker model variant. */
  variant: MediaPipeVariant;
  /**
   * Maximum poses the landmarker returns per frame (tracker candidate count).
   * Higher = better bystander disambiguation, slightly higher decode cost.
   */
  maxPoses: number;
  /**
   * Pose detection runs every N-th sampled frame. Lower = denser detection
   * (slower, less interpolation); higher = sparser (faster, more interpolation).
   */
  frameStep: number;
  /**
   * Gap-recovery aggressiveness: max frames probed per detected gap when
   * re-acquiring the climber after a tracking loss.
   */
  maxRecoveryFrames: number;
  /**
   * Maximum number of bad (missing or low-confidence) keypoints tolerated
   * within the climbing-relevant subset before a frame is discarded.
   * Consumed by {@link filterLandmarks} (climbing-weighted filtering).
   * Looser for Fast, stricter for Accurate.
   */
  filterTolerance: number;
}

/**
 * The three quality-tier presets.
 *
 * Balanced mirrors the historical defaults (full model, frameStep 10,
 * maxPoses 3) so selecting it preserves prior behaviour.
 */
export const TIER_CONFIGS: Record<QualityTier, TierConfig> = {
  fast: {
    variant: "lite",
    maxPoses: 2,
    frameStep: 15,
    maxRecoveryFrames: 15,
    filterTolerance: 4,
  },
  balanced: {
    variant: "full",
    maxPoses: 3,
    frameStep: 10,
    maxRecoveryFrames: 30,
    filterTolerance: 3,
  },
  accurate: {
    variant: "heavy",
    maxPoses: 4,
    frameStep: 5,
    maxRecoveryFrames: 45,
    filterTolerance: 2,
  },
};

/** Default tier used on first load (matches historical detection defaults). */
export const DEFAULT_TIER: QualityTier = "balanced";

/** Ordered tiers for rendering a selector. */
export const QUALITY_TIERS: readonly QualityTier[] = ["fast", "balanced", "accurate"] as const;

/** Human-readable label for each tier. */
export const TIER_LABELS: Record<QualityTier, string> = {
  fast: "Fast",
  balanced: "Balanced",
  accurate: "Accurate",
};

/** Short description of the trade-off each tier makes. */
export const TIER_DESCRIPTIONS: Record<QualityTier, string> = {
  fast: "Lite model, sparser sampling — quickest scan.",
  balanced: "Full model, balanced sampling and accuracy.",
  accurate: "Heavy model, dense sampling — most accurate, slowest.",
};

/** Resolve a tier to its configuration bundle. */
export function getTierConfig(tier: QualityTier): TierConfig {
  return TIER_CONFIGS[tier];
}
