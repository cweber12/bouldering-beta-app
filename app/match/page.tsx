"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import LoadingGate from "@/components/shared/LoadingGate";
import CropBoxOverlay, { type CropFraction } from "@/components/shared/CropBoxOverlay";
import S3RoutePicker from "@/components/shared/S3RoutePicker";
import FramePlayer from "@/components/shared/FramePlayer";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { useSkeletonFrames } from "@/hooks/useSkeletonFrames";
import { renderPoseVideo } from "@/pipeline/poseVideoRenderer";
import { getAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";

// ---------------------------------------------------------------------------
// Inner component (needs useSearchParams)
// ---------------------------------------------------------------------------

function MatchPageInner() {
  const urlAttemptId = useSearchParams().get("id") ?? "";

  const { cv } = useOpenCV();
  const { matchImage, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();

  const [attemptId, setAttemptId] = useState<string>(() => urlAttemptId);
  const [attempt, setAttempt] = useState<RouteAttempt | null>(() =>
    urlAttemptId ? (getAttempt(urlAttemptId) ?? null) : null,
  );

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const imagePreviewUrlRef = useRef<string | null>(null);

  // Crop box for ORB detection on the route photo.
  const [imageCrop, setImageCrop] = useState<CropFraction>({ x: 0, y: 0, w: 1, h: 1 });
  // Track whether the user has confirmed the crop and triggered matching.
  const [matchTriggered, setMatchTriggered] = useState(false);

  // Skeleton overlay style — adjustable in real time; FramePlayer reads latest.
  const [skeletonStyle, setSkeletonStyle] = useState<SkeletonStyle>({
    limbColor: "rgba(0,220,120,0.85)",
    jointColor: "rgba(255,220,0,0.92)",
    lineWidth: 2.5,
    pointRadius: 5,
  });

  // Pre-compute skeleton frames (instant — pure math, no video encoding).
  const { data: skeletonData, status: frameStatus, errorMessage: frameError } =
    useSkeletonFrames(cv, attemptId || null, matchResult);

  // On-demand video export state (renders WebM in background when user downloads).
  const [exportStatus, setExportStatus] = useState<"idle" | "rendering" | "done">("idle");
  const [exportProgress, setExportProgress] = useState(0);
  const [styleOpen, setStyleOpen] = useState(false);
  const styleRef = useRef(skeletonStyle);
  useEffect(() => { styleRef.current = skeletonStyle; }, [skeletonStyle]);

  // Sync URL param changes via derived state in handlers rather than an effect.
  // The initial values are already set in useState() initialisers above.

  useEffect(() => {
    return () => {
      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    };
  }, []);

  // ---- Attempt loading ----

  function handleLoadAttempt(loaded: RouteAttempt) {
    setAttemptId(loaded.id);
    setAttempt(loaded);
  }

  // ---- Image matching ----

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    const url = URL.createObjectURL(file);
    imagePreviewUrlRef.current = url;
    setImagePreviewUrl(url);
    setImageFile(file);
    setImageCrop({ x: 0, y: 0, w: 1, h: 1 });
    setMatchTriggered(false);
  }

  function handleApplyAndMatch() {
    if (!imageFile || !cv || !attemptId) return;
    setMatchTriggered(true);
    matchImage(imageFile, attemptId, cv, imageCrop);
  }

  const isMatching = matchStatus === "matching";
  const isMatchDone = matchStatus === "done";
  const isFrameReady = frameStatus === "ready" && !!skeletonData;
  const hasAttempt = !!attempt;

  async function handleExportVideo() {
    if (!cv || !imageFile || !attemptId || !matchResult) return;
    const att = getAttempt(attemptId);
    if (!att?.orbFeatures) return;

    setExportStatus("rendering");
    setExportProgress(0);

    try {
      const url = await renderPoseVideo({
        cv,
        imageFile,
        frames: att.frames,
        videoMeta: att.videoMeta,
        orbFeatures: att.orbFeatures,
        queryOrb: matchResult.queryOrb,
        matches: matchResult.matches,
        skeletonStyle: styleRef.current,
        targetFps: 60,
        onProgress: (r, t) => setExportProgress(Math.round((r / t) * 100)),
      });

      const a = document.createElement("a");
      a.href = url;
      a.download = `${attemptId}-pose-overlay.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus("done");
    } catch (err) {
      console.error("[MatchPage] Video export failed:", err);
      setExportStatus("idle");
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10 flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Route Matching</h1>
          <p className="text-sm text-zinc-400">
            Upload a photo of the route and we&apos;ll overlay your recorded skeleton onto it using
            the ORB reference features extracted on the Upload page.
          </p>
        </div>
        <Link href="/upload" className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300 transition">
          ← Back to upload
        </Link>
      </div>


      {/* Climb data section */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4 flex flex-col gap-4">
        <p className="text-sm font-medium text-zinc-300">Climb data</p>

        {hasAttempt && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3">
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 text-xs font-mono text-zinc-300">
                  {attempt.id}
                  <span className={[
                    "rounded px-1.5 py-0.5 text-xs font-medium font-sans capitalize",
                    attempt.runType === "send"
                      ? "bg-emerald-900/40 text-emerald-400"
                      : "bg-amber-900/40 text-amber-400",
                  ].join(" ")}>
                    {attempt.runType ?? "attempt"}
                  </span>
                  {attempt.rating && (
                    <span className="rounded px-1.5 py-0.5 text-xs font-medium font-sans bg-zinc-800 text-zinc-300">
                      {attempt.rating}
                    </span>
                  )}
                </span>
                <span className="text-xs text-zinc-500">
                  {attempt.frames.length} pose frames &middot;{" "}
                  {attempt.orbFeatures?.keypoints.length ?? 0} ORB keypoints
                  {attempt.videoMeta?.duration != null && (
                    <> &middot; {Math.floor(attempt.videoMeta.duration / 60)}m {Math.floor(attempt.videoMeta.duration % 60)}s</>
                  )}
                  {attempt.state && ` \u00b7 ${attempt.state}`}
                  {attempt.area && ` \u203a ${attempt.area}`}
                  {attempt.route && ` \u203a ${attempt.route}`}
                </span>
              </div>
              <span className="text-xs font-medium text-emerald-400">Loaded</span>
            </div>
            {attempt.notes && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-2.5">
                <p className="text-xs text-zinc-500">{attempt.notes}</p>
              </div>
            )}
          </div>
        )}

        <S3RoutePicker
          onLoad={handleLoadAttempt}
          alwaysOpen
        />
      </div>

      {/* Skeleton style controls — collapsible */}
      {hasAttempt && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4 flex flex-col gap-3">
          <button
            onClick={() => setStyleOpen(o => !o)}
            className="flex items-center justify-between w-full text-left"
            aria-expanded={styleOpen}
          >
            <span className="text-sm font-medium text-zinc-300">Skeleton style</span>
            <svg
              className={["h-4 w-4 text-zinc-500 transition-transform duration-200", styleOpen ? "rotate-180" : ""].join(" ")}
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          {styleOpen && (
            <div className="flex flex-col gap-4 pt-1">
              <p className="text-xs text-zinc-500 -mt-1">
                Adjust colours and sizes — changes apply to the player in real time.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400">Limb color</label>
                  <input
                    type="color"
                    value={skeletonStyle.limbColor?.replace(/rgba?\([^)]+\)/, "#00dc78") ?? "#00dc78"}
                    onChange={e => setSkeletonStyle(s => ({ ...s, limbColor: e.target.value }))}
                    className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-zinc-950 p-0.5"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400">Joint color</label>
                  <input
                    type="color"
                    value={skeletonStyle.jointColor?.replace(/rgba?\([^)]+\)/, "#ffdc00") ?? "#ffdc00"}
                    onChange={e => setSkeletonStyle(s => ({ ...s, jointColor: e.target.value }))}
                    className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-zinc-950 p-0.5"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="flex justify-between text-xs text-zinc-400">
                    <span>Line width</span>
                    <span className="font-mono text-zinc-300">{skeletonStyle.lineWidth ?? 2.5}px</span>
                  </label>
                  <input
                    type="range" min={0.5} max={8} step={0.5}
                    value={skeletonStyle.lineWidth ?? 2.5}
                    onChange={e => setSkeletonStyle(s => ({ ...s, lineWidth: Number(e.target.value) }))}
                    className="accent-zinc-200"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="flex justify-between text-xs text-zinc-400">
                    <span>Point radius</span>
                    <span className="font-mono text-zinc-300">{skeletonStyle.pointRadius ?? 5}px</span>
                  </label>
                  <input
                    type="range" min={1} max={12} step={1}
                    value={skeletonStyle.pointRadius ?? 5}
                    onChange={e => setSkeletonStyle(s => ({ ...s, pointRadius: Number(e.target.value) }))}
                    className="accent-zinc-200"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Route image upload */}
      <div className="flex flex-col gap-4">
        <label
          className={[
            "flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-8 py-6 text-sm transition",
            !hasAttempt || isMatching
              ? "cursor-not-allowed border-zinc-800 text-zinc-600"
              : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
            hasAttempt && !imageFile && !isMatching ? "ring-2 ring-zinc-400/50 ring-offset-2 ring-offset-zinc-950 animate-pulse" : "",
          ].join(" ")}
        >
          <svg className="h-6 w-6 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
          </svg>
          <span>{isMatching ? "Loading..." : "Select a route photo"}</span>
          <span className="text-xs text-zinc-600">JPG, PNG, WebP accepted</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={!hasAttempt || isMatching}
            onChange={handleImageChange}
          />
        </label>

        {/* Crop UI — shown after image selected, before match is triggered */}
        {imagePreviewUrl && imageFile && !matchTriggered && !isMatching && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-zinc-400">
              Adjust the crop region to focus ORB matching on the relevant wall area, then click
              &ldquo;Apply &amp; Match&rdquo;.
            </p>
            <div className="relative w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrl}
                alt="Route photo preview"
                className="max-h-80 w-full rounded-xl border border-zinc-700 bg-zinc-900 object-contain"
              />
              <CropBoxOverlay
                box={imageCrop}
                onChange={setImageCrop}
                disabled={!hasAttempt}
              />
            </div>
            <button
              onClick={handleApplyAndMatch}
              disabled={!hasAttempt}
              className="flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 ring-2 ring-zinc-400/50 ring-offset-2 ring-offset-zinc-950 animate-pulse"
            >
              Apply &amp; View
            </button>
          </div>
        )}

        {/* Static preview after match triggered */}
        {imagePreviewUrl && (matchTriggered || isMatching || isMatchDone) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imagePreviewUrl}
            alt="Route photo preview"
            className="max-h-80 w-full rounded-xl border border-zinc-700 bg-zinc-900 object-contain"
          />
        )}
      </div>

      {/* Match stats */}
      {isMatchDone && matchResult && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4 flex flex-col gap-1">
          <p className="text-sm font-medium text-zinc-300">View statistics</p>
          <div className="mt-2 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xl font-bold text-zinc-100">{matchResult.matches.length}</p>
              <p className="text-xs text-zinc-500">good matches</p>
            </div>
            <div>
              <p className="text-xl font-bold text-zinc-100">{matchResult.queryKeypoints}</p>
              <p className="text-xs text-zinc-500">query keypoints</p>
            </div>
            <div>
              <p className="text-xl font-bold text-zinc-100">{matchResult.referenceKeypoints}</p>
              <p className="text-xs text-zinc-500">reference keypoints</p>
            </div>
          </div>
          {matchResult.matches.length < 10 && (
            <p className="mt-3 text-xs text-amber-400">
              Fewer than 10 matches the homography may be unstable. Try a closer or better-lit photo of the same wall section.
            </p>
          )}
        </div>
      )}

      {/* Pose overlay — instant frame-by-frame player (no video encoding) */}
      {isFrameReady && imageFile && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-zinc-300">Pose overlay</p>
          <FramePlayer
            imageFile={imageFile}
            layers={[{ frames: skeletonData.frames, style: skeletonStyle }]}
            duration={skeletonData.duration}
          />

          {/* Video export / download */}
          {exportStatus === "rendering" ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Encoding video for download&#8230;</span>
                <span>{exportProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-zinc-200 transition-all duration-150"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={handleExportVideo}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {exportStatus === "done" ? "Download again (.webm)" : "Download pose overlay video (.webm)"}
            </button>
          )}
        </div>
      )}

      {(matchStatus === "error" || frameStatus === "error") && (
        <p className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {matchError ?? frameError}
        </p>
      )}
    </div>
  );
}

export default function MatchPage() {
  return (
    <LoadingGate requiresTF={false}>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            Loading...
          </div>
        }
      >
        <MatchPageInner />
      </Suspense>
    </LoadingGate>
  );
}
