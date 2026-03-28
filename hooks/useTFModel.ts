"use client";

import { useEffect, useState } from "react";

// Typed loosely because @tensorflow-models/pose-detection types can conflict
// with different @tensorflow/tfjs versions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoseDetector = any;

export type PoseModelName = "movenet_lightning" | "movenet_thunder" | "blazepose";

export interface UseTFModelResult {
  model: PoseDetector | null;
  ready: boolean;
}

// ---------------------------------------------------------------------------
// Module-level singleton — shared across every hook instance & navigation.
// Mirrors the pattern used by useOpenCV (loadStarted + listeners).
// ---------------------------------------------------------------------------

let cachedDetector: PoseDetector | null = null;
let cachedModelName: PoseModelName | null = null;
let loadPromise: Promise<void> | null = null;
const listeners: Array<() => void> = [];

function notifyReady() {
  for (const fn of [...listeners]) fn();
  listeners.length = 0;
}

async function loadDetector(modelName: PoseModelName): Promise<void> {
  // Dynamic imports keep TF.js out of the SSR bundle entirely.
  const tf = await import("@tensorflow/tfjs");
  await import("@tensorflow/tfjs-backend-webgl");

  await tf.setBackend("webgl");
  await tf.ready();

  const poseDetection = await import("@tensorflow-models/pose-detection");

  let detector: PoseDetector;

  if (modelName === "blazepose") {
    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.BlazePose,
      {
        runtime: "tfjs",
        modelType: "full",
      },
    );
  } else {
    const modelType =
      modelName === "movenet_thunder"
        ? poseDetection.movenet.modelType.SINGLEPOSE_THUNDER
        : poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING;

    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType },
    );
  }

  // Warm up the model with a blank canvas so WebGL shaders are compiled
  // before the first real inference.
  try {
    const warmup = document.createElement("canvas");
    warmup.width = 192;
    warmup.height = 192;
    await detector.estimatePoses(warmup, { flipHorizontal: false });
  } catch {
    // Warm-up is best-effort — a failure only means the first real
    // inference will compile shaders on the fly.
  }

  cachedDetector = detector;
  cachedModelName = modelName;
  console.info(`[useTFModel] ${modelName} loaded on backend: ${tf.getBackend()}`);
  notifyReady();
}

/**
 * Loads the TF.js WebGL backend and a pose-detection model.
 *
 * The detector is cached at module level so every hook instance (Preloader,
 * LoadingGate, page components) shares a single model. Navigating between
 * pages in Next.js App Router does not trigger a reload.
 *
 * @param modelName - Which model to load (default: "movenet_lightning").
 */
export function useTFModel(
  modelName: PoseModelName = "movenet_lightning",
): UseTFModelResult {
  const [ready, setReady] = useState<boolean>(
    () => cachedDetector !== null && cachedModelName === modelName,
  );

  useEffect(() => {
    // Already loaded with the requested model — initializer handled state.
    if (cachedDetector && cachedModelName === modelName) {
      return;
    }

    const onReady = () => setReady(true);
    listeners.push(onReady);

    // Start loading if no load is in progress (or model name changed).
    if (!loadPromise || cachedModelName !== modelName) {
      cachedDetector = null;
      loadPromise = loadDetector(modelName).catch((err) => {
        console.error("[useTFModel] Failed to load TF.js model:", err);
        loadPromise = null; // allow retry on next mount
      });
    }

    return () => {
      const idx = listeners.indexOf(onReady);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }, [modelName]);

  return { model: ready ? cachedDetector : null, ready };
}
