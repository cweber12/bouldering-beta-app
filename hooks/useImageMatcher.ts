"use client";

import { useState, useCallback } from "react";
import { extractFeatures, extractFeaturesFromCrop, matchOrbFeatures, type OrbMatch, type OrbFeatures } from "@/pipeline/orbDetector";
import { computeHomography, applyHomographyMatrix } from "@/pipeline/homography";
import { cropImageData } from "@/utils/cvHelpers";
import { getAttempt } from "@/storage/sessionStore";
import type { CropFraction } from "@/components/shared/CropBoxOverlay";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

/** Minimum match count below which a re-anchor crop pass is attempted. */
const MIN_REANCHOR_THRESHOLD = 10;

export interface ImageMatchResult {
  /** Matches that passed the Lowe ratio test. */
  matches: OrbMatch[];
  /** Number of keypoints detected in the uploaded image. */
  queryKeypoints: number;
  /** Number of keypoints in the stored reference frame. */
  referenceKeypoints: number;
  /** Full ORB features of the uploaded image — needed for homography computation. */
  queryOrb: OrbFeatures;
  /**
   * True when a re-anchor crop pass was applied because the initial match
   * count was below MIN_REANCHOR_THRESHOLD and the reference has a stored
   * crop box. The returned matches and queryOrb reflect the re-anchored result.
   */
  reanchorApplied: boolean;
}

export type MatchStatus = "idle" | "matching" | "done" | "error";

export interface ImageMatcherResult {
  matchImage: (file: File, attemptId: string, cv: CV, userCrop?: CropFraction) => Promise<void>;
  /** Reset all state back to idle (no result, no error). */
  reset: () => void;
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

  const matchImage = useCallback(async (file: File, attemptId: string, cv: CV, userCrop?: CropFraction) => {
    setStatus("matching");
    setResult(null);
    setErrorMessage(null);

    try {
      const attempt = getAttempt(attemptId);
      if (!attempt?.orbFeatures) {
        throw new Error("No ORB reference features found for this attempt.");
      }

      const imageData = await loadImageAsImageData(file);

      // When the user specified a crop region, extract ORB features only from
      // that sub-region. Keypoints are offset back to full-image coordinates
      // by extractFeaturesFromCrop so homography computation is unaffected.
      let queryOrb = userCrop
        ? extractFeaturesFromCrop(cv, imageData, {
            x: Math.round(userCrop.x * imageData.width),
            y: Math.round(userCrop.y * imageData.height),
            width: Math.round(userCrop.w * imageData.width),
            height: Math.round(userCrop.h * imageData.height),
            srcWidth: imageData.width,
            srcHeight: imageData.height,
          })
        : extractFeatures(cv, imageData);
      let matches = matchOrbFeatures(cv, attempt.orbFeatures, queryOrb);
      let reanchorApplied = false;

      // Re-anchor pass: if the initial match count is below the threshold and
      // the reference features include a known crop box, try estimating the
      // corresponding region in the query image and re-running ORB there.
      if (
        matches.length < MIN_REANCHOR_THRESHOLD &&
        matches.length >= 4 &&
        attempt.orbFeatures.cropBox
      ) {
        const roughH = computeHomography(cv, matches, attempt.orbFeatures, queryOrb);
        if (roughH) {
          const box = attempt.orbFeatures.cropBox;
          // Map the 4 corners of the reference crop box to query-image space.
          const corners = [
            { x: box.x,              y: box.y               },
            { x: box.x + box.width,  y: box.y               },
            { x: box.x + box.width,  y: box.y + box.height  },
            { x: box.x,              y: box.y + box.height  },
          ].map(pt => applyHomographyMatrix(roughH, pt.x, pt.y));

          const xs = corners.map(pt => pt.x);
          const ys = corners.map(pt => pt.y);
          const qx = Math.max(0, Math.floor(Math.min(...xs)));
          const qy = Math.max(0, Math.floor(Math.min(...ys)));
          const qRight  = Math.min(imageData.width,  Math.ceil(Math.max(...xs)));
          const qBottom = Math.min(imageData.height, Math.ceil(Math.max(...ys)));
          const qWidth  = qRight - qx;
          const qHeight = qBottom - qy;

          if (qWidth > 0 && qHeight > 0) {
            const queryCropData = cropImageData(imageData, { x: qx, y: qy, width: qWidth, height: qHeight });
            const queryCropOrb  = extractFeatures(cv, queryCropData);
            // Offset keypoints back to full-image coordinates.
            const offsetKp = queryCropOrb.keypoints.map(kp => ({
              ...kp,
              pt: { x: kp.pt.x + qx, y: kp.pt.y + qy },
            }));
            const queryCropOrbFull: OrbFeatures = { ...queryCropOrb, keypoints: offsetKp };
            const matches2 = matchOrbFeatures(cv, attempt.orbFeatures, queryCropOrbFull);
            if (matches2.length > matches.length) {
              matches          = matches2;
              queryOrb         = queryCropOrbFull;
              reanchorApplied  = true;
            }
          }
        }
      }

      setResult({
        matches,
        queryKeypoints: queryOrb.keypoints.length,
        referenceKeypoints: attempt.orbFeatures.keypoints.length,
        queryOrb,
        reanchorApplied,
      });
      setStatus("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[useImageMatcher] Error:", err);
      setStatus("error");
      setErrorMessage(msg);
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setErrorMessage(null);
  }, []);

  return { matchImage, reset, status, result, errorMessage };
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
