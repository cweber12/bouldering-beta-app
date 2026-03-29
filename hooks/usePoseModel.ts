"use client";

/**
 * Unified pose model hook — loads either a MoveNet (TF.js) or MediaPipe
 * Pose Landmarker model based on the requested configuration.
 *
 * Returns the loaded detector/landmarker, readiness flag, and which backend
 * is active so downstream code can dispatch correctly.
 *
 * Model instances are cached at module level (one per backend+variant
 * combination) and shared across all hook consumers.
 */

import { useEffect, useState } from "react";
import type { PoseBackend } from "@/utils/poseConstants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoseDetector = any;

// ---------------------------------------------------------------------------
// Model configuration types
// ---------------------------------------------------------------------------

export type MoveNetVariant = "lightning" | "thunder";
export type MediaPipeVariant = "lite" | "full" | "heavy";

export interface MoveNetModelConfig {
  backend: "movenet";
  variant: MoveNetVariant;
}

export interface MediaPipeModelConfig {
  backend: "mediapipe";
  variant: MediaPipeVariant;
}

export type PoseModelConfig = MoveNetModelConfig | MediaPipeModelConfig;

export interface UsePoseModelResult {
  model: PoseDetector | null;
  ready: boolean;
  backend: PoseBackend;
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

export const DEFAULT_POSE_MODEL: PoseModelConfig = {
  backend: "movenet",
  variant: "lightning",
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
// MoveNet loader (TF.js)
// ---------------------------------------------------------------------------

async function loadMoveNet(variant: MoveNetVariant): Promise<void> {
  const tf = await import("@tensorflow/tfjs");
  await import("@tensorflow/tfjs-backend-webgl");
  await tf.setBackend("webgl");
  await tf.ready();

  const poseDetection = await import("@tensorflow-models/pose-detection");

  const modelType =
    variant === "thunder"
      ? poseDetection.movenet.modelType.SINGLEPOSE_THUNDER
      : poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING;

  const detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType },
  );

  // Warm up with a blank canvas so WebGL shaders compile before real inference.
  try {
    const warmup = document.createElement("canvas");
    warmup.width = 192;
    warmup.height = 192;
    await detector.estimatePoses(warmup, { flipHorizontal: false });
  } catch {
    // Warm-up is best-effort.
  }

  cachedModel = detector;
  console.info(`[usePoseModel] MoveNet ${variant} loaded on backend: ${tf.getBackend()}`);
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
    // MediaPipe PoseLandmarker exposes .close(); TF.js PoseDetector exposes .dispose().
    if (typeof cachedModel.close === "function") cachedModel.close();
    else if (typeof cachedModel.dispose === "function") cachedModel.dispose();
  } catch {
    // Best-effort cleanup.
  }
  cachedModel = null;
}

async function loadModel(config: PoseModelConfig): Promise<void> {
  disposeCurrentModel();
  if (config.backend === "mediapipe") {
    await loadMediaPipe(config.variant);
  } else {
    await loadMoveNet(config.variant);
  }
  cachedConfigKey = configKey(config);
  notifyReady();
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Load and cache a pose detection model.
 *
 * The model is cached at module level so navigating between pages does not
 * trigger a reload. When the config changes, the old model is discarded and
 * the new one is loaded.
 */
export function usePoseModel(
  config: PoseModelConfig = DEFAULT_POSE_MODEL,
): UsePoseModelResult {
  const key = configKey(config);

  // A counter that triggers re-renders when the model becomes available.
  // `ready` is derived from the module-level cache, not stored directly.
  const [, rerender] = useState(0);

  useEffect(() => {
    // Already loaded with the requested config — no work needed.
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
    backend: config.backend,
  };
}
