"use client";

import { useState, useCallback } from "react";
import {
  extractFeatures,
  extractFeaturesFromCrop,
  matchOrbFeatures,
  createQueryMatcher,
  downscaleImageData,
  rescaleFeaturesToNative,
  queryMaxEdgeFor,
  PANNING_QUERY_MAX_EDGE,
  type OrbMatch,
  type OrbFeatures,
} from "@/pipeline/orbDetector";
import { computeHomography, applyHomographyMatrix, ransacReprojThresholdFor, type KeyframeHomography } from "@/pipeline/homography";
import { estimateRouteCrop, type RouteCropEstimate } from "@/pipeline/routeCropEstimator";
import { analyzeFrame } from "@/pipeline/frameAnalyzer";
import { applyOrbPreprocessing } from "@/pipeline/framePreprocessor";
import {
  buildMatchDiagnostics,
  emptyHomographyStats,
  toFrameConditions,
  type HomographyStats,
  type MatchDiagnostics,
  type MatchResultInput,
} from "@/pipeline/diagnostics";
import { cropImageData } from "@/utils/cvHelpers";
import { capToPixelBudget } from "@/utils/imageHelpers";
import { hashFile } from "@/utils/hashFile";
import { shipDiagnostics } from "@/utils/shipDiagnostics";
import { APP_VERSION } from "@/utils/appVersion";
import { getAttempt } from "@/storage/sessionStore";
import type { CropFraction } from "@/utils/cropFraction";

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
  /**
   * Fixed Capture: the single gated reference video-frame → photo homography the
   * Route Overlay is rendered through. Computed here (resolution-scaled RANSAC +
   * validity gate) so a degenerate/flipped transform is rejected up front rather
   * than silently projecting the skeleton off-photo at render time. Absent when
   * {@link keyframeHomographies} drives the render (Panning Capture).
   */
  homography?: Float64Array;
}

export type MatchStatus = "idle" | "matching" | "done" | "error";

/** Lifecycle of the preliminary auto-frame estimate (separate from the match). */
export type AutoFrameStatus = "idle" | "estimating" | "done" | "failed";

export interface ImageMatcherResult {
  matchImage: (file: File, attemptId: string, cv: CV, userCrop?: CropFraction) => Promise<void>;
  /**
   * Run a preliminary full-photo match and project the reference crop box into
   * photo-space, returning a fractional crop the UI can pre-position for the user
   * to confirm. Resolves `null` (caller should fall back to manual cropping) for
   * Panning Capture, when there is no stored crop box, or when the preliminary
   * match is too weak to yield a valid homography. Independent of {@link matchImage}
   * — it never touches `status`/`result`.
   */
  estimateCrop: (file: File, attemptId: string, cv: CV) => Promise<RouteCropEstimate | null>;
  /** Lifecycle of the most recent {@link estimateCrop} call. */
  autoFrameStatus: AutoFrameStatus;
  /** Reset all state back to idle (no result, no error). */
  reset: () => void;
  status: MatchStatus;
  result: ImageMatchResult | null;
  errorMessage: string | null;
  /**
   * Dev-local Match Diagnostics for the most recent match (success or labelled
   * failure). Null until a match runs; consumed by the dev-only DiagnosticsPanel.
   */
  matchDiagnostics: MatchDiagnostics | null;
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
  const [matchDiagnostics, setMatchDiagnostics] = useState<MatchDiagnostics | null>(null);
  const [autoFrameStatus, setAutoFrameStatus] = useState<AutoFrameStatus>("idle");

