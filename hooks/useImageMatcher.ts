"use client";

import { useState, useCallback } from "react";
import { extractFeatures, matchOrbFeatures, type OrbMatch, type OrbFeatures } from "@/pipeline/orbDetector";
import { getAttempt } from "@/storage/sessionStore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export interface ImageMatchResult {
  /** Matches that passed the Lowe ratio test. */
  matches: OrbMatch[];
  /** Number of keypoints detected in the uploaded image. */
  queryKeypoints: number;
  /** Number of keypoints in the stored reference frame. */
  referenceKeypoints: number;
  /** Full ORB features of the uploaded image — needed for homography computation. */
  queryOrb: OrbFeatures;
}

export type MatchStatus = "idle" | "matching" | "done" | "error";

export interface ImageMatcherResult {
  matchImage: (file: File, attemptId: string, cv: CV) => Promise<void>;
  status: MatchStatus;
  result: ImageMatchResult | null;
  errorMessage: string | null;
}

/**
 * Extracts ORB features from an uploaded image (JPG, PNG, etc.) and matches
 * them against the reference-frame ORB features stored in sessionStore for the
 * given attempt.
 *
 * Reuses the shared ORB worker — no extra workers are created.
 * Framework-agnostic logic is in pipeline/orbFeatures and pipeline/orbMatcher.
 */
export function useImageMatcher(): ImageMatcherResult {
  const [status, setStatus] = useState<MatchStatus>("idle");
  const [result, setResult] = useState<ImageMatchResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const matchImage = useCallback(async (file: File, attemptId: string, cv: CV) => {
    setStatus("matching");
    setResult(null);
    setErrorMessage(null);

    try {
      const attempt = getAttempt(attemptId);
      if (!attempt?.orbFeatures) {
        throw new Error("No ORB reference features found for this attempt.");
      }

      const imageData = await loadImageAsImageData(file);
      const queryOrb = extractFeatures(cv, imageData);
      const matches = matchOrbFeatures(cv, attempt.orbFeatures, queryOrb);

      setResult({
        matches,
        queryKeypoints: queryOrb.keypoints.length,
        referenceKeypoints: attempt.orbFeatures.keypoints.length,
        queryOrb,
      });
      setStatus("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[useImageMatcher] Error:", err);
      setStatus("error");
      setErrorMessage(msg);
    }
  }, []);

  return { matchImage, status, result, errorMessage };
}

/**
 * Load an image File into an ImageData by drawing it onto an offscreen canvas.
 * The object URL is revoked immediately after the image loads.
 */
function loadImageAsImageData(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not get 2D canvas context for image."));
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
      resolve(imageData);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image file."));
    };

    img.src = url;
  });
}
