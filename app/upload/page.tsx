"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import LoadingGate from "@/components/shared/LoadingGate";
import InfoDropdown from "@/components/shared/InfoDropdown";
import CropBoxOverlay, { type CropFraction, DEFAULT_CROP } from "@/components/shared/CropBoxOverlay";
import ComboInput from "@/components/shared/ComboInput";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useTFModel } from "@/hooks/useTFModel";
import { useVideoProcessor } from "@/hooks/useVideoProcessor";
import { useS3Storage } from "@/hooks/useS3Storage";
import { getAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { RunType } from "@/storage/sessionStore";
import { sanitizeDirName, serializeAttemptForJson } from "@/utils/fsHelpers";

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
  const { model } = useTFModel();
  const { process, status, orbStatus, currentFrame, totalFrames, attemptId, errorMessage } =
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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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
    });
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
      {/* Video upload */}
      <label
        className={[
          "flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-8 py-6 text-sm transition",
          isProcessing
            ? "cursor-not-allowed border-zinc-800 text-zinc-600"
            : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
        ].join(" ")}
      >
        <svg className="h-6 w-6 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <span>{isProcessing ? "Processing\u2026" : "Select a climbing video"}</span>
        <span className="text-xs text-zinc-600">MP4, MOV, WebM accepted</span>
        <input
          type="file"
          accept="video/*"
          className="hidden"
          disabled={isProcessing}
          onChange={handleFileChange}
        />
      </label>

      {/* Crop UI � shown after file selected, before processing */}
      {videoPreviewUrl && pendingFile && !isProcessing && !isDone && (
        <div className="flex flex-col gap-3">
          {/* Crop mode toggle */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-zinc-400">
              Set crop regions � drag handles to resize, drag interior to move
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveCropMode("climber")}
                className={[
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                  activeCropMode === "climber"
                    ? "border-sky-500 bg-sky-950 text-sky-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300",
                ].join(" ")}
              >
                Climber crop
              </button>
              <button
                onClick={() => setActiveCropMode("route")}
                className={[
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                  activeCropMode === "route"
                    ? "border-amber-500 bg-amber-950 text-amber-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300",
                ].join(" ")}
              >
                Background (ORB) crop
              </button>
            </div>
            <p className="text-xs text-zinc-600">
              {activeCropMode === "climber"
                ? "Climber crop � box is re-centred on the detected hip every pose frame."
                : "Background crop � used to extract wall texture features from the first frame."}
            </p>
          </div>

          {/* Video with crop overlay on top */}
          <div className="relative w-full rounded-xl overflow-hidden border border-zinc-700 bg-zinc-900">
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
            <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
              <button
                onClick={handleVideoPlayPause}
                className="shrink-0 rounded p-1 text-zinc-400 transition hover:text-zinc-100"
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
                className="flex-1 accent-zinc-400"
                aria-label="Video progress"
              />
              <span className="shrink-0 font-mono text-xs text-zinc-500">
                {formatVideoTime(videoCurrentTime)} / {formatVideoTime(videoDuration)}
              </span>
            </div>
          )}

          {/* Frame step slider */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 flex flex-col gap-2">
            <label className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 font-medium">Pose detection frequency</span>
              <span className="font-mono text-zinc-200">every {frameStep} frames</span>
            </label>
            <input
              type="range"
              min={1} max={30}
              value={frameStep}
              onChange={e => setFrameStep(Number(e.target.value))}
              className="w-full accent-zinc-200"
              aria-label="Frame step"
            />
            <p className="text-xs text-zinc-600">
              1 = every frame (slowest, most accurate) � 30 = every 30th frame (fastest, more interpolation between detections)
            </p>
          </div>

          {/* Process button */}
          <button
            onClick={handleProcess}
            disabled={!model || !cv}
            className="flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
            </svg>
            Process video
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
                  className="rounded-lg border border-zinc-600 px-4 py-2 text-xs font-medium text-zinc-300 transition hover:border-zinc-400 hover:text-zinc-100"
                >
                  Go back
                </button>
                <button
                  onClick={startProcessing}
                  className="rounded-lg border border-amber-700 bg-amber-900/30 px-4 py-2 text-xs font-medium text-amber-300 transition hover:bg-amber-900/50"
                >
                  Proceed anyway
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Video preview while processing or after done */}
      {videoPreviewUrl && (isProcessing || isDone) && (
        <video
          src={videoPreviewUrl}
          controls
          muted
          playsInline
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900"
        />
      )}
    </div>
  );

  const sidebarSection = pendingFile && !isProcessing && !showResults ? (
    <aside className="w-full lg:w-72 shrink-0 flex flex-col gap-4">
      {/* Location metadata */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-4 flex flex-col gap-4">
        <p className="text-sm font-medium text-zinc-300">Location</p>
        <p className="text-xs text-zinc-500 -mt-2">
          Used to organise saved runs in the{" "}
          <span className="font-mono text-zinc-400">{BETA_FOLDER}/</span> folder.
        </p>
        <div className="flex flex-col gap-3">
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
      </div>

      {/* Run classification */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-4 flex flex-col gap-3">
        <p className="text-sm font-medium text-zinc-300">Run classification</p>
        <div className="flex gap-2">
          {(["attempt", "send"] as RunType[]).map(t => (
            <button
              key={t}
              onClick={() => setRunType(t)}
              disabled={isProcessing}
              className={[
                "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition capitalize",
                runType === t
                  ? t === "send"
                    ? "border-emerald-500 bg-emerald-950 text-emerald-300"
                    : "border-amber-500 bg-amber-950 text-amber-300"
                  : "border-zinc-700 bg-zinc-950 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300",
                isProcessing ? "cursor-not-allowed opacity-50" : "",
              ].join(" ")}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-600">
          {runType === "send" ? "You topped the route successfully." : "You did not complete the route."}
        </p>
      </div>

      {/* Rating & notes (optional) */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-4 flex flex-col gap-3">
        <p className="text-sm font-medium text-zinc-300">Details <span className="text-zinc-600 font-normal">(optional)</span></p>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400">Grade / Rating</label>
          <input
            type="text"
            value={rating}
            onChange={e => setRating(e.target.value)}
            placeholder="e.g. V3, 5.10a, 6a+"
            disabled={isProcessing}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anything to remember about this run…"
            rows={3}
            disabled={isProcessing}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50 resize-none"
          />
        </div>
      </div>

      {/* Frame adjustment conditions � visible before processing */}
      {!isDone && !isProcessing && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-4 flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-zinc-300">Shooting conditions</p>
            <p className="text-xs text-zinc-500">Select any that apply to help us improve future processing.</p>
          </div>
          <div className="flex flex-col gap-2">
            {FRAME_CONDITIONS.map(c => (
              <label key={c.id} className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={conditions.has(c.id)}
                  onChange={() => toggleCondition(c.id)}
                  className="mt-0.5 h-3.5 w-3.5 accent-zinc-400 cursor-pointer"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-zinc-300 group-hover:text-zinc-100 transition">{c.label}</span>
                  <span className="text-xs text-zinc-600">{c.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </aside>
  ) : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10 flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Video Analysis</h1>
          <p className="text-sm text-zinc-400">
            Upload a climbing video to extract skeleton poses and wall reference features.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-xs text-zinc-500 transition hover:text-zinc-300">
          &#8592; Home
        </Link>
      </div>

      {/* Info dropdowns */}
      <div className="flex flex-col gap-3">
        <InfoDropdown title="What this page does">
          <ul className="flex flex-col gap-1.5 pl-4 list-disc">
            <li>Upload a climbing video and this page <strong className="text-zinc-300">analyses it entirely in your browser</strong> — nothing is sent to a third-party server.</li>
            <li>A pose-detection AI (<strong className="text-zinc-300">MoveNet Lightning</strong>) tracks your skeleton joint-by-joint on every sampled frame of the video.</li>
            <li><strong className="text-zinc-300">ORB feature matching</strong> simultaneously memorises the unique texture of the wall from the first video frame.</li>
            <li>The result is a compact <code className="text-zinc-300">.json</code> file you take to the <strong className="text-zinc-300">Match page</strong> to overlay your movement onto a still route photo.</li>
          </ul>
        </InfoDropdown>
        <InfoDropdown title="Entering route information">
          <ul className="flex flex-col gap-1.5 pl-4 list-disc">
            <li><strong className="text-zinc-300">State / Region, Area, and Route</strong> organise saved runs so they group correctly when loaded on the Match and Compare pages.</li>
            <li>Set <strong className="text-zinc-300">Run type</strong> to <em>Attempt</em> if you did not top the route, or <em>Send</em> if you completed it — shown as a coloured badge throughout the app.</li>
            <li><strong className="text-zinc-300">Grade / Rating</strong> and <strong className="text-zinc-300">Notes</strong> are optional — add them to help identify and compare runs later.</li>
            <li>All fields can be filled in or changed before or after processing.</li>
          </ul>
        </InfoDropdown>
        <InfoDropdown title="Filming and lighting">
          <ul className="flex flex-col gap-1.5 pl-4 list-disc">
            <li>Mount the camera on a <strong className="text-zinc-300">tripod or fixed surface</strong> — any camera movement prevents accurate wall-feature matching.</li>
            <li>Keep the <strong className="text-zinc-300">entire route and climber visible</strong> throughout the clip; nobody should pass between the camera and the climber.</li>
            <li>Shoot in <strong className="text-zinc-300">consistent, even light</strong> — harsh backlight, direct sun, deep shade, or mixed indoor/outdoor light all reduce accuracy.</li>
            <li>Overhead gym fluorescents can cast uneven shadows; chalk dust or a fogged lens reduces sharpness — note any issues in <strong className="text-zinc-300">Shooting conditions</strong> before processing.</li>
            <li>Keep the clip short — only the section containing the climbing run is needed.</li>
          </ul>
        </InfoDropdown>
        <InfoDropdown title="Processing, testing, and saving">
          <ul className="flex flex-col gap-1.5 pl-4 list-disc">
            <li>After selecting a video, scrub to a representative frame, then drag the <strong className="text-zinc-300">Climber crop</strong> box around the area the climber moves through and the <strong className="text-zinc-300">Background (ORB) crop</strong> over the wall texture.</li>
            <li>Click <strong className="text-zinc-300">Process video</strong>. A progress bar shows frames analysed. Processing runs entirely in the browser and may take up to a minute for long videos.</li>
            <li>Once complete, click <strong className="text-zinc-300">Match against a route photo</strong> to test the skeleton overlay immediately on the Match page.</li>
            <li>Save the <code className="text-zinc-300">.json</code> to your device or to S3 — it can be reloaded on the Match page in any future session without re-processing the video.</li>
          </ul>
        </InfoDropdown>
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
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-zinc-200 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-center text-xs text-zinc-400">
            Analysing frame {currentFrame} of {totalFrames} ({progressPct}%)
            <span className="ml-1.5 text-zinc-600">� pose every {frameStep} frames</span>
          </p>
        </div>
      )}

      {isDone && orbStatus === "extracting" && (
        <p className="text-center text-sm text-zinc-400">Extracting reference features&#8230;</p>
      )}
      {isDone && orbStatus === "failed" && (
        <p className="text-center text-sm text-amber-400">
          Feature extraction failed � image matching will be unavailable.
        </p>
      )}

      {/* Result actions */}
      {showResults && activeAttemptId && activeAttempt && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 px-5 py-4">
            <p className="text-sm font-medium text-emerald-300">Analysis complete</p>
            <p className="mt-0.5 text-xs text-emerald-500">
              {activeAttempt.frames.length} pose frames �{" "}
              {activeAttempt.orbFeatures?.keypoints.length ?? 0} ORB keypoints extracted
              {activeAttempt.state && ` � ${activeAttempt.state}`}
              {activeAttempt.area  && ` � ${activeAttempt.area}`}
              {activeAttempt.route && ` � ${activeAttempt.route}`}
            </p>
          </div>

          <Link
            href={`/match?id=${activeAttemptId}`}
            className="flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200"
          >
            Match against a route photo
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>

          <button
            onClick={handleSaveToDevice}
            className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Save to {BETA_FOLDER} folder
          </button>

          {savedRouteDirHandle && (
            <button
              onClick={handleDeleteFromDevice}
              className="flex items-center justify-center gap-2 rounded-xl border border-red-900/50 bg-red-950/20 px-6 py-3 text-sm text-red-400 transition hover:border-red-700 hover:text-red-300"
            >
              Delete from device
            </button>
          )}

          {showLocationWarning && (
            <p className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-2.5 text-xs text-amber-400">
              Enter State/Region, Area, and Route before saving to S3.
            </p>
          )}

          <button
            onClick={handleSaveToS3}
            disabled={s3Status === "loading"}
            className={[
              "flex items-center justify-center gap-2 rounded-xl border px-6 py-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
              s3Saved
                ? "border-emerald-800/50 bg-emerald-950/20 text-emerald-300 hover:border-emerald-700"
                : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100",
            ].join(" ")}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
            </svg>
            {s3Status === "loading" ? "Uploading�" : s3Saved ? "Saved to S3" : "Save to S3"}
          </button>

          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
        </div>
      )}

      {status === "error" && (
        <p className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

export default function UploadPage() {
  return (
    <LoadingGate>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            Loading&#8230;
          </div>
        }
      >
        <UploadPageInner />
      </Suspense>
    </LoadingGate>
  );
}
