"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import LoadingGate from "@/components/shared/LoadingGate";

import CropBoxOverlay, { type CropFraction, DEFAULT_CROP } from "@/components/shared/CropBoxOverlay";
import ComboInput from "@/components/shared/ComboInput";
import { useOpenCV } from "@/hooks/useOpenCV";
import { usePoseModel, type MediaPipeVariant } from "@/hooks/usePoseModel";
import { useVideoProcessor } from "@/hooks/useVideoProcessor";
import { useS3Storage } from "@/hooks/useS3Storage";
import { getAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { RunType } from "@/storage/sessionStore";
import { sanitizeDirName, serializeAttemptForJson } from "@/utils/fsHelpers";
import CameraRecorderModal from "@/components/shared/CameraRecorderModal";

// ---------------------------------------------------------------------------
// RouteData folder name
// ---------------------------------------------------------------------------
const BETA_FOLDER = "RouteData";
const SESSION_KEY = "bouldering_last_attempt_id";

let cachedRootHandle: FileSystemDirectoryHandle | null = null;

async function acquireRootHandle(): Promise<FileSystemDirectoryHandle> {
  if (cachedRootHandle) {
    try {
      const perm = await (
        cachedRootHandle as unknown as {
          queryPermission: (desc: object) => Promise<string>;
        }
      ).queryPermission({ mode: "readwrite" });
      if (perm === "granted") return cachedRootHandle;
    } catch { /* fall through */ }
  }
  const handle = await (
    window as unknown as { showDirectoryPicker: (opts?: object) => Promise<FileSystemDirectoryHandle> }
  ).showDirectoryPicker({ mode: "readwrite" });
  cachedRootHandle = handle;
  return handle;
}

async function saveAttemptToDevice(
  attempt: RouteAttempt,
): Promise<FileSystemDirectoryHandle | null> {
  const serializable = serializeAttemptForJson(attempt);
  const json = JSON.stringify(serializable, null, 2);

  if ("showDirectoryPicker" in window) {
    const root     = await acquireRootHandle();
    const betaDir  = await root.getDirectoryHandle(BETA_FOLDER, { create: true });
    const stateDir = await betaDir.getDirectoryHandle(sanitizeDirName(attempt.state || "Unknown State"), { create: true });
    const areaDir  = await stateDir.getDirectoryHandle(sanitizeDirName(attempt.area  || "Unknown Area"),  { create: true });
    const routeDir = await areaDir.getDirectoryHandle(sanitizeDirName(attempt.route  || "Unknown Route"), { create: true });
    const fh       = await routeDir.getFileHandle(`${attempt.id}-${attempt.runType ?? "attempt"}.json`, { create: true });
    const writable  = await fh.createWritable();
    await writable.write(json);
    await writable.close();
    return routeDir;
  } else {
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${attempt.id}-${attempt.runType ?? "attempt"}.json`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Frame adjustment condition options
// ---------------------------------------------------------------------------

interface FrameCondition {
  id: string;
  label: string;
  description: string;
}

const FRAME_CONDITIONS: FrameCondition[] = [
  { id: "washed_out",  label: "Washed out",        description: "Bright sun or strong artificial light overexposes the frame." },
  { id: "backlit",     label: "Backlit",             description: "Light source is behind the climber, darkening the subject." },
  { id: "shadows",     label: "Deep shadows",        description: "Sections of the wall are heavily shadowed." },
  { id: "blends",      label: "Low contrast",        description: "Climber's clothing or skin blends with the wall colour." },
  { id: "indoor_gym",  label: "Gym lighting",        description: "Indoor gym with uneven or fluorescent overhead lighting." },
  { id: "dusty",       label: "Dusty / hazy lens",   description: "Lens fog, chalk dust, or condensation reduces sharpness." },
];

// ---------------------------------------------------------------------------
// Upload page inner
// ---------------------------------------------------------------------------

function UploadPageInner() {
  const { cv } = useOpenCV();

  // Model selection state — MediaPipe only
  const [modelVariant, setModelVariant] = useState<MediaPipeVariant>("lite");
  const { model } = usePoseModel({ backend: "mediapipe", variant: modelVariant });
  const { process, reset: resetProcessor, status, orbStatus, currentFrame, totalFrames, attemptId, errorMessage } =
    useVideoProcessor(100);
  const { uploadAttempt, listPrefixes, userPrefix, status: s3Status } = useS3Storage();

  // Restore prior attempt from session so users can return from the match page.
  const [restoredAttempt] = useState<RouteAttempt | null>(() => {
    if (typeof window === "undefined") return null;
    const id = window.sessionStorage.getItem(SESSION_KEY);
    return id ? (getAttempt(id) ?? null) : null;
  });

  const [state, setState] = useState(() => restoredAttempt?.state ?? "");
  const [area,  setArea]  = useState(() => restoredAttempt?.area  ?? "");
  const [route, setRoute] = useState(() => restoredAttempt?.route ?? "");
  const [runType, setRunType] = useState<RunType>(() => restoredAttempt?.runType ?? "attempt");
  const [rating, setRating] = useState(() => restoredAttempt?.rating ?? "");
  const [notes, setNotes] = useState(() => restoredAttempt?.notes ?? "");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [frameStep, setFrameStep] = useState(5);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [s3Saved, setS3Saved] = useState(false);
  const [locationWarning, setLocationWarning] = useState(false);
  const [savedRouteDirHandle, setSavedRouteDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [conditions, setConditions] = useState<Set<string>>(new Set());
  const [newFileSelected, setNewFileSelected] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const previewUrlRef = useRef<string | null>(null);

  const [climberCrop, setClimberCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [orbCrop, setOrbCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [activeCropMode, setActiveCropMode] = useState<"climber" | "route">("climber");
  const [hasCropFrame, setHasCropFrame] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const cropVideoRef = useRef<HTMLVideoElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);

  // Crop adjustment confirmation dialog
  const [showCropWarning, setShowCropWarning] = useState(false);

  // S3-backed suggestions for location fields
  const [stateSuggestions, setStateSuggestions] = useState<string[]>([]);
  const [areaSuggestions, setAreaSuggestions] = useState<string[]>([]);
  const [routeSuggestions, setRouteSuggestions] = useState<string[]>([]);

  // Fetch state suggestions from S3 on mount
  useEffect(() => {
    if (!userPrefix) return;
    listPrefixes(`${userPrefix}/`).then(setStateSuggestions).catch(() => {});
  }, [listPrefixes, userPrefix]);

  // Refresh area suggestions when state changes.
  function handleStateChange(val: string) {
    setState(val);
    setAreaSuggestions([]);
    setRouteSuggestions([]);
    if (val.trim() && userPrefix) {
      listPrefixes(`${userPrefix}/${sanitizeDirName(val)}/`).then(setAreaSuggestions).catch(() => {});
    }
  }

  // Refresh route suggestions when area changes.
  function handleAreaChange(val: string) {
    setArea(val);
    setRouteSuggestions([]);
    if (state.trim() && val.trim() && userPrefix) {
      listPrefixes(`${userPrefix}/${sanitizeDirName(state)}/${sanitizeDirName(val)}/`).then(setRouteSuggestions).catch(() => {});
    }
  }

  function handleRouteChange(val: string) {
    setRoute(val);
  }

  // Only show the location warning while any required field is still empty.
  const showLocationWarning = locationWarning && (!state.trim() || !area.trim() || !route.trim());

  const progressPct = totalFrames > 0 ? Math.round((currentFrame / totalFrames) * 100) : 0;
  const isProcessing = status === "processing";
  const isDone = status === "done";
  const orbReady = orbStatus === "ready";

  // Persist the attempt id into session so user can return from match page.
  const activeAttemptId = isDone ? attemptId : restoredAttempt?.id ?? null;
  const activeAttempt   = activeAttemptId ? getAttempt(activeAttemptId) : null;
  const showResults     = !newFileSelected && ((isDone && orbReady) || (!isDone && !!restoredAttempt && !isProcessing));

  useEffect(() => {
    if (isDone && attemptId) {
      try { window.sessionStorage.setItem(SESSION_KEY, attemptId); } catch { /* quota */ }
    }
  }, [isDone, attemptId]);

  // Clear session when navigating away so fresh state on return.
  useEffect(() => {
    return () => {
      // Reset video processing state — route info is preserved via
      // sessionStorage but the video / processing state should not persist.
      resetProcessor();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function toggleCondition(id: string) {
    setConditions(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  function loadVideoFile(file: File) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setVideoPreviewUrl(url);
    setPendingFile(file);
    setClimberCrop(DEFAULT_CROP);
    setOrbCrop(DEFAULT_CROP);
    setActiveCropMode("climber");
    setHasCropFrame(false);
    setS3Saved(false);
    setSaveError(null);
    setSavedRouteDirHandle(null);
    setNewFileSelected(true);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    loadVideoFile(file);
  }

  function handleCameraCapture(file: File) {
    loadVideoFile(file);
    setShowCamera(false);
  }

  function handleCropVideoLoaded() {
    const video = cropVideoRef.current;
    const canvas = cropCanvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    setHasCropFrame(true);
    setVideoDuration(video.duration || 0);
  }

  function formatVideoTime(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function handleVideoPlayPause() {
    const video = cropVideoRef.current;
    if (!video) return;
    if (video.paused) { video.play().catch(() => {}); } else { video.pause(); }
  }

  function handleVideoSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const video = cropVideoRef.current;
    if (!video) return;
    video.currentTime = Number(e.target.value);
  }

  function isCropDefault(crop: CropFraction): boolean {
    return (
      Math.abs(crop.x - DEFAULT_CROP.x) < 0.001 &&
      Math.abs(crop.y - DEFAULT_CROP.y) < 0.001 &&
      Math.abs(crop.w - DEFAULT_CROP.w) < 0.001 &&
      Math.abs(crop.h - DEFAULT_CROP.h) < 0.001
    );
  }

  function handleProcess() {
    if (!pendingFile || !model || !cv) return;

    // Warn if either crop hasn't been adjusted.
    if (isCropDefault(climberCrop) || isCropDefault(orbCrop)) {
      setShowCropWarning(true);
      return;
    }

    startProcessing();
  }

  function startProcessing() {
    if (!pendingFile || !model || !cv) return;
    setShowCropWarning(false);
    setNewFileSelected(false);
    process(pendingFile, model, cv, frameStep, { state, area, route, runType, rating: rating || undefined, notes: notes || undefined }, {
      climberCrop,
      orbCrop,
      conditions,
    }, videoCurrentTime > 0 ? videoCurrentTime : 0);
  }

  async function handleSaveToDevice() {
    if (!activeAttemptId) return;
    const attempt = getAttempt(activeAttemptId);
    if (!attempt) return;
    setSaveError(null);
    try {
      const routeDir = await saveAttemptToDevice(attempt);
      setSavedRouteDirHandle(routeDir);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function handleDeleteFromDevice() {
    if (!savedRouteDirHandle || !activeAttemptId) return;
    setSaveError(null);
    try {
      await savedRouteDirHandle.removeEntry(`${activeAttemptId}-${activeAttempt?.runType ?? "attempt"}.json`);
      setSavedRouteDirHandle(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  async function handleSaveToS3() {
    if (!activeAttemptId) return;
    if (!state.trim() || !area.trim() || !route.trim()) {
      setLocationWarning(true);
      return;
    }
    // Guard against excessively long field values (S3 key max = 1024 bytes).
    if (state.trim().length > 100 || area.trim().length > 100 || route.trim().length > 100) {
      setSaveError("State, area, and route names must each be under 100 characters.");
      return;
    }
    const attempt = getAttempt(activeAttemptId);
    if (!attempt) return;
    setSaveError(null);
    try {
      // Use current UI values so location entered after processing is respected.
      const attemptToUpload: RouteAttempt = {
        ...attempt,
        state: state.trim(),
        area: area.trim(),
        route: route.trim(),
        runType,
        rating: rating || undefined,
        notes: notes || undefined,
      };
      await uploadAttempt(attemptToUpload);
      setS3Saved(true);
      setLocationWarning(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "S3 upload failed.");
    }
  }

  const videoAndCropSection = (
    <div className="flex-1 min-w-0 flex flex-col gap-4">
      {/* Video input — upload file or record with camera */}
      <div className="grid grid-cols-2 gap-3">
        {/* Choose existing file */}
        <label
          className={[
            "flex cursor-pointer flex-col items-center gap-3 rounded-2xl border px-4 py-6 text-sm transition-all",
            "bg-primary",
            isProcessing
              ? "cursor-not-allowed border-inset opacity-40 text-fg-secondary"
              : [
                  "border-edge text-fg-secondary",
                  "hover:border-accent/60 hover:bg-inset hover:text-fg",
                  !pendingFile ? "animate-pulse border-accent/30" : "",
                ].join(" "),
          ].join(" ")}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-inset">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <div className="flex flex-col items-center gap-0.5 text-center">
            <span className="font-medium text-fg">Choose a video</span>
            <span className="text-xs text-fg-muted">MP4, MOV, WebM</span>
          </div>
          <input
            type="file"
            accept="video/*"
            className="hidden"
            disabled={isProcessing}
            onChange={handleFileChange}
          />
        </label>

        {/* Record with camera — opens getUserMedia modal (works on all devices) */}
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          disabled={isProcessing}
          className={[
            "flex flex-col items-center gap-3 rounded-2xl border px-4 py-6 text-sm transition-all",
            "bg-primary",
            isProcessing
              ? "cursor-not-allowed border-inset opacity-40 text-fg-secondary"
              : [
                  "cursor-pointer border-edge text-fg-secondary",
                  "hover:border-accent/60 hover:bg-inset hover:text-fg",
                  !pendingFile ? "animate-pulse border-accent/30" : "",
                ].join(" "),
          ].join(" ")}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-inset">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <div className="flex flex-col items-center gap-0.5 text-center">
            <span className="font-medium text-fg">Record a video</span>
            <span className="text-xs text-fg-muted">Opens camera</span>
          </div>
        </button>
      </div>

      {/* Crop UI � shown after file selected, before processing */}
      {videoPreviewUrl && pendingFile && !isProcessing && !isDone && (
        <div className="flex flex-col gap-3">
          {/* Crop mode toggle */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-fg-secondary">
              Set crop regions � drag handles to resize, drag interior to move
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveCropMode("climber")}
                className={[
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                  activeCropMode === "climber"
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
                ].join(" ")}
              >
                Climber crop
              </button>
              <button
                onClick={() => setActiveCropMode("route")}
                className={[
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                  activeCropMode === "route"
                    ? "border-success/60 bg-success/10 text-success"
                    : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
                ].join(" ")}
              >
                Wall texture crop
              </button>
            </div>
            <p className="text-xs text-fg-muted">
              {activeCropMode === "climber"
                ? "Climber crop \u2014 follows the climber through each frame."
                : "Wall texture crop \u2014 used to match this video\u2019s wall to your route photo."}
            </p>
          </div>

          {/* Video with crop overlay on top */}
          <div className="relative w-full overflow-hidden rounded-xl border border-edge bg-surface">
            <video
              ref={cropVideoRef}
              src={videoPreviewUrl}
              muted
              playsInline
              onLoadedData={handleCropVideoLoaded}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={() => setVideoCurrentTime(cropVideoRef.current?.currentTime ?? 0)}
              onDurationChange={() => setVideoDuration(cropVideoRef.current?.duration ?? 0)}
              className="w-full block"
            />
            {hasCropFrame && (
              <CropBoxOverlay
                box={activeCropMode === "climber" ? climberCrop : orbCrop}
                onChange={activeCropMode === "climber" ? setClimberCrop : setOrbCrop}
              />
            )}
            <canvas ref={cropCanvasRef} className="hidden" />
          </div>

          {/* Video controls — below the overlay so they are never covered */}
          {hasCropFrame && (
            <div className="flex items-center gap-3 rounded-xl border border-inset bg-card px-3 py-2">
              <button
                onClick={handleVideoPlayPause}
                className="shrink-0 rounded p-1 text-fg-secondary transition hover:text-fg"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min={0}
                max={videoDuration || 1}
                step={0.01}
                value={videoCurrentTime}
                onChange={handleVideoSeek}
                className="flex-1 accent-accent"
                aria-label="Video progress"
              />
              <span className="shrink-0 font-mono text-xs text-fg-secondary">
                {formatVideoTime(videoCurrentTime)} / {formatVideoTime(videoDuration)}
              </span>
            </div>
          )}

          {/* Frame step slider */}
          <div className="flex flex-col gap-2 rounded-xl border border-inset bg-card px-4 py-3">
            <label className="flex items-center justify-between text-xs">
              <span className="font-medium text-fg-secondary">Pose detection frequency</span>
              <span className="font-mono text-fg">every {frameStep} frames</span>
            </label>
            <input
              type="range"
              min={1} max={30}
              value={frameStep}
              onChange={e => setFrameStep(Number(e.target.value))}
              className="w-full accent-accent"
              aria-label="Frame step"
            />
            <p className="text-xs text-fg-muted">
              1 = every frame (slowest, most accurate) � 30 = every 30th frame (fastest, more interpolation between detections)
            </p>
          </div>

          {/* Process button */}
          <button
            onClick={handleProcess}
            disabled={!model || !cv}
            className="flex items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-3 text-sm font-semibold text-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
            </svg>
            Process video
            {videoCurrentTime > 0 && (
              <span className="text-xs font-normal opacity-75">from {formatVideoTime(videoCurrentTime)}</span>
            )}
          </button>

          {/* Crop adjustment warning dialog */}
          {showCropWarning && (
            <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-5 py-4 flex flex-col gap-3">
              <p className="text-sm font-medium text-amber-300">Crop regions not adjusted</p>
              <p className="text-xs text-amber-400/80">
                {isCropDefault(climberCrop) && isCropDefault(orbCrop)
                  ? "Neither the climber crop nor the background (ORB) crop has been adjusted from the default."
                  : isCropDefault(climberCrop)
                    ? "The climber crop has not been adjusted from the default."
                    : "The background (ORB) crop has not been adjusted from the default."}
                {" "}Adjusting these crops improves pose detection accuracy and feature matching quality.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCropWarning(false)}
                  className="rounded-xl border border-edge px-4 py-2 text-xs font-medium text-fg-secondary transition hover:border-edge-hover hover:text-fg"
                >
                  Go back
                </button>
                <button
                  onClick={startProcessing}
                  className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-xs font-medium text-accent transition hover:bg-accent/20"
                >
                  Proceed anyway
                </button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );

  const sidebarSection = pendingFile && !isProcessing && !showResults ? (
    <aside className="w-full lg:w-72 shrink-0">
      <div className="rounded-2xl border border-edge bg-card divide-y divide-edge">

        {/* ── Pose model ──────────────────────────── */}
        <div className="px-4 py-4 flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold text-fg">Pose detection model</p>
            <p className="text-xs text-fg-muted mt-0.5">MediaPipe Pose Landmarker &mdash; 33 BlazePose keypoints.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-secondary">Variant</label>
            <select
              value={modelVariant}
              onChange={e => setModelVariant(e.target.value as MediaPipeVariant)}
              disabled={isProcessing}
              className="rounded-xl border border-edge bg-inset px-3 py-2 text-sm text-fg outline-none transition focus:border-accent/60 disabled:opacity-50"
            >
              <option value="lite">Lite (fast)</option>
              <option value="full">Full (balanced)</option>
              <option value="heavy">Heavy (accurate)</option>
            </select>
            <p className="text-xs text-fg-muted">
              Lite is fastest; Heavy is most accurate.
            </p>
          </div>
        </div>

        {/* ── Location ─────────────────────────────── */}
        <div className="px-4 py-4 flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold text-fg">Location</p>
            <p className="text-xs text-fg-muted mt-0.5">Used to organise your saved climbs.</p>
          </div>
          <ComboInput
            label="State / Region"
            value={state}
            onChange={handleStateChange}
            suggestions={stateSuggestions}
            placeholder="e.g. Colorado"
            disabled={isProcessing}
          />
          <ComboInput
            label="Area"
            value={area}
            onChange={handleAreaChange}
            suggestions={areaSuggestions}
            placeholder="e.g. Red Rocks"
            disabled={isProcessing}
          />
          <ComboInput
            label="Route"
            value={route}
            onChange={handleRouteChange}
            suggestions={routeSuggestions}
            placeholder="e.g. The Classic"
            disabled={isProcessing}
          />
        </div>

        {/* ── Climb type ───────────────────────────── */}
        <div className="px-4 py-4 flex flex-col gap-3">
          <p className="text-sm font-semibold text-fg">Climb type</p>
          <div className="flex gap-2">
            {(["attempt", "send"] as RunType[]).map(t => (
              <button
                key={t}
                onClick={() => setRunType(t)}
                disabled={isProcessing}
                className={[
                  "flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition capitalize",
                  runType === t
                    ? t === "send"
                      ? "border-success/60 bg-success/10 text-success"
                      : "border-accent/60 bg-accent/10 text-accent"
                    : "border-edge bg-inset text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
                  isProcessing ? "cursor-not-allowed opacity-50" : "",
                ].join(" ")}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="text-xs text-fg-muted">
            {runType === "send" ? "You topped the route successfully." : "You did not complete the route."}
          </p>
        </div>

        {/* ── Details ──────────────────────────────── */}
        <div className="px-4 py-4 flex flex-col gap-3">
          <p className="text-sm font-semibold text-fg">Details <span className="text-fg-muted font-normal">(optional)</span></p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-secondary">Grade / Rating</label>
            <input
              type="text"
              value={rating}
              onChange={e => setRating(e.target.value)}
              placeholder="e.g. V3, 5.10a, 6a+"
              disabled={isProcessing}
              className="rounded-xl border border-edge bg-inset px-3 py-2 text-sm text-fg outline-none transition placeholder:text-fg-placeholder focus:border-accent/60 disabled:opacity-50"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-secondary">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Anything to remember about this run…"
              rows={3}
              disabled={isProcessing}
              className="rounded-xl border border-edge bg-inset px-3 py-2 text-sm text-fg outline-none transition placeholder:text-fg-placeholder focus:border-accent/60 disabled:opacity-50 resize-none"
            />
          </div>
        </div>

        {/* ── Shooting conditions ───────────────────── */}
        {!isDone && !isProcessing && (
          <details className="px-4 py-4 group/details">
            <summary className="flex items-center justify-between cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
              <div>
                <p className="text-sm font-semibold text-fg">Shooting conditions</p>
                <p className="text-xs text-fg-muted mt-0.5">
                  {conditions.size === 0
                    ? "Select any that apply."
                    : `${conditions.size} selected`}
                </p>
              </div>
              <svg
                className="h-4 w-4 text-fg-muted transition-transform group-open/details:rotate-180"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="flex flex-col gap-2 mt-3">
              {FRAME_CONDITIONS.map(c => (
                <label key={c.id} className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={conditions.has(c.id)}
                    onChange={() => toggleCondition(c.id)}
                    className="mt-0.5 h-3.5 w-3.5 accent-accent cursor-pointer"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium text-fg group-hover:text-success transition">{c.label}</span>
                    <span className="text-xs text-fg-muted">{c.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </details>
        )}

      </div>
    </aside>
  ) : null;

  return (
    <div className="flex-1 bg-surface">
      <div className="mx-auto w-full max-w-4xl px-6 py-10 flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-fg">Video Analysis</h1>
          <p className="text-sm text-fg-secondary">
            Upload or record a climbing video to extract skeleton poses and wall reference features.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-xs text-fg-secondary transition hover:text-fg">
          &#8592; Home
        </Link>
      </div>



      {/* Main content � sidebar + video/crop */}
      {/* On large screens: sidebar left, video right. On small: video top, sidebar bottom. */}
      <div className="flex flex-col-reverse gap-6 lg:flex-row lg:items-start">
        {sidebarSection}
        {videoAndCropSection}
      </div>

      {/* Progress bar */}
      {isProcessing && (
        <div className="flex flex-col gap-2">
          <div className="h-2 overflow-hidden rounded-full bg-inset">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-center text-xs text-fg-secondary">
            Analysing frame {currentFrame} of {totalFrames} ({progressPct}%)
            <span className="ml-1.5 text-fg-muted">� pose every {frameStep} frames</span>
          </p>
        </div>
      )}

      {isDone && orbStatus === "extracting" && (
        <p className="text-center text-sm text-fg-secondary">Extracting reference features&#8230;</p>
      )}
      {isDone && orbStatus === "failed" && (
        <p className="text-center text-sm text-amber-400">
          Feature extraction failed � image matching will be unavailable.
        </p>
      )}

      {/* Result actions */}
      {showResults && activeAttemptId && activeAttempt && (
        <div className="flex flex-col gap-3">
          {/* Video preview — shown above action buttons once processing is done */}
          {videoPreviewUrl && (
            <video
              src={videoPreviewUrl}
              controls
              muted
              playsInline
              className="w-full rounded-2xl border border-edge bg-surface"
            />
          )}

          <div className="rounded-2xl border border-success/25 bg-success/5 px-5 py-4">
            <p className="text-sm font-semibold text-success">Analysis complete</p>
            <p className="mt-0.5 text-xs text-success/70">
              {activeAttempt.frames.length} pose frames �{" "}
              {activeAttempt.orbFeatures?.keypoints.length ?? 0} reference points extracted
              {activeAttempt.state && ` � ${activeAttempt.state}`}
              {activeAttempt.area  && ` � ${activeAttempt.area}`}
              {activeAttempt.route && ` � ${activeAttempt.route}`}
            </p>
          </div>

          <Link
            href={`/match?id=${activeAttemptId}`}
            className="flex items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-3.5 text-sm font-semibold text-fg shadow-lg shadow-accent/20 transition hover:bg-accent-hover"
          >
            View on route photo
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>

          <button
            onClick={handleSaveToDevice}
            className="flex items-center justify-center gap-2 rounded-2xl border border-edge bg-card px-6 py-3 text-sm text-fg-secondary transition hover:border-edge-hover hover:text-fg"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Save to device
          </button>

          {savedRouteDirHandle && (
            <button
              onClick={handleDeleteFromDevice}
              className="flex items-center justify-center gap-2 rounded-2xl border border-red-900/50 bg-red-950/20 px-6 py-3 text-sm text-red-400 transition hover:border-red-700 hover:text-red-300"
            >
              Delete from device
            </button>
          )}

          {showLocationWarning && (
            <p className="rounded-xl border border-amber-800/60 bg-amber-950/40 px-4 py-2.5 text-xs text-amber-400">
              Enter State/Region, Area, and Route before uploading.
            </p>
          )}

          <button
            onClick={handleSaveToS3}
            disabled={s3Status === "loading"}
            className={[
              "flex items-center justify-center gap-2 rounded-xl border px-6 py-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
              s3Saved
                ? "border-success/30 bg-success/5 text-success hover:border-success/50"
                : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg",
            ].join(" ")}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
            </svg>
            {s3Status === "loading" ? "Uploading…" : s3Saved ? "Uploaded" : "Upload"}
          </button>

          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
        </div>
      )}

      {status === "error" && (
        <p className="rounded-2xl border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {errorMessage}
        </p>
      )}

      </div>

      {/* Camera recording modal */}
      {showCamera && (
        <CameraRecorderModal
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
}

export default function UploadPage() {
  return (
    <LoadingGate>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-fg-secondary">
            Loading&#8230;
          </div>
        }
      >
        <UploadPageInner />
      </Suspense>
    </LoadingGate>
  );
}
