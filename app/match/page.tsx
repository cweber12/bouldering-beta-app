"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import LoadingGate from "@/components/shared/LoadingGate";
import CropBoxOverlay, { type CropFraction } from "@/components/shared/CropBoxOverlay";
import S3RoutePicker from "@/components/shared/S3RoutePicker";
import FramePlayer from "@/components/shared/FramePlayer";
import CameraRecorderModal from "@/components/shared/CameraRecorderModal";
import SkeletonStylePanel from "@/components/shared/SkeletonStylePanel";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { useS3Storage } from "@/hooks/useS3Storage";
import { useSkeletonFrames } from "@/hooks/useSkeletonFrames";
import { renderPoseVideo } from "@/pipeline/poseVideoRenderer";
import { getAttempt, saveAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";
import { getTopology } from "@/utils/poseConstants";
import { sanitizeDirName } from "@/utils/fsHelpers";

// ---------------------------------------------------------------------------
// Inner component (needs useSearchParams)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resize & JPEG-compress an image File to a data URL (max 1280×960, 82 % quality). */
async function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_W = 1280, MAX_H = 960;
      const scale = Math.min(1, MAX_W / img.naturalWidth, MAX_H / img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.naturalWidth  * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("canvas context unavailable")); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

/** Convert a data URL string to a File object (for auto-populating imageFile from S3 route image). */
async function dataUrlToFile(dataUrl: string, filename = "route-image.jpg"): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type });
}