  const matchImage = useCallback(async (file: File, attemptId: string, cv: CV, userCrop?: CropFraction) => {
    setStatus("matching");
    setResult(null);
    setErrorMessage(null);
    setMatchDiagnostics(null);

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

      // Symmetric ORB preprocessing: the reference frame and Panning keyframes
      // are extracted from an applyOrbPreprocessing (retinex LCN + equalise)
      // surface, so the query photo MUST be normalised the same way or the
      // descriptors are built on a different intensity surface and Hamming
      // distances inflate. Preprocess after downscaling (closest to the
      // reference's resolution, where the σ=30 retinex blur behaves the same)
      // and extract with normalizePixels=false since the LCN pass already
      // equalised. See pipeline/framePreprocessor.applyOrbPreprocessing.
      const scaledProcessed = preprocessForOrb(cv, scaled);

      // When the user specified a crop region, extract ORB features only from
      // that sub-region. Keypoints are offset back to full-image coordinates
      // by extractFeaturesFromCrop so homography computation is unaffected.
      let queryOrb = userCrop
        ? extractFeaturesFromCrop(cv, scaledProcessed, {
            x: Math.round(userCrop.x * scaled.width),
            y: Math.round(userCrop.y * scaled.height),
            width: Math.round(userCrop.w * scaled.width),
            height: Math.round(userCrop.h * scaled.height),
            srcWidth: scaled.width,
            srcHeight: scaled.height,
          }, false)
        : extractFeatures(cv, scaledProcessed, false);
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
            // Same symmetric preprocessing as the primary query pass.
            const queryCropOrb  = extractFeatures(cv, preprocessForOrb(cv, queryCropData), false);
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
      // Per-keyframe homography stats for the Match Diagnostics aggregate (one
      // entry per attempted Keyframe, including those dropped for too few matches).
      const perKeyframeStats: HomographyStats[] = [];
      let keyframeHomographies: KeyframeHomography[] | undefined;
      if (panningMatch && attempt.keyframes) {
        const kfs: KeyframeHomography[] = [];
        // Every keyframe matches against the same query photo, so build the query
        // descriptor Mat + BFMatcher once and reuse it across keyframes instead of
        // rebuilding the (large) query Mat on every match.
        const queryMatcher = createQueryMatcher(cv, queryOrb);
        try {
          for (const kf of attempt.keyframes) {
            const kfMatches = queryMatcher ? queryMatcher.match(kf.features) : [];
            if (kfMatches.length < 4) {
              perKeyframeStats.push({
                matchCount: kfMatches.length,
                inlierCount: 0,
                inlierRatio: 0,
                homographyFound: false,
                failureReason: "too_few_matches",
              });
              continue;
            }
            const kfStats = emptyHomographyStats();
            const h = computeHomography(cv, kfMatches, kf.features, queryOrb, {
              ransacReprojThreshold: reproj,
              gate,
              stats: kfStats,
            });
            perKeyframeStats.push(kfStats);
            if (!h) continue; // failed RANSAC or validity gate → skip, interpolated
            kfs.push({ timestamp: kf.timestamp, h });
          }
        } finally {
          queryMatcher?.delete();
        }
        if (kfs.length > 0) {
          keyframeHomographies = kfs.sort((a, b) => a.timestamp - b.timestamp);
        }
      }

      // Fixed Capture render homography: computed here, gated, so the Route
      // Overlay never renders through a degenerate/flipped transform (which would
      // project the skeleton off-photo with no error). Skipped when per-keyframe
      // homographies drive the render. The fallback also covers a Panning attempt
      // whose keyframes all failed to match — the render path then uses the
      // frame-0 reference, which must still be gated.
      let homography: Float64Array | undefined;
      let fixedStats: HomographyStats | null = null;
      if (!keyframeHomographies) {
        fixedStats = emptyHomographyStats();
        homography = computeHomography(cv, matches, attempt.orbFeatures, queryOrb, {
          ransacReprojThreshold: reproj,
          gate,
          stats: fixedStats,
        }) ?? undefined;
      }

      // Dev-local Match Diagnostics — assembled even on a failed match so the
      // failure is a labelled data point rather than an opaque null. Gated to
      // development so analyzeFrame/hashFile never run for real users.
      if (process.env.NODE_ENV === "development") {
        try {
          const queryAnalysis = analyzeFrame(cv, imageData);
          const imageHash = await hashFile(file);
          const ref = attempt.referenceFrameMeta;
          const match: MatchResultInput = panningMatch
            ? { mode: "panning", perKeyframe: perKeyframeStats }
            : { mode: "fixed", stats: fixedStats ?? emptyHomographyStats() };
          const diagnostics = buildMatchDiagnostics({
            scanId: attempt.id,
            videoHash: attempt.videoHash ?? "",
            imageHash,
            appVersion: APP_VERSION,
            reference: ref
              ? {
                  width: ref.width,
                  height: ref.height,
                  refKeypointCount: ref.refKeypointCount,
                  wall: ref.wall,
                  flags: ref.flags,
                }
              : null,
            query: {
              width: imageData.width,
              height: imageData.height,
              queryKeypointCount: queryOrb.keypoints.length,
              overall: queryAnalysis.overall,
              flags: toFrameConditions(queryAnalysis).flags,
              downscaleApplied: scale,
            },
            match,
          });
          setMatchDiagnostics(diagnostics);
          shipDiagnostics(diagnostics);
        } catch (diagErr) {
          console.warn("[useImageMatcher] diagnostics assembly failed:", diagErr);
        }
      }

      // A Fixed Capture (or panning fallback) with no valid homography cannot be
      // rendered — surface the user-facing error after diagnostics are recorded.
      // The message is tailored to the failure reason so a viewpoint mismatch
      // (the dominant real-world cause) gets actionable guidance rather than a
      // generic "try a clearer photo".
      if (!keyframeHomographies && !homography) {
        throw new Error(alignmentErrorMessage(fixedStats));
      }

      setResult({
        matches,
        queryKeypoints: queryOrb.keypoints.length,
        referenceKeypoints: attempt.orbFeatures.keypoints.length,
        queryOrb,
        reanchorApplied,
        keyframeHomographies,
        homography,
      });
      setStatus("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[useImageMatcher] Error:", err);
      setStatus("error");
      setErrorMessage(msg);
    }
  }, []);

  const estimateCrop = useCallback(async (file: File, attemptId: string, cv: CV): Promise<RouteCropEstimate | null> => {
    setAutoFrameStatus("estimating");
    try {
      const attempt = getAttempt(attemptId);
      // Panning Capture has no single crop box to project (each keyframe matches
      // the whole photo); fall back to manual cropping there. Likewise when the
      // reference never stored a crop box.
      if (!attempt?.orbFeatures?.cropBox || (attempt.keyframes?.length ?? 0) > 0) {
        setAutoFrameStatus("failed");
        return null;
      }

      // Mirror the full-photo (no userCrop) front-half of matchImage: downscale,
      // symmetric ORB preprocessing, extract, rescale to native, then match.
      const imageData = await loadImageAsImageData(file);
      const maxEdge = queryMaxEdgeFor(attempt.videoMeta.width, attempt.videoMeta.height);
      const { imageData: scaled, scale } = downscaleImageData(cv, imageData, maxEdge);
      const scaledProcessed = preprocessForOrb(cv, scaled);
      let queryOrb = extractFeatures(cv, scaledProcessed, false);
      queryOrb = rescaleFeaturesToNative(queryOrb, scale);
      const matches = matchOrbFeatures(cv, attempt.orbFeatures, queryOrb);

      const reproj = ransacReprojThresholdFor(Math.max(imageData.width, imageData.height));
      const estimate = estimateRouteCrop(
        cv,
        matches,
        attempt.orbFeatures,
        queryOrb,
        imageData.width,
        imageData.height,
        { ransacReprojThreshold: reproj, gate: { srcWidth: attempt.videoMeta.width, srcHeight: attempt.videoMeta.height } },
      );
      setAutoFrameStatus(estimate ? "done" : "failed");
      return estimate;
    } catch (err) {
      console.warn("[useImageMatcher] auto-frame estimate failed:", err);
      setAutoFrameStatus("failed");
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setErrorMessage(null);
    setMatchDiagnostics(null);
    setAutoFrameStatus("idle");
  }, []);

  return { matchImage, estimateCrop, autoFrameStatus, reset, status, result, errorMessage, matchDiagnostics };
}

