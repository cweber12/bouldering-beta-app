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
}

export interface UsePoseModelResult {
  model: PoseDetector | null;
  ready: boolean;
  backend: PoseBackend;
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

export const DEFAULT_POSE_MODEL: PoseModelConfig = {
  backend: "mediapipe",
  variant: "lite",
};

// ---------------------------------------------------------------------------
// Module-level singleton cache
// ---------------------------------------------------------------------------

let cachedModel: PoseDetector | null = null;
let cachedConfigKey: string | null = null;
let loadPromise: Promise<void> | null = null;
const listeners: Array<() => void> = [];

function configKey(config: PoseModelConfig): string {
  return `${config.backend}:${config.variant}`;
}

function notifyReady() {
  for (const fn of [...listeners]) fn();
  listeners.length = 0;
}

// ---------------------------------------------------------------------------
// MediaPipe Pose Landmarker loader
// ---------------------------------------------------------------------------

/** CDN base for MediaPipe WASM files. */
const MP_WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

/** CDN paths for each MediaPipe Pose Landmarker model variant. */
const MP_MODEL_URLS: Record<MediaPipeVariant, string> = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
  heavy: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task",
};

async function loadMediaPipe(variant: MediaPipeVariant): Promise<void> {
  const { FilesetResolver, PoseLandmarker } = await import(
    "@mediapipe/tasks-vision"
  );

  const vision = await FilesetResolver.forVisionTasks(MP_WASM_CDN);

  const landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MP_MODEL_URLS[variant],
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  cachedModel = landmarker;
  console.info(`[usePoseModel] MediaPipe Pose Landmarker (${variant}) loaded`);
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
  await loadMediaPipe(config.variant);
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

    if (!loadPromise || cachedConfigKey !== key) {
      loadPromise = loadModel(config).catch((err) => {
        console.error("[usePoseModel] Failed to load model:", err);
        loadPromise = null;
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