function MatchPageInner() {
  const params = useSearchParams();
  const urlAttemptId = params.get("id") ?? "";
  const urlClimbKey = params.get("key") ?? "";

  const { cv } = useOpenCV();
  const { userPrefix, downloadAttempt: s3Download } = useS3Storage();
  const { matchImage, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();

  const [attemptId, setAttemptId] = useState<string>(() => urlAttemptId);
  const [attempt, setAttempt] = useState<RouteAttempt | null>(() =>
    urlAttemptId ? (getAttempt(urlAttemptId) ?? null) : null,
  );

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const imagePreviewUrlRef = useRef<string | null>(null);
  // Whether the current imageFile was explicitly chosen by the user (vs auto-loaded from route image).
  const [userPickedImage, setUserPickedImage] = useState(false);
  const routeImageConvertingRef = useRef(false);

  // Crop box for ORB detection on the route photo.
  const [imageCrop, setImageCrop] = useState<CropFraction>({ x: 0, y: 0, w: 1, h: 1 });
  // Track whether the user has confirmed the crop and triggered matching.
  const [matchTriggered, setMatchTriggered] = useState(false);

  // Collapsible climb picker — collapses after a climb is loaded.
  const [pickerCollapsed, setPickerCollapsed] = useState(false);

  // Skeleton overlay style — managed by SkeletonStylePanel, applied in real time.
  const [skeletonStyle, setSkeletonStyle] = useState<SkeletonStyle>({
    lineWidth: 2.5,
    pointRadius: 5,
  });

  // Derive topology-aware style: inject skeleton edges + keypoint names
  // from the attempt's pose backend so FramePlayer renders the right skeleton.
  const topoStyle: SkeletonStyle = useMemo(() => {
    const backend = attempt?.poseBackend ?? "mediapipe";
    const topo = getTopology(backend);
    return { ...skeletonStyle, skeletonEdges: topo.skeletonEdges, keypointNames: topo.keypointNames };
  }, [skeletonStyle, attempt]);

  // Pre-compute skeleton frames (instant — pure math, no video encoding).
  const { data: skeletonData, status: frameStatus, errorMessage: frameError } =
    useSkeletonFrames(cv, attemptId || null, matchResult);

  // On-demand video export state (renders WebM in background when user downloads).
  const [exportStatus, setExportStatus] = useState<"idle" | "rendering" | "done">("idle");
  const [exportProgress, setExportProgress] = useState(0);
  const styleRef = useRef(topoStyle);
  useEffect(() => { styleRef.current = topoStyle; }, [topoStyle]);

  // Revoke objectURL on unmount.
  useEffect(() => {
    return () => {
      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    };
  }, []);

  // Auto-load climb from S3 when navigating with ?key= parameter.
  useEffect(() => {
    if (!urlClimbKey || attempt) return;
    let cancelled = false;
    (async () => {
      try {
        const loaded = await s3Download(urlClimbKey);
        if (cancelled) return;
        saveAttempt(loaded);
        setAttemptId(loaded.id);
        setAttempt(loaded);
      } catch (err) {
        console.error("[MatchPage] Failed to load climb from key:", err);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlClimbKey, s3Download]);

  /** Sets imageFile and synchronously creates (or revokes) the associated object URL. */
  function setImageFileWithPreview(file: File | null) {
    if (imagePreviewUrlRef.current) {
      URL.revokeObjectURL(imagePreviewUrlRef.current);
      imagePreviewUrlRef.current = null;
    }
    setImageFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      imagePreviewUrlRef.current = url;
      setImagePreviewUrl(url);
    }
  }

  // ---- Attempt loading ----

  function handleLoadAttempt(loaded: RouteAttempt) {
    setAttemptId(loaded.id);
    setAttempt(loaded);
    // Reset match state so the user can re-select a climb without reload.
    setMatchTriggered(false);
    setExportStatus("idle");
    setExportProgress(0);
    setPickerCollapsed(true);
  }

  // ---- Image matching ----

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    handleImageFileSet(file);
  }

  function handleCameraCapture(file: File) {
    handleImageFileSet(file);
    setShowCamera(false);
  }

  // Save the selected file and, when a climb is loaded, persist the image to S3 as the route photo.
  function handleImageFileSet(file: File) {
    setImageFileWithPreview(file);
    setUserPickedImage(true);
    setImageCrop({ x: 0, y: 0, w: 1, h: 1 });
    setMatchTriggered(false);
    if (attempt && userPrefix) {
      compressImageToDataUrl(file).then(dataUrl => {
        const key = `${userPrefix}/${sanitizeDirName(attempt.state || "Unknown")}/${sanitizeDirName(attempt.area || "Unknown")}/${sanitizeDirName(attempt.route || "Unknown")}/route-image.json`;
        fetch("/api/s3/put", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, body: JSON.stringify({ dataUrl }) }),
        }).catch(() => { /* fire-and-forget */ });
      }).catch(() => { /* ignore */ });
    }
  }

  // Called by S3RoutePicker when a route image is available in S3.
  // Auto-populates imageFile only when the user hasn't chosen their own photo.
  const handleRouteImageLoaded = useCallback((dataUrl: string | null) => {
    if (!dataUrl || userPickedImage || routeImageConvertingRef.current) return;
    routeImageConvertingRef.current = true;
    dataUrlToFile(dataUrl)
      .then(file => { setImageFileWithPreview(file); })
      .catch(() => { /* ignore */ })
      .finally(() => { routeImageConvertingRef.current = false; });
  }, [userPickedImage]);

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
    <div className="flex-1 bg-surface">
    <div className="mx-auto w-full max-w-3xl px-6 py-10 flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-fg">Route Matching</h1>
          <p className="text-sm text-fg-secondary">
            Upload a photo of the route and we&apos;ll overlay your recorded skeleton onto it using
            the ORB reference features extracted on the Upload page.
          </p>
        </div>
      </div>


      {/* Climb data section — collapsible after a climb is selected */}
      <div className="rounded-lg border border-edge bg-card px-5 py-4 flex flex-col gap-4">
        {pickerCollapsed && hasAttempt ? (
          <>
            {/* Collapsed summary — click to expand */}
            <button
              type="button"
              onClick={() => setPickerCollapsed(false)}
              className="flex items-center justify-between w-full text-left"
            >
              <div className="flex items-center gap-3">
                <p className="text-sm font-medium text-fg-light">
                  {[attempt.area, attempt.route].filter(Boolean).join(" \u203a ")}
                </p>
                {attempt.state && (
                  <span className="text-xs text-fg-muted">{attempt.state}</span>
                )}
                <span className={[
                  "rounded-full px-2 py-0.5 text-xs font-semibold capitalize",
                  attempt.runType === "send"
                    ? "bg-emerald-900/40 text-emerald-400"
                    : "bg-amber-900/40 text-amber-400",
                ].join(" ")}>
                  {attempt.runType ?? "attempt"}
                </span>
                {attempt.rating && (
                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-inset text-fg-light">
                    {attempt.rating}
                  </span>
                )}
              </div>
              <svg className="h-4 w-4 text-fg-muted transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </>
        ) : (
          <>
            {/* Expanded — full picker + attempt details */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-fg-light">Climbs</p>
              {hasAttempt && (
                <button
                  type="button"
                  onClick={() => setPickerCollapsed(true)}
                  className="text-xs text-fg-muted hover:text-fg-light transition"
                >
                  <svg className="h-4 w-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}
            </div>

            <S3RoutePicker
              onLoad={handleLoadAttempt}
              onRouteImageLoaded={handleRouteImageLoaded}
              alwaysOpen
            />

            {hasAttempt && (
              <div className="flex flex-col gap-3">
                <div className="rounded-lg border border-edge bg-inset px-4 py-4">
                  {/* Thumbnail image */}
                  {attempt.thumbnail && (
                    <div className="mb-3 overflow-hidden rounded-lg">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={attempt.thumbnail}
                        alt={`${attempt.route ?? "Climb"} thumbnail`}
                        className="w-full max-h-48 object-contain rounded-lg"
                      />
                    </div>
                  )}

                  {/* Route path & type header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      {(attempt.state || attempt.area || attempt.route) && (
                        <p className="text-sm font-semibold text-fg">
                          {[attempt.area, attempt.route].filter(Boolean).join(" \u203a ")}
                        </p>
                      )}
                      {attempt.state && (
                        <p className="text-xs text-fg-muted">{attempt.state}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={[
                        "rounded-full px-2.5 py-1 text-xs font-semibold capitalize",
                        attempt.runType === "send"
                          ? "bg-emerald-900/40 text-emerald-400"
                          : "bg-amber-900/40 text-amber-400",
                      ].join(" ")}>
                        {attempt.runType ?? "attempt"}
                      </span>
                      {attempt.rating && (
                        <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-card text-fg-light">
                          {attempt.rating}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-secondary">
                    {attempt.videoMeta?.duration != null && (
                      <span>{Math.floor(attempt.videoMeta.duration / 60)}m {Math.floor(attempt.videoMeta.duration % 60)}s</span>
                    )}
                    <span>{attempt.frames.length} frames</span>
                    <span>{attempt.orbFeatures?.keypoints.length ?? 0} ORB keypoints</span>
                  </div>
                </div>

                {attempt.notes && (
                  <div className="rounded-lg border border-edge bg-inset/50 px-4 py-2.5">
                    <p className="text-xs font-medium text-fg-muted mb-0.5">Notes</p>
                    <p className="text-sm text-fg-light">{attempt.notes}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Skeleton style */}
      {hasAttempt && (
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-fg-light">Skeleton style</span>
          <SkeletonStylePanel onChange={setSkeletonStyle} />
        </div>
      )}

      {/* Route photo section — upload only when no image is loaded */}
      {hasAttempt && !imageFile && (
        <div className="grid grid-cols-2 gap-3">
          {/* Select from file */}
          <label
            className={[
              "flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-4 py-6 text-sm transition",
              isMatching
                ? "cursor-not-allowed border-inset opacity-40 text-fg-secondary"
                : "bg-primary border-edge text-fg-light hover:border-accent/60 hover:text-fg animate-pulse border-accent/30",
            ].join(" ")}
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
            </svg>
            <span className="font-medium text-fg">Select a photo</span>
            <span className="text-xs text-fg-light">JPG, PNG, WebP</span>
            <input type="file" accept="image/*" className="hidden" disabled={isMatching} onChange={handleImageChange} />
          </label>

          {/* Take with camera */}
          <button
            type="button"
            onClick={() => setShowCamera(true)}
            disabled={isMatching}
            className={[
              "flex flex-col items-center gap-2 rounded-xl border px-4 py-6 text-sm transition",
              isMatching
                ? "cursor-not-allowed border-inset opacity-40 text-fg-secondary"
                : "cursor-pointer bg-primary border-edge text-fg-light hover:border-accent/60 hover:text-fg animate-pulse border-accent/30",
            ].join(" ")}
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
            </svg>
            <span className="font-medium text-fg">Take a photo</span>
            <span className="text-xs text-fg-light">Opens camera</span>
          </button>
        </div>
      )}

        {/* Crop UI — shown after image selected, before match is triggered */}
        {imagePreviewUrl && imageFile && !matchTriggered && !isMatching && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-fg-secondary">
                Adjust the crop region then click &ldquo;Apply &amp; View&rdquo;.
              </p>
              <label className="shrink-0 cursor-pointer text-xs text-fg-muted hover:text-fg-light transition">
                Change photo
                <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              </label>
            </div>
            <div className="relative w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrl}
                alt="Route photo preview"
                className="max-h-80 w-full rounded-xl border border-edge bg-card object-contain"
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
              className="flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 ring-2 ring-accent/30 ring-offset-2 ring-offset-surface animate-pulse"
            >
              Apply &amp; View
            </button>
          </div>
        )}

        {/* Static preview after match triggered — hidden once frames are ready or when new image selected */}
        {imagePreviewUrl && matchTriggered && (isMatching || !isFrameReady) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imagePreviewUrl}
            alt="Route photo preview"
            className="max-h-80 w-full rounded-xl border border-edge bg-card object-contain"
          />
        )}

      {/* Match stats */}
      {isMatchDone && matchResult && (
        <div className="rounded-lg border border-edge bg-card px-5 py-4 flex flex-col gap-1">
          <p className="text-sm font-medium text-fg-light">View statistics</p>
          <div className="mt-2 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xl font-bold text-fg">{matchResult.matches.length}</p>
              <p className="text-xs text-fg-muted">good matches</p>
            </div>
            <div>
              <p className="text-xl font-bold text-fg">{matchResult.queryKeypoints}</p>
              <p className="text-xs text-fg-muted">query keypoints</p>
            </div>
            <div>
              <p className="text-xl font-bold text-fg">{matchResult.referenceKeypoints}</p>
              <p className="text-xs text-fg-muted">reference keypoints</p>
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
          <p className="text-sm font-medium text-fg-light">Pose overlay</p>
          <FramePlayer
            imageFile={imageFile}
            layers={[{ frames: skeletonData.frames, style: topoStyle }]}
            duration={skeletonData.duration}
            autoPlay
          />

          {/* Video export / download */}
          {exportStatus === "rendering" ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-fg-secondary">
                <span>Encoding video for download&#8230;</span>
                <span>{exportProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-inset">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-150"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={handleExportVideo}
              className="flex items-center justify-center gap-2 rounded-xl border border-edge bg-card px-6 py-3 text-sm text-fg-light transition hover:border-edge-hover hover:text-fg"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {exportStatus === "done" ? "Download again (.webm)" : "Download pose overlay video (.webm)"}
            </button>
          )}

          {/* Change route photo */}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-edge bg-card px-6 py-3 text-sm text-fg-secondary transition hover:border-edge-hover hover:text-fg">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
            </svg>
            Change route photo
            <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
          </label>
        </div>
      )}

      {(matchStatus === "error" || frameStatus === "error") && (
        <p className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {matchError ?? frameError}
        </p>
      )}

      {showCamera && (
        <CameraRecorderModal
          mode="photo"
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
    </div>
  );
}

export default function MatchPage() {
  return (
    <LoadingGate>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
            Loading...
          </div>
        }
      >
        <MatchPageInner />
      </Suspense>
    </LoadingGate>
  );
}
