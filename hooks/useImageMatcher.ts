"use client";

import { useState, useCallback } from "react";
import {
  extractFeatures,
  extractFeaturesFromCrop,
  matchOrbFeatures,
  downscaleImageData,
  rescaleFeaturesToNative,
  queryMaxEdgeFor,
  PANNING_QUERY_MAX_EDGE,
  type OrbMatch,
  type OrbFeatures,
} from "@/pipeline/orbDetector";
import { computeHomography, applyHomographyMatrix, ransacReprojThresholdFor, type KeyframeHomography } from "@/pipeline/homography";
import { cropImageData } from "@/utils/cvHelpers";
import { capToPixelBudget } from "@/utils/imageHelpers";
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
  /**
   * Panning Capture only: per-keyframe homographies (reference video-frame →
   * photo), ascending by timestamp, with un-matchable keyframes dropped. Present
   * and non-empty only when the attempt stored keyframes and at least one passed
   * the match/validity gate; the render path uses these instead of `matches`.
   */
  keyframeHomographies?: KeyframeHomography[];
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

      // Phone photos are often 4000px+, which makes ORB extraction take several
      // seconds and adds no matchable detail beyond the video reference's
      // resolution. Downscale the query to a reference-aware longest-edge target
      // before extraction; keypoints are mapped back to native coordinates after
      // so homography and the re-anchor pass operate in full-resolution space.
      // Panning Capture is detected from stored keyframes. The photo is kept at
      // higher resolution (PANNING_QUERY_MAX_EDGE) so each Keyframe's close-up
      // section still has detail to match against its small region of the photo.
      const panningMatch = (attempt.keyframes?.length ?? 0) > 0;
      const maxEdge = panningMatch
        ? PANNING_QUERY_MAX_EDGE
        : queryMaxEdgeFor(attempt.videoMeta.width, attempt.videoMeta.height);
      const { imageData: scaled, scale } = downscaleImageData(cv, imageData, maxEdge);

      // When the user specified a crop region, extract ORB features only from
      // that sub-region. Keypoints are offset back to full-image coordinates
      // by extractFeaturesFromCrop so homography computation is unaffected.
      let queryOrb = userCrop
        ? extractFeaturesFromCrop(cv, scaled, {
            x: Math.round(userCrop.x * scaled.width),
            y: Math.round(userCrop.y * scaled.height),
            width: Math.round(userCrop.w * scaled.width),
            height: Math.round(userCrop.h * scaled.height),
            srcWidth: scaled.width,
            srcHeight: scaled.height,
          })
        : extractFeatures(cv, scaled);
      queryOrb = rescaleFeaturesToNative(queryOrb, scale);
      let matches = matchOrbFeatures(cv, attempt.orbFeatures, queryOrb);
      let reanchorApplied = false;

      // Re-anchor pass: if the initial match count is below the threshold and
      // the reference features include a known crop box, try estimating the
      // corresponding region in the query image and re-running ORB there.
      // Reprojection threshold scales with the photo's native resolution; the
      // validity gate rejects flipped/degenerate transforms of the video frame.
      const reproj = ransacReprojThresholdFor(Math.max(imageData.width, imageData.height));
      const gate = { srcWidth: attempt.videoMeta.width, srcHeight: attempt.videoMeta.height };

      // Skip the re-anchor crop pass for Panning Capture: it would replace the
      // full-photo queryOrb with a sub-region (anchored to the frame-0 crop),
      // but every keyframe must match against the whole photo.
      if (
        !panningMatch &&
        matches.length < MIN_REANCHOR_THRESHOLD &&
        matches.length >= 4 &&
        attempt.orbFeatures.cropBox
      ) {
        const roughH = computeHomography(cv, matches, attempt.orbFeatures, queryOrb, {
          ransacReprojThreshold: reproj,
          gate,
        });
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

      // Panning Capture: match every stored Keyframe to the (whole) photo and
      // compute its photo-homography. Keyframes with too few matches or a
      // degenerate transform are dropped — homographyAtTime interpolates across
      // the gaps at render time. The photo is the global reference, so each
      // keyframe is anchored independently (drift-free, no chaining).
      let keyframeHomographies: KeyframeHomography[] | undefined;
      if (panningMatch && attempt.keyframes) {
        const kfs: KeyframeHomography[] = [];
        for (const kf of attempt.keyframes) {
          const kfMatches = matchOrbFeatures(cv, kf.features, queryOrb);
          if (kfMatches.length < 4) continue;
          const h = computeHomography(cv, kfMatches, kf.features, queryOrb, {
            ransacReprojThreshold: reproj,
            gate,
          });
          if (!h) continue; // failed RANSAC or validity gate → skip, interpolated
          kfs.push({ timestamp: kf.timestamp, h });
        }
        if (kfs.length > 0) {
          keyframeHomographies = kfs.sort((a, b) => a.timestamp - b.timestamp);
        }
      }

      setResult({
        matches,
        queryKeypoints: queryOrb.keypoints.length,
        referenceKeypoints: attempt.orbFeatures.keypoints.length,
        queryOrb,
        reanchorApplied,
        keyframeHomographies,
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
      // Decode-time pixel cap: never rasterise more than MAX_DECODE_PIXELS so a
      // gigapixel / decompression-bomb upload can't exhaust memory or the WASM
      // heap. The route-photo "native" pixel space the homography targets is
      // this (possibly capped) canvas; the renderer caps identically to match.
      const { width, height } = capToPixelBudget(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not get 2D canvas context for image."));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
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
