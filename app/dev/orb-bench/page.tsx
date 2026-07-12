"use client";

/**
 * Dev-only ORB A/B bench.
 *
 * Isolates the single variable that fix #1 changes — how the **query photo** is
 * preprocessed before ORB extraction — and reports match quality both ways
 * against a supplied reference image:
 *
 *   A  legacy   query extracted with a global equalizeHist only
 *               (extractFeatures normalizePixels=true, no retinex LCN).
 *   B  symmetric query extracted from an applyOrbPreprocessing surface
 *               (retinex LCN + equalise), matching the reference / keyframes.
 *
 * The reference image is always preprocessed with applyOrbPreprocessing so it
 * mirrors the scan path. Drop in your own reference frame + route photo pairs;
 * the numbers (match count, RANSAC inliers, inlier ratio, homography found) are
 * the differential feedback loop for the asymmetric-preprocessing diagnosis.
 *
 * Rendered only in development — returns a notice in production builds.
 */

import { useCallback, useState } from "react";
import { useOpenCV } from "@/hooks/useOpenCV";
import {
  extractFeatures,
  matchOrbFeatures,
  downscaleImageData,
  rescaleFeaturesToNative,
  queryMaxEdgeFor,
  type OrbFeatures,
} from "@/pipeline/matching/orbDetector";
import { computeHomography, ransacReprojThresholdFor } from "@/pipeline/matching/homography";
import { emptyHomographyStats, type HomographyStats } from "@/pipeline/analysis/diagnostics";
import { analyzeFrame } from "@/pipeline/analysis/frameAnalyzer";
import { applyOrbPreprocessing } from "@/pipeline/analysis/framePreprocessor";
import { capToPixelBudget } from "@/utils/imageHelpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

const IS_DEV = process.env.NODE_ENV === "development";

interface Variant {
  label: string;
  queryKeypoints: number;
  matchCount: number;
  inlierCount: number;
  inlierRatio: number;
  homographyFound: boolean;
  failureReason: string;
  extractMs: number;
  matchMs: number;
}

interface BenchResult {
  refWidth: number;
  refHeight: number;
  refKeypoints: number;
  queryWidth: number;
  queryHeight: number;
  queryScaled: number;
  variants: Variant[];
}

/** Load an image File into an ImageData (decode-pixel-capped). */
function loadImageData(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const { width, height } = capToPixelBudget(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("no 2D context"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image load failed"));
    };
    img.src = url;
  });
}

/**
 * Decode an early frame of a video File into an ImageData, mirroring the
 * reference frame useVideoProcessor extracts ORB from. Seeks to a small offset
 * (not literally t=0) to dodge any black fade-in and guarantee a `seeked` event.
 * Decode-pixel-capped.
 */
function loadVideoFrame0(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    let done = false;
    const cleanup = () => URL.revokeObjectURL(url);

    const grab = () => {
      if (done) return;
      done = true;
      const { width, height } = capToPixelBudget(video.videoWidth, video.videoHeight);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        reject(new Error("no 2D context"));
        return;
      }
      ctx.drawImage(video, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height);
      cleanup();
      resolve(data);
    };

    video.onseeked = grab;
    video.onloadeddata = () => {
      const dur = Number.isFinite(video.duration) ? video.duration : 1;
      video.currentTime = Math.min(0.1, dur / 2);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("video load failed"));
    };
    video.src = url;
  });
}

/** Load a reference File — decodes frame 0 for video, else the image itself. */
function loadReference(file: File): Promise<ImageData> {
  return file.type.startsWith("video") ? loadVideoFrame0(file) : loadImageData(file);
}

/** Apply applyOrbPreprocessing to an ImageData and return the processed copy. */
function preprocessForOrb(cv: CV, imageData: ImageData): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return imageData;
  ctx.putImageData(imageData, 0, 0);
  applyOrbPreprocessing(cv, canvas, analyzeFrame(cv, imageData));
  return ctx.getImageData(0, 0, imageData.width, imageData.height);
}

/** Run one query-extraction variant and measure it against the reference. */
function runVariant(
  cv: CV,
  label: string,
  refOrb: OrbFeatures,
  queryNative: ImageData,
  scaledQuery: ImageData,
  scale: number,
  symmetric: boolean,
  gate: { srcWidth: number; srcHeight: number },
): Variant {
  const reproj = ransacReprojThresholdFor(Math.max(queryNative.width, queryNative.height));

  const t0 = performance.now();
  const source = symmetric ? preprocessForOrb(cv, scaledQuery) : scaledQuery;
  let queryOrb = extractFeatures(cv, source, !symmetric);
  queryOrb = rescaleFeaturesToNative(queryOrb, scale);
  const t1 = performance.now();

  const matches = matchOrbFeatures(cv, refOrb, queryOrb);
  const t2 = performance.now();

  const stats: HomographyStats = emptyHomographyStats();
  computeHomography(cv, matches, refOrb, queryOrb, {
    ransacReprojThreshold: reproj,
    gate,
    stats,
  });

  return {
    label,
    queryKeypoints: queryOrb.keypoints.length,
    matchCount: stats.matchCount,
    inlierCount: stats.inlierCount,
    inlierRatio: stats.inlierRatio,
    homographyFound: stats.homographyFound,
    failureReason: stats.failureReason,
    extractMs: t1 - t0,
    matchMs: t2 - t1,
  };
}

