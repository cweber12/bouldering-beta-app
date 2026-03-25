"use client";

import { useEffect, useRef, useState } from "react";

// Typed loosely because @tensorflow-models/pose-detection types can conflict
// with different @tensorflow/tfjs versions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoseDetector = any;

export type PoseModelName = "movenet_lightning" | "movenet_thunder" | "blazepose";

export interface UseTFModelResult {
  model: PoseDetector | null;
  ready: boolean;
}

/**
 * Loads the TF.js WebGL backend and a pose-detection model.
 *
 * Imports are dynamic so they are never evaluated during SSR (this hook is
 * only called inside 'use client' components).
 *
 * @param modelName - Which model to load (default: "movenet_lightning").
 */
export function useTFModel(
  modelName: PoseModelName = "movenet_lightning",
): UseTFModelResult {
  const [ready, setReady] = useState(false);
  const detectorRef = useRef<PoseDetector | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
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

        if (!cancelled) {
          detectorRef.current = detector;
          setReady(true);
          console.info(`[useTFModel] ${modelName} loaded on backend: ${tf.getBackend()}`);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[useTFModel] Failed to load TF.js model:", err);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [modelName]);

  return { model: detectorRef.current, ready };
}