/**
 * Build the user-facing alignment-failure message from the homography stats.
 *
 * The failure reason separates the two real-world causes a route photo fails to
 * align (confirmed by the dev ORB bench against real footage):
 *  - `gate_rejected` / `degenerate` — matches were found but they do not agree
 *    on a single perspective. Almost always the photo and the video show the
 *    wall from different angles/positions (e.g. a wide scenery shot of the
 *    boulder vs a close climbing clip), so no homography exists.
 *  - `too_few_matches` — too little shared detail to match at all: a
 *    low-resolution or blurry photo, or a photo of a different wall.
 */
function alignmentErrorMessage(stats: HomographyStats | null): string {
  if (stats && (stats.failureReason === "gate_rejected" || stats.failureReason === "degenerate")) {
    return "This photo and the video look like different views of the wall, so the skeleton can't be aligned. Take the route photo from roughly the same angle and distance as the video, framing the same section of wall.";
  }
  return "Couldn't find enough matching detail between the photo and the video to align the skeleton. Use a sharp, high-resolution photo of the same part of the wall the video shows.";
}

/**
 * Apply the ORB preprocessing pipeline (retinex LCN + histogram equalisation,
 * plus a blur-triggered unsharp pass) to an ImageData and return the processed
 * copy, leaving the input untouched. Mirrors the reference-frame / keyframe
 * preprocessing in useVideoProcessor so query descriptors are extracted from
 * the same intensity surface. Returns the input unchanged if a 2D context is
 * unavailable.
 */
function preprocessForOrb(cv: CV, imageData: ImageData): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return imageData;
  ctx.putImageData(imageData, 0, 0);
  const analysis = analyzeFrame(cv, imageData);
  applyOrbPreprocessing(cv, canvas, analysis);
  return ctx.getImageData(0, 0, imageData.width, imageData.height);
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