export default function OrbBenchPage() {
  const { ready, cv } = useOpenCV();
  const [refFile, setRefFile] = useState<File | null>(null);
  const [queryFile, setQueryFile] = useState<File | null>(null);
  const [result, setResult] = useState<BenchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    if (!cv || !refFile || !queryFile) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const refData = await loadReference(refFile);
      const queryData = await loadImageData(queryFile);

      // Reference: preprocessed like the scan path, extracted normalizePixels=false.
      const refOrb = extractFeatures(cv, preprocessForOrb(cv, refData), false);

      const maxEdge = queryMaxEdgeFor(refData.width, refData.height);
      const { imageData: scaledQuery, scale } = downscaleImageData(cv, queryData, maxEdge);
      const gate = { srcWidth: refData.width, srcHeight: refData.height };

      const variants = [
        runVariant(
          cv,
          "A · legacy (equalize only)",
          refOrb,
          queryData,
          scaledQuery,
          scale,
          false,
          gate,
        ),
        runVariant(
          cv,
          "B · symmetric (retinex)",
          refOrb,
          queryData,
          scaledQuery,
          scale,
          true,
          gate,
        ),
      ];

      setResult({
        refWidth: refData.width,
        refHeight: refData.height,
        refKeypoints: refOrb.keypoints.length,
        queryWidth: queryData.width,
        queryHeight: queryData.height,
        queryScaled: scale,
        variants,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [cv, refFile, queryFile]);

  if (!IS_DEV) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-fg-muted">The ORB bench is only available in development.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-fg">ORB A/B bench</h1>
        <p className="text-sm text-fg-muted">
          Compares legacy vs symmetric query preprocessing against a reference image. Use a video
          reference frame (or wall crop) and a route photo of the same wall.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FilePicker
          label="Reference (video or frame)"
          accept="video/*,image/*"
          file={refFile}
          onPick={setRefFile}
        />
        <FilePicker
          label="Route photo (query)"
          accept="image/*"
          file={queryFile}
          onPick={setQueryFile}
        />
      </div>

      <button
        type="button"
        onClick={run}
        disabled={!ready || !refFile || !queryFile || running}
        className="self-start rounded-md bg-send px-4 py-2 text-sm font-medium text-fg-inverse disabled:opacity-50"
      >
        {!ready ? "Loading OpenCV…" : running ? "Running…" : "Run match"}
      </button>

      {error && (
        <p className="rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {result && (
        <section className="flex flex-col gap-3">
          <div className="text-xs text-fg-muted">
            ref {result.refWidth}×{result.refHeight} · {result.refKeypoints} kp · query{" "}
            {result.queryWidth}×{result.queryHeight} (scale {result.queryScaled.toFixed(3)})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-edge/40 text-left text-fg-muted">
                  <th className="py-2 pr-3 font-medium">variant</th>
                  <th className="py-2 pr-3 font-medium tabular-nums">query kp</th>
                  <th className="py-2 pr-3 font-medium tabular-nums">matches</th>
                  <th className="py-2 pr-3 font-medium tabular-nums">inliers</th>
                  <th className="py-2 pr-3 font-medium tabular-nums">ratio</th>
                  <th className="py-2 pr-3 font-medium">H?</th>
                  <th className="py-2 pr-3 font-medium tabular-nums">extract</th>
                  <th className="py-2 font-medium tabular-nums">match</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {result.variants.map((v) => (
                  <tr key={v.label} className="border-b border-edge/20">
                    <td className="py-2 pr-3 font-sans">{v.label}</td>
                    <td className="py-2 pr-3 tabular-nums">{v.queryKeypoints}</td>
                    <td className="py-2 pr-3 tabular-nums">{v.matchCount}</td>
                    <td className="py-2 pr-3 tabular-nums">{v.inlierCount}</td>
                    <td className="py-2 pr-3 tabular-nums">{(v.inlierRatio * 100).toFixed(0)}%</td>
                    <td className={`py-2 pr-3 ${v.homographyFound ? "text-send" : "text-danger"}`}>
                      {v.homographyFound ? "ok" : v.failureReason}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{v.extractMs.toFixed(0)}ms</td>
                    <td className="py-2 tabular-nums">{v.matchMs.toFixed(0)}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-fg-muted">
            Higher matches / inliers / ratio on row B vs row A is the fix-#1 signal. RANSAC is
            non-deterministic, so re-run a few times and watch the trend.
          </p>
        </section>
      )}
    </main>
  );
}

function FilePicker({
  label,
  accept,
  file,
  onPick,
}: {
  label: string;
  accept: string;
  file: File | null;
  onPick: (f: File | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-fg-muted">{label}</span>
      <input
        type="file"
        accept={accept}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        className="block w-full text-xs text-fg file:mr-3 file:rounded-md file:border-0 file:bg-surface-alt file:px-3 file:py-1.5 file:text-fg"
      />
      {file && <span className="truncate text-xs text-fg-muted">{file.name}</span>}
    </label>
  );
}
