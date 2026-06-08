"use client";

/**
 * Pose model hook — loads a MediaPipe Pose Landmarker model.
 *
 * Returns the loaded landmarker, readiness flag, and the backend identifier
 * so downstream code can dispatch correctly.
 *
 * Model instances are cached at module level (one per variant) and shared
 * across all hook consumers.
 */

import { useEffect, useState } from "react";
import type { PoseBackend } from "@/utils/poseConstants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoseDetector = any;

// ---------------------------------------------------------------------------
// Model configuration types
// ---------------------------------------------------------------------------

export type MediaPipeVariant = "lite" | "full" | "heavy";

export interface PoseModelConfig {
  backend: "mediapipe";
  variant: MediaPipeVariant;
  /**
   * Maximum number of poses the landmarker returns per frame. The
   * climber-identity tracker needs >1 so it has candidates to disambiguate the
   * climber from bystanders. Defaults to {@link DEFAULT_MAX_POSES}.
   */
  maxPoses?: number;
}

export interface UsePoseModelResult {
  model: PoseDetector | null;
  ready: boolean;
  backend: PoseBackend;
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

/**
 * Default cap on poses returned per frame. Three is enough to disambiguate the
 * climber from one or two bystanders without materially raising decode cost.
 */
export const DEFAULT_MAX_POSES = 3;

export const DEFAULT_POSE_MODEL: PoseModelConfig = {
  backend: "mediapipe",
  variant: "lite",
  maxPoses: DEFAULT_MAX_POSES,
};

// ---------------------------------------------------------------------------
// Module-level singleton cache
// ---------------------------------------------------------------------------

let cachedModel: PoseDetector | null = null;
let cachedConfigKey: string | null = null;
let loadPromise: Promise<void> | null = null;
let loadingConfigKey: string | null = null;
const listeners: Array<() => void> = [];

function configKey(config: PoseModelConfig): string {
  return `${config.backend}:${config.variant}:${config.maxPoses ?? DEFAULT_MAX_POSES}`;
}

function notifyReady() {
  for (const fn of [...listeners]) fn();
  listeners.length = 0;
}

// ---------------------------------------------------------------------------
// MediaPipe Pose Landmarker loader
// ---------------------------------------------------------------------------

/** Same-origin base for MediaPipe WASM runtime files. */
const MP_WASM_BASE = "/mediapipe/wasm";

/** Local static paths for each MediaPipe Pose Landmarker model variant. */
const MP_MODEL_URLS: Record<MediaPipeVariant, string> = {
  lite: "/models/pose/pose_landmarker_lite.task",
  full: "/models/pose/pose_landmarker_full.task",
  heavy: "/models/pose/pose_landmarker_heavy.task",
};

async function loadModelAssetBuffer(variant: MediaPipeVariant): Promise<Uint8Array> {
  const path = MP_MODEL_URLS[variant];
  const response = await fetch(path, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(
      `[usePoseModel] Failed to load local MediaPipe model (${variant}) from ${path} (${response.status}). ` +
        "Run: npm run setup:pose-models",
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function loadMediaPipe(variant: MediaPipeVariant, maxPoses: number): Promise<void> {
  const { FilesetResolver, PoseLandmarker } = await import(
    "@mediapipe/tasks-vision"
  );

  const vision = await FilesetResolver.forVisionTasks(MP_WASM_BASE);
  const modelAssetBuffer = await loadModelAssetBuffer(variant);

  const landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetBuffer,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: Math.max(1, maxPoses),
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  cachedModel = landmarker;
  console.info(
    `[usePoseModel] MediaPipe Pose Landmarker (${variant}, numPoses=${maxPoses}) loaded`,
  );
}

// ---------------------------------------------------------------------------
// Unified loader
// ---------------------------------------------------------------------------

/** Dispose the currently cached model to free GPU / WASM resources. */
function disposeCurrentModel(): void {
  if (!cachedModel) return;
  try {
    if (typeof cachedModel.close === "function") cachedModel.close();
  } catch {
    // Best-effort cleanup.
  }
  cachedModel = null;
}

async function loadModel(config: PoseModelConfig): Promise<void> {
  disposeCurrentModel();
  await loadMediaPipe(config.variant, config.maxPoses ?? DEFAULT_MAX_POSES);
  cachedConfigKey = configKey(config);
  notifyReady();
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Load and cache a MediaPipe Pose Landmarker model.
 *
 * The model is cached at module level so navigating between pages does not
 * trigger a reload. When the config changes, the old model is discarded and
 * the new one is loaded.
 */
export function usePoseModel(
  config: PoseModelConfig = DEFAULT_POSE_MODEL,
): UsePoseModelResult {
  const key = configKey(config);

  const [, rerender] = useState(0);

  useEffect(() => {
    if (cachedModel && cachedConfigKey === key) {
      return;
    }

    const onReady = () => rerender((n) => n + 1);
    listeners.push(onReady);

    // In React dev StrictMode, effects can mount twice. Keep a single in-flight
    // model load per config key to avoid racing MediaPipe WASM initialisation.
    if (!loadPromise) {
      loadingConfigKey = key;
      loadPromise = loadModel(config).catch((err) => {
        console.error("[usePoseModel] Failed to load model:", err);
      }).finally(() => {
        loadPromise = null;
        loadingConfigKey = null;
      });
    } else if (loadingConfigKey !== key && cachedConfigKey !== key) {
      // A different config was requested while another model was loading.
      // Queue one follow-up load after the current one settles.
      const nextConfig = config;
      const nextKey = key;
      loadPromise = loadPromise.finally(() => {
        if (cachedConfigKey === nextKey) return;
        loadingConfigKey = nextKey;
        return loadModel(nextConfig)
          .catch((err) => {
            console.error("[usePoseModel] Failed to load model:", err);
          })
          .finally(() => {
            loadPromise = null;
            loadingConfigKey = null;
          });
      });
    }

    return () => {
      const idx = listeners.indexOf(onReady);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }, [key, config]);

  const ready = cachedModel !== null && cachedConfigKey === key;

  return {
    model: ready ? cachedModel : null,
    ready,
    backend: "mediapipe",
  };
}
