"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import LoadingGate from "@/components/shared/LoadingGate";

import CropBoxOverlay, { type CropFraction, DEFAULT_CROP } from "@/components/shared/CropBoxOverlay";
import ComboInput from "@/components/shared/ComboInput";
import FramePlayer from "@/components/shared/FramePlayer";
import SkeletonStylePanel from "@/components/shared/SkeletonStylePanel";
import { useOpenCV } from "@/hooks/useOpenCV";
import { usePoseModel, type MediaPipeVariant } from "@/hooks/usePoseModel";
import { useVideoProcessor } from "@/hooks/useVideoProcessor";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { useSkeletonFrames } from "@/hooks/useSkeletonFrames";
import { useS3Storage } from "@/hooks/useS3Storage";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useGeocoding } from "@/hooks/useGeocoding";
import { getAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { RunType } from "@/storage/sessionStore";
import { sanitizeDirName, serializeAttemptForJson } from "@/utils/fsHelpers";
import { type SkeletonStyle } from "@/pipeline/skeletonOverlay";
import type { RenderedSkeletonFrame } from "@/pipeline/skeletonRenderer";
import { renderPoseVideo } from "@/pipeline/poseVideoRenderer";
import { getTopology } from "@/utils/poseConstants";
import CameraRecorderModal from "@/components/shared/CameraRecorderModal";

const MapPicker = dynamic(() => import("@/components/map/MapPicker"), { ssr: false });

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
// Module-level cache — survives component unmount so state persists when
// the user navigates away from the upload page and returns.
// ---------------------------------------------------------------------------
let cachedPendingFile: File | null = null;
let cachedVideoUrl: string | null = null;

// ---------------------------------------------------------------------------
// Upload page inner
// ---------------------------------------------------------------------------

function UploadPageInner() {
  const { cv } = useOpenCV();

  // Model selection state — MediaPipe only
  const [modelVariant, setModelVariant] = useState<MediaPipeVariant>("lite");
  const { model } = usePoseModel({ backend: "mediapipe", variant: modelVariant });
  const { process, status, orbStatus, currentFrame, totalFrames, attemptId, errorMessage } =
    useVideoProcessor(100);
  const { uploadAttempt, listPrefixes, listAttempts, userPrefix, status: s3Status } = useS3Storage();
  const { matchImage, reset: resetMatcher, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();

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
  const [pendingFile, setPendingFile] = useState<File | null>(() => cachedPendingFile);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(() => cachedVideoUrl);
  const [frameStep, setFrameStep] = useState(5);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [s3Saved, setS3Saved] = useState(false);
  const [locationWarning, setLocationWarning] = useState(false);
  const [savedRouteDirHandle, setSavedRouteDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [conditions, setConditions] = useState<Set<string>>(new Set());
  const [newFileSelected, setNewFileSelected] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const previewUrlRef = useRef<string | null>(cachedVideoUrl);

  // ---- Post-processing phase ----
  // "input" = editing / pre-process, "results" = showing landmark preview + save options,
  // "overlay" = inline route photo overlay
  const [phase, setPhase] = useState<"input" | "results" | "overlay">(() =>
    restoredAttempt ? "results" : "input"
  );

  // First-frame image for animated landmark preview (FramePlayer background)
  const [firstFrameFile, setFirstFrameFile] = useState<File | null>(null);

  // Inline route photo overlay state
  const [routePhotoFile, setRoutePhotoFile] = useState<File | null>(null);
  const [routePhotoPreviewUrl, setRoutePhotoPreviewUrl] = useState<string | null>(null);
  const routePhotoPreviewUrlRef = useRef<string | null>(null);
  const [routePhotoCrop, setRoutePhotoCrop] = useState<CropFraction>({ x: 0, y: 0, w: 1, h: 1 });
  const [routeMatchTriggered, setRouteMatchTriggered] = useState(false);

  // Edit-mode flag — set when user clicks "Edit climb" from results.
  // Allows the input phase to show the crop UI even when isDone is true.
  const [editMode, setEditMode] = useState(false);

  // Skeleton style for overlays
  const [skeletonStyle, setSkeletonStyle] = useState<SkeletonStyle>({ lineWidth: 2.5, pointRadius: 5 });

  // On-demand video export state
  const [exportStatus, setExportStatus] = useState<"idle" | "rendering" | "done">("idle");
  const [exportProgress, setExportProgress] = useState(0);
  const styleRef = useRef<SkeletonStyle>({ lineWidth: 2.5, pointRadius: 5 });

  const [climberCrop, setClimberCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [orbCrop, setOrbCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [activeCropMode, setActiveCropMode] = useState<"climber" | "route">("climber");
  const [hasCropFrame, setHasCropFrame] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const cropVideoRef = useRef<HTMLVideoElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);

  // Viewport-fit + fullscreen state for video crop preview
  const [videoNaturalSize, setVideoNaturalSize] = useState<{ w: number; h: number }>({ w: 16, h: 9 });
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const fullscreenVideoRef = useRef<HTMLVideoElement>(null);
  const [fsVideoCurrentTime, setFsVideoCurrentTime] = useState(0);
  const [fsIsPlaying, setFsIsPlaying] = useState(false);

  // Viewport-fit + fullscreen state for route photo image preview
  const [routePhotoNaturalSize, setRoutePhotoNaturalSize] = useState<{ w: number; h: number }>({ w: 4, h: 3 });
  const [routePhotoFullscreen, setRoutePhotoFullscreen] = useState(false);

  // Crop adjustment confirmation dialog
  const [showCropWarning, setShowCropWarning] = useState(false);

  // Bottom sheet for metadata entry (triggered by save/upload buttons)
  const [showBottomSheet, setShowBottomSheet] = useState(false);
  const [bottomSheetAction, setBottomSheetAction] = useState<"save" | "upload">("save");

  // Shooting conditions dropdown (inline with crop buttons)
  const [showConditionsDropdown, setShowConditionsDropdown] = useState(false);

  // Derive topology-aware skeleton style
  const activeAttemptId0 = (status === "done") ? attemptId : restoredAttempt?.id ?? null;
  const activeAttempt0 = activeAttemptId0 ? getAttempt(activeAttemptId0) : null;
  const topoStyle: SkeletonStyle = useMemo(() => {
    const backend = activeAttempt0?.poseBackend ?? "mediapipe";
    const topo = getTopology(backend);
    return { ...skeletonStyle, skeletonEdges: topo.skeletonEdges, keypointNames: topo.keypointNames };
  }, [skeletonStyle, activeAttempt0]);

  // Keep styleRef in sync
  useEffect(() => { styleRef.current = topoStyle; }, [topoStyle]);

  // Pre-compute skeleton frames for the inline route photo overlay
  const { data: skeletonData, status: frameStatus, errorMessage: frameError } =
    useSkeletonFrames(cv, activeAttemptId0 || null, matchResult);

  // GPS coordinate tagging
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(
    () => restoredAttempt?.coordinates ?? null,
  );
  const [showMapPicker, setShowMapPicker] = useState(false);
  const { request: geoRequest, loading: geoLoading } = useGeolocation();
  const { reverseGeocode } = useGeocoding();

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

    // Auto-populate rating from the most recent run for this route.
    if (val.trim() && state.trim() && area.trim() && userPrefix) {
      const prefix = `${userPrefix}/${sanitizeDirName(state)}/${sanitizeDirName(area)}/${sanitizeDirName(val)}/`;
      listAttempts(prefix).then(async (entries) => {
        const runs = entries
          .filter(e => e.key.endsWith(".json") && !e.key.endsWith("/route-image.json"))
          .sort((a, b) => {
            const tsA = parseInt((a.key.match(/(?:attempt|run)-(\d+)/) ?? ["", "0"])[1], 10);
            const tsB = parseInt((b.key.match(/(?:attempt|run)-(\d+)/) ?? ["", "0"])[1], 10);
            return tsB - tsA;
          });
        if (runs.length === 0) return;
        try {
          const res = await fetch(`/api/s3/get?key=${encodeURIComponent(runs[0].key)}`);
          if (!res.ok) return;
          const raw = (await res.json()) as Record<string, unknown>;
          if (typeof raw.rating === "string" && raw.rating) setRating(raw.rating);
          if (raw.coordinates && typeof raw.coordinates === "object") {
            const c = raw.coordinates as { lat?: number; lng?: number };
            if (typeof c.lat === "number" && typeof c.lng === "number") {
              setCoordinates({ lat: c.lat, lng: c.lng });
            }
          }
        } catch { /* ignore */ }
      }).catch(() => {});
    }
  }

  // Only show the location warning while any required field is still empty.
  const showLocationWarning = locationWarning && (!state.trim() || !area.trim() || !route.trim());

  const progressPct = totalFrames > 0 ? Math.round((currentFrame / totalFrames) * 100) : 0;
  const isProcessing = status === "processing";
  const isDone = status === "done";
  const orbReady = orbStatus === "ready";
  const orbFinished = orbReady || orbStatus === "failed";

  // Persist the attempt id into session so user can return from match page.
  const activeAttemptId = isDone ? attemptId : restoredAttempt?.id ?? null;
  const activeAttempt   = activeAttemptId ? getAttempt(activeAttemptId) : null;
  const showResults     = phase !== "input" && !newFileSelected && ((isDone && orbFinished) || (!isDone && !!restoredAttempt && !isProcessing));

  // Switch to results phase when processing completes
  useEffect(() => {
    if (isDone && orbFinished && phase === "input" && !editMode) {
      setPhase("results");
    }
  }, [isDone, orbFinished, phase, editMode]);

  useEffect(() => {
    if (isDone && attemptId) {
      try { window.sessionStorage.setItem(SESSION_KEY, attemptId); } catch { /* quota */ }
    }
  }, [isDone, attemptId]);

  // Cache file and URL in module scope so state survives navigation.
  useEffect(() => { cachedPendingFile = pendingFile; }, [pendingFile]);
  useEffect(() => { cachedVideoUrl = videoPreviewUrl; }, [videoPreviewUrl]);

  // Only revoke the video preview URL when a new file is loaded (handled in
  // loadVideoFile), NOT on unmount — we want it to survive navigation.

  useEffect(() => {
    return () => {
      if (routePhotoPreviewUrlRef.current) URL.revokeObjectURL(routePhotoPreviewUrlRef.current);
    };
  }, []);

  // Capture first video frame as a File for the animated landmark preview.
  useEffect(() => {
    if (phase !== "results" || !activeAttempt || !videoPreviewUrl) return;
    const vw = activeAttempt.videoMeta.width;
    const vh = activeAttempt.videoMeta.height;

    let cancelled = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = videoPreviewUrl;

    const onSeeked = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, vw, vh);
      canvas.toBlob((blob) => {
        if (cancelled || !blob) return;
        setFirstFrameFile(new File([blob], "first-frame.png", { type: "image/png" }));
      }, "image/png");
      video.removeEventListener("seeked", onSeeked);
    };

    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadeddata", () => {
      video.currentTime = 0;
    }, { once: true });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, activeAttemptId, videoPreviewUrl]);

  // Build animated skeleton frames from all pose frames in video-pixel space.
  // No homography needed — this is for the first-frame landmark preview.
  const firstFrameSkeletonData = useMemo(() => {
    if (!activeAttempt) return null;
    const { frames, videoMeta } = activeAttempt;
    if (!frames.length) return null;
    const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);
    const firstTs = sorted[0].timestamp;
    const lastTs = sorted[sorted.length - 1].timestamp;
    const duration = Math.max(lastTs - firstTs, 0.1);
    const renderedFrames: RenderedSkeletonFrame[] = sorted.map(f => ({
      timestamp: f.timestamp - firstTs,
      keypoints: Object.fromEntries(
        f.keypoints.map(kp => [kp.name, { x: kp.x * videoMeta.width, y: kp.y * videoMeta.height }])
      ),
    }));
    return { frames: renderedFrames, duration };
  }, [activeAttempt]);

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
    setPhase("input");
    setEditMode(false);
    setFirstFrameFile(null);
    // Clear route photo overlay state
    clearRoutePhoto();
  }

  function setRoutePhotoWithPreview(file: File | null) {
    if (routePhotoPreviewUrlRef.current) {
      URL.revokeObjectURL(routePhotoPreviewUrlRef.current);
      routePhotoPreviewUrlRef.current = null;
    }
    setRoutePhotoFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      routePhotoPreviewUrlRef.current = url;
      setRoutePhotoPreviewUrl(url);
    } else {
      setRoutePhotoPreviewUrl(null);
    }
  }

  function clearRoutePhoto() {
    setRoutePhotoWithPreview(null);
    setRoutePhotoCrop({ x: 0, y: 0, w: 1, h: 1 });
    setRouteMatchTriggered(false);
    setExportStatus("idle");
    setExportProgress(0);
    resetMatcher();
  }

  function handleRoutePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRoutePhotoWithPreview(file);
    setRoutePhotoCrop({ x: 0, y: 0, w: 1, h: 1 });
    setRouteMatchTriggered(false);
    resetMatcher();
  }

  function handleApplyRouteMatch() {
    if (!routePhotoFile || !cv || !activeAttemptId) return;
    setRouteMatchTriggered(true);
    matchImage(routePhotoFile, activeAttemptId, cv, routePhotoCrop);
  }

  function handleEditClimb() {
    setEditMode(true);
    setPhase("input");
    setFirstFrameFile(null);
    clearRoutePhoto();
  }

  function handleBackToResultsFromEdit() {
    setEditMode(false);
    setPhase("results");
  }

  function handleViewOnRoutePhoto() {
    setPhase("overlay");
  }

  function handleBackToResults() {
    setPhase("results");
    clearRoutePhoto();
  }

  const handleExportUploadVideo = useCallback(async () => {
    if (!cv || !routePhotoFile || !activeAttemptId || !matchResult) return;
    const att = getAttempt(activeAttemptId);
    if (!att?.orbFeatures) return;

    setExportStatus("rendering");
    setExportProgress(0);

    try {
      const url = await renderPoseVideo({
        cv,
        imageFile: routePhotoFile,
        frames: att.frames,
        videoMeta: att.videoMeta,
        orbFeatures: att.orbFeatures,
        queryOrb: matchResult.queryOrb,
        matches: matchResult.matches,
        skeletonStyle: styleRef.current,
        targetFps: 60,
        onProgress: (r: number, t: number) => setExportProgress(Math.round((r / t) * 100)),
      });

      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeAttemptId}-pose-overlay.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus("done");
    } catch (err) {
      console.error("[UploadPage] Video export failed:", err);
      setExportStatus("idle");
    }
  }, [cv, routePhotoFile, activeAttemptId, matchResult]);

  const isFrameReady = frameStatus === "ready" && !!skeletonData;
  const isMatching = matchStatus === "matching";

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
    setVideoNaturalSize({ w: video.videoWidth || 16, h: video.videoHeight || 9 });
  }

  // ---- Fullscreen video helpers ----

  function openVideoFullscreen() {
    setFsVideoCurrentTime(cropVideoRef.current?.currentTime ?? 0);
    setFsIsPlaying(false);
    setVideoFullscreen(true);
  }

  function closeVideoFullscreen() {
    if (fullscreenVideoRef.current) {
      fullscreenVideoRef.current.pause();
    }
    if (fullscreenVideoRef.current && cropVideoRef.current) {
      cropVideoRef.current.currentTime = fullscreenVideoRef.current.currentTime;
      setVideoCurrentTime(fullscreenVideoRef.current.currentTime);
    }
    setFsIsPlaying(false);
    setVideoFullscreen(false);
  }

  function handleFsPlayPause() {
    const v = fullscreenVideoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }
  }

  function handleFsSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = fullscreenVideoRef.current;
    if (!v) return;
    v.currentTime = Number(e.target.value);
    setFsVideoCurrentTime(Number(e.target.value));
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
    setEditMode(false);
    setPhase("input");
    setFirstFrameFile(null);
    clearRoutePhoto();
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
      setShowBottomSheet(false);
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
        coordinates: coordinates ?? undefined,
      };
      await uploadAttempt(attemptToUpload);
      setS3Saved(true);
      setLocationWarning(false);
      setShowBottomSheet(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "S3 upload failed.");
    }
  }

  function handleOpenSaveSheet() {
    setSaveError(null);
    setBottomSheetAction("save");
    setShowBottomSheet(true);
  }

  function handleOpenUploadSheet() {
    setSaveError(null);
    setBottomSheetAction("upload");
    setShowBottomSheet(true);
  }

  async function handleUseGPS() {
    const geo = await geoRequest();
    if (!geo) return;
    setCoordinates({ lat: geo.lat, lng: geo.lng });
    const result = await reverseGeocode(geo.lat, geo.lng);
    if (result?.address) {
      const { state: addrState, city, town, village, county } = result.address;
      if (addrState && !state.trim()) handleStateChange(addrState);
      const locality = city ?? town ?? village ?? county ?? "";
      if (locality && !area.trim()) handleAreaChange(locality);
    }
  }

  // ESC key: close video fullscreen
  useEffect(() => {
    if (!videoFullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeVideoFullscreen();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [videoFullscreen]);

  // ESC key: close route photo fullscreen
  useEffect(() => {
    if (!routePhotoFullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setRoutePhotoFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [routePhotoFullscreen]);

  // Compute viewport-fit container style for a media element with known natural dimensions.
  // The container fills as much horizontal space as available while never exceeding viewport
  // height (minus nav bar and a small buffer), preserving aspect ratio exactly so that
  // CropBoxOverlay fraction coordinates always map 1-to-1 with the visible media area.
  function mediaContainerStyle(w: number, h: number): React.CSSProperties {
    const ratio = (w / h).toFixed(6);
    const maxH = "calc(100dvh - var(--nav-h) - 1rem)";
    return {
      width: `min(100%, calc(${maxH} * ${ratio}))`,
      maxHeight: maxH,
      aspectRatio: `${w} / ${h}`,
    };
  }

  function fsMediaContainerStyle(w: number, h: number): React.CSSProperties {
    const ratio = (w / h).toFixed(6);
    const maxH = "calc(100dvh - 8rem)";
    return {
      width: `min(100%, calc(${maxH} * ${ratio}))`,
      maxHeight: maxH,
      aspectRatio: `${w} / ${h}`,
    };
  }

  const videoAndCropSection = (
    <div className="flex-1 min-w-0 flex flex-col gap-4">
      {/* Video input — upload file or record with camera */}
      <div className="grid grid-cols-2 gap-3">
        {/* Choose existing file */}
        <label
          className={[
            "flex cursor-pointer flex-col items-center gap-3 rounded-2xl border px-4 py-5 text-sm transition-all duration-200",
            isProcessing
              ? "cursor-not-allowed border-edge/30 bg-card/30 opacity-40 text-fg-muted"
              : [
                  "border-edge/50 bg-card/50 text-fg-secondary",
                  "hover:border-accent/50 hover:bg-card/80 hover:text-fg",
                  !pendingFile ? "border-accent/25" : "",
                ].join(" "),
          ].join(" ")}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
            <svg className="h-5 w-5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
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

        {/* Record with camera */}
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          disabled={isProcessing}
          className={[
            "flex flex-col items-center gap-3 rounded-2xl border px-4 py-5 text-sm transition-all duration-200",
            isProcessing
              ? "cursor-not-allowed border-edge/30 bg-card/30 opacity-40 text-fg-muted"
              : [
                  "cursor-pointer border-edge/50 bg-card/50 text-fg-secondary",
                  "hover:border-accent/50 hover:bg-card/80 hover:text-fg",
                  !pendingFile ? "border-accent/25" : "",
                ].join(" "),
          ].join(" ")}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
            <svg className="h-5 w-5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <div className="flex flex-col items-center gap-0.5 text-center">
            <span className="font-medium text-fg">Record a video</span>
            <span className="text-xs text-fg-muted">Opens camera</span>
          </div>
        </button>
      </div>

      {/* Edit-mode banner — return to results without re-processing */}
      {editMode && activeAttempt && (
        <button
          onClick={handleBackToResultsFromEdit}
          className="self-start flex items-center gap-1.5 rounded-xl border border-edge bg-card px-4 py-2 text-xs font-medium text-fg-secondary transition hover:border-accent/60 hover:text-fg"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back to results
        </button>
      )}

      {/* Crop UI — shown after file selected, before processing (or in edit mode) */}
      {videoPreviewUrl && pendingFile && !isProcessing && (!isDone || editMode) && phase === "input" && (
        <div className="flex flex-col gap-3">
          {/* ── Crop toolbar: mode buttons + conditions + expand ── */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setActiveCropMode("climber")}
              className={[
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                activeCropMode === "climber"
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
                isCropDefault(climberCrop) ? "animate-pulse" : "",
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
                isCropDefault(orbCrop) ? "animate-pulse" : "",
              ].join(" ")}
            >
              Wall texture crop
            </button>

              {/* Shooting conditions dropdown */}
              {!isDone && !isProcessing && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowConditionsDropdown(p => !p)}
                    className={[
                      "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                      showConditionsDropdown
                        ? "border-accent/60 bg-accent/10 text-accent"
                        : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
                    ].join(" ")}
                  >
                    Conditions
                    {conditions.size > 0 && (
                      <span className="rounded-full bg-accent/20 px-1.5 text-[10px] font-bold text-accent">{conditions.size}</span>
                    )}
                    <svg
                      className={["h-3 w-3 transition-transform", showConditionsDropdown ? "rotate-180" : ""].join(" ")}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showConditionsDropdown && (
                    <div className="absolute left-0 top-full z-20 mt-1.5 w-72 rounded-xl border border-edge/50 bg-card/95 p-3 shadow-2xl backdrop-blur-xl animate-fade-in">
                      <p className="mb-2 text-xs font-semibold text-fg">Shooting conditions</p>
                      <div className="flex flex-col gap-2">
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
                    </div>
                  )}
                </div>
              )}

            {/* Expand to fullscreen */}
            <button
              onClick={openVideoFullscreen}
              className="ml-auto rounded-lg border border-edge/50 bg-card/60 p-1.5 text-fg-muted hover:border-edge-hover hover:text-fg transition"
              aria-label="Expand video preview to fullscreen"
              title="Expand preview"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6m0 0v6m0-6L14 10M9 21H3m0 0v-6m0 6L10 14" />
              </svg>
            </button>
          </div>

          {/* Active crop mode description */}
          <p className="text-xs text-fg-muted">
            {activeCropMode === "climber"
              ? "Climber crop \u2014 drag handles to resize, drag interior to move. Follows the climber through each frame."
              : "Wall texture crop \u2014 drag to focus on wall texture used to match this video\u2019s wall to your route photo."}
          </p>

          {/* Viewport-fit video container — aspect-ratio constrained so CropBoxOverlay fractions map exactly to media pixels */}
          <div
            className="relative overflow-hidden rounded-2xl border border-edge/50 bg-surface shadow-lg shadow-black/10"
            style={mediaContainerStyle(videoNaturalSize.w, videoNaturalSize.h)}
          >
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
              className="absolute inset-0 w-full h-full"
              style={{ objectFit: "fill" }}
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
            <div className="flex items-center gap-3 rounded-xl border border-edge/40 bg-card/70 px-3 py-2">
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

          {/* Model variant + Frame step */}
          <div className="flex flex-col gap-3 rounded-xl border border-edge/40 bg-card/60 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-medium text-fg-secondary">Pose model</label>
              <select
                value={modelVariant}
                onChange={e => setModelVariant(e.target.value as MediaPipeVariant)}
                disabled={isProcessing}
                className="rounded-lg border border-edge bg-inset px-2 py-1 text-xs text-fg outline-none transition focus:border-accent/60 disabled:opacity-50"
              >
                <option value="lite">Lite (fast)</option>
                <option value="full">Full (balanced)</option>
                <option value="heavy">Heavy (accurate)</option>
              </select>
            </div>

            {/* Frame step slider */}
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
              1 = every frame (slowest, most accurate) \u2014 30 = every 30th frame (fastest, more interpolation between detections)
            </p>
          </div>

          {/* Process button */}
          <button
            onClick={handleProcess}
            disabled={!model || !cv}
            className="flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-surface shadow-lg shadow-accent/20 transition-all duration-200 hover:bg-accent-hover hover:shadow-accent/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none active:scale-[0.98]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
            </svg>
            Scan video
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

  return (
    <div className="flex-1">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 flex flex-col gap-6 sm:px-6 sm:py-10 sm:gap-8">
      {/* Header */}
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-bold tracking-tight text-fg sm:text-2xl">Route Scanner</h1>
        <p className="text-[13px] text-fg-secondary leading-relaxed">
          Upload or record a climbing video to scan skeleton poses and extract wall reference features.
        </p>
      </div>

      {/* Main content */}
      {videoAndCropSection}

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
            <span className="ml-1.5 text-fg-muted">\u2014 pose every {frameStep} frames</span>
          </p>
        </div>
      )}

      {isDone && orbStatus === "extracting" && (
        <p className="text-center text-sm text-fg-secondary">Extracting reference features&#8230;</p>
      )}
      {isDone && orbStatus === "failed" && (
        <p className="text-center text-sm text-amber-400">
          Feature extraction failed \u2014 image matching will be unavailable.
        </p>
      )}

      {/* Result actions — results phase: landmark preview + action buttons */}
      {showResults && activeAttemptId && activeAttempt && phase === "results" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-success/20 bg-success/5 px-5 py-4 shadow-sm shadow-success/5">
            <p className="text-sm font-semibold text-success">Analysis complete</p>
            <p className="mt-1 text-xs text-success/70 leading-relaxed">
              {activeAttempt.frames.length} pose frames &middot;{" "}
              {activeAttempt.orbFeatures?.keypoints.length ?? 0} reference points extracted
              {activeAttempt.state && ` \u2014 ${activeAttempt.state}`}
              {activeAttempt.area  && ` \u203a ${activeAttempt.area}`}
              {activeAttempt.route && ` \u203a ${activeAttempt.route}`}
            </p>
          </div>

          {/* Animated first-frame landmark preview */}
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fg-muted">Recorded pose landmarks</p>
            {firstFrameFile && firstFrameSkeletonData ? (
              <FramePlayer
                imageFile={firstFrameFile}
                layers={[{ frames: firstFrameSkeletonData.frames, style: topoStyle }]}
                duration={firstFrameSkeletonData.duration}
                autoPlay
                className="w-full rounded-xl border border-edge/50"
              />
            ) : (
              <p className="text-xs text-fg-muted text-center">Loading preview&hellip;</p>
            )}
          </div>

          {/* Skeleton style */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fg-muted">Skeleton style</span>
            <SkeletonStylePanel onChange={setSkeletonStyle} />
          </div>

          {/* View on route photo — opens file picker (requires ORB features) */}
          {orbReady && (
          <label
            className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3.5 text-sm font-semibold text-surface shadow-lg shadow-accent/20 transition-all duration-200 hover:bg-accent-hover hover:shadow-accent/30 active:scale-[0.98]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
            </svg>
            View on route photo
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                resetMatcher();
                setRoutePhotoWithPreview(file);
                setRoutePhotoCrop({ x: 0, y: 0, w: 1, h: 1 });
                setRouteMatchTriggered(false);
                handleViewOnRoutePhoto();
              }}
            />
          </label>
          )}

          {/* Edit climb — go back to pre-process state */}
          <button
            onClick={handleEditClimb}
            className="flex items-center justify-center gap-2 rounded-xl border border-edge/50 bg-card/60 px-6 py-3 text-sm text-fg-secondary transition-all duration-200 hover:border-edge-hover hover:bg-card hover:text-fg"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
            Edit climb
          </button>

          {/* Save buttons — open bottom sheet for metadata entry */}
          <button
            onClick={handleOpenSaveSheet}
            className="flex items-center justify-center gap-2 rounded-xl border border-edge/50 bg-card/60 px-6 py-3 text-sm text-fg-secondary transition-all duration-200 hover:border-edge-hover hover:bg-card hover:text-fg"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Save to device
          </button>

          {savedRouteDirHandle && (
            <button
              onClick={handleDeleteFromDevice}
              className="flex items-center justify-center gap-2 rounded-xl border border-red-900/40 bg-red-950/20 px-6 py-3 text-sm text-red-400 transition-all duration-200 hover:border-red-700 hover:bg-red-950/30 hover:text-red-300"
            >
              Delete from device
            </button>
          )}

          <button
            onClick={handleOpenUploadSheet}
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
            {s3Saved ? "Uploaded" : "Upload"}
          </button>

          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
        </div>
      )}

      {/* Overlay phase — inline route photo matching + skeleton overlay */}
      {showResults && activeAttemptId && activeAttempt && phase === "overlay" && (
        <div className="flex flex-col gap-4">
          {/* Back to results */}
          <button
            onClick={handleBackToResults}
            className="self-start flex items-center gap-1.5 rounded-lg border border-edge/50 bg-card/60 px-3 py-1.5 text-xs font-medium text-fg-secondary transition-all duration-200 hover:border-accent/40 hover:bg-card hover:text-fg"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back to results
          </button>

          {/* Route photo upload / change */}
          {!routePhotoFile && (
            <div className="grid grid-cols-2 gap-3">
              <label
                className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-edge/50 bg-card/50 px-4 py-5 text-sm text-fg-secondary transition-all duration-200 hover:border-accent/50 hover:bg-card/80 hover:text-fg border-accent/25"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
                </svg>
                <span className="font-medium text-fg">Select a photo</span>
                <span className="text-xs text-fg-muted">JPG, PNG, WebP</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleRoutePhotoSelect} />
              </label>
            </div>
          )}

          {/* Crop UI — shown after route photo selected, before match triggered */}
          {routePhotoPreviewUrl && routePhotoFile && !routeMatchTriggered && !isMatching && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-fg-secondary">
                  Adjust the crop region for wall texture matching then click &ldquo;Apply &amp; View&rdquo;.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setRoutePhotoFullscreen(true)}
                    className="rounded-lg border border-edge/50 bg-card/60 p-1.5 text-fg-muted hover:border-edge-hover hover:text-fg transition"
                    aria-label="Expand route photo to fullscreen"
                    title="Expand preview"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6m0 0v6m0-6L14 10M9 21H3m0 0v-6m0 6L10 14" />
                    </svg>
                  </button>
                  <label className="shrink-0 cursor-pointer text-xs text-fg-muted hover:text-fg transition">
                    Change photo
                    <input type="file" accept="image/*" className="hidden" onChange={handleRoutePhotoSelect} />
                  </label>
                </div>
              </div>
              {/* Viewport-fit image container — aspect-ratio constrained so CropBoxOverlay fractions map exactly to media pixels */}
              <div
                className="relative overflow-hidden rounded-xl border border-edge/50 bg-card/70 shadow-lg shadow-black/10"
                style={mediaContainerStyle(routePhotoNaturalSize.w, routePhotoNaturalSize.h)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={routePhotoPreviewUrl}
                  alt="Route photo preview"
                  className="absolute inset-0 w-full h-full"
                  style={{ objectFit: "fill" }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setRoutePhotoNaturalSize({ w: img.naturalWidth || 4, h: img.naturalHeight || 3 });
                  }}
                />
                <CropBoxOverlay
                  box={routePhotoCrop}
                  onChange={setRoutePhotoCrop}
                />
              </div>
              <button
                onClick={handleApplyRouteMatch}
                className="flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-surface shadow-lg shadow-accent/20 transition-all duration-200 hover:bg-accent-hover hover:shadow-accent/30 disabled:cursor-not-allowed disabled:opacity-50 ring-2 ring-accent/30 ring-offset-2 ring-offset-surface active:scale-[0.98]"
              >
                Apply &amp; View
              </button>
            </div>
          )}

          {/* Static preview while matching */}
          {routePhotoPreviewUrl && routeMatchTriggered && (isMatching || !isFrameReady) && (
            <div className="flex flex-col gap-2">
              <div
                className="relative overflow-hidden rounded-xl border border-edge/50 bg-card/70"
                style={mediaContainerStyle(routePhotoNaturalSize.w, routePhotoNaturalSize.h)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={routePhotoPreviewUrl}
                  alt="Route photo preview"
                  className="absolute inset-0 w-full h-full"
                  style={{ objectFit: "fill" }}
                />
              </div>
              {isMatching && (
                <p className="text-center text-sm text-fg-secondary">Matching features&hellip;</p>
              )}
            </div>
          )}

          {/* Match statistics */}
          {matchStatus === "done" && matchResult && (
            <div className="rounded-xl border border-edge/40 bg-card/60 px-5 py-4 flex flex-col gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fg-muted">Match statistics</p>
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
                  Fewer than 10 matches &mdash; the homography may be unstable. Try a closer or better-lit photo of the same wall section.
                </p>
              )}
            </div>
          )}

          {/* Skeleton style */}
          {routeMatchTriggered && (
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fg-muted">Skeleton style</span>
              <SkeletonStylePanel onChange={setSkeletonStyle} />
            </div>
          )}

          {/* Pose overlay — FramePlayer */}
          {isFrameReady && routePhotoFile && (
            <div className="flex flex-col gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fg-muted">Pose overlay</p>
              <FramePlayer
                imageFile={routePhotoFile}
                layers={[{ frames: skeletonData.frames, style: topoStyle }]}
                duration={skeletonData.duration}
                autoPlay
              />

              {/* Video export */}
              {exportStatus === "rendering" ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs text-fg-secondary">
                    <span>Encoding video for download&hellip;</span>
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
                  onClick={handleExportUploadVideo}
                  className="flex items-center justify-center gap-2 rounded-xl border border-edge/50 bg-card/60 px-6 py-3 text-sm text-fg-secondary transition-all duration-200 hover:border-edge-hover hover:bg-card hover:text-fg"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  {exportStatus === "done" ? "Download again (.webm)" : "Download pose overlay video (.webm)"}
                </button>
              )}

              {/* Change route photo */}
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-edge/50 bg-card/60 px-6 py-3 text-sm text-fg-secondary transition-all duration-200 hover:border-edge-hover hover:bg-card hover:text-fg">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
                </svg>
                Change route photo
                <input type="file" accept="image/*" className="hidden" onChange={handleRoutePhotoSelect} />
              </label>
            </div>
          )}

          {/* Save buttons in overlay phase */}
          <div className="flex flex-col gap-3 pt-3 border-t border-edge/30">
            <button
              onClick={handleOpenSaveSheet}
              className="flex items-center justify-center gap-2 rounded-xl border border-edge/50 bg-card/60 px-6 py-3 text-sm text-fg-secondary transition-all duration-200 hover:border-edge-hover hover:bg-card hover:text-fg"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Save to device
            </button>

            <button
              onClick={handleOpenUploadSheet}
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
              {s3Saved ? "Uploaded" : "Upload"}
            </button>

            {saveError && <p className="text-xs text-red-400">{saveError}</p>}
          </div>

          {(matchStatus === "error" || frameStatus === "error") && (
            <p className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
              {matchError ?? frameError}
            </p>
          )}
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

      {/* ── Video crop fullscreen portal ── */}
      {videoFullscreen && videoPreviewUrl && createPortal(
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-surface"
          role="dialog"
          aria-modal="true"
          aria-label="Video crop — fullscreen"
        >
          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-edge/40 bg-surface-alt/80 backdrop-blur">
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
            <p className="text-xs text-fg-muted hidden sm:block">
              {activeCropMode === "climber"
                ? "Climber crop \u2014 drag handles or interior"
                : "Wall texture crop \u2014 drag to select wall region"}
            </p>
            <button
              onClick={closeVideoFullscreen}
              className="ml-auto rounded-lg border border-edge/50 bg-card/60 p-1.5 text-fg-muted hover:border-edge-hover hover:text-fg transition"
              aria-label="Close fullscreen (Escape)"
              title="Close fullscreen (Esc)"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L3 3m0 0h6m-6 0V9M15 9l6-6m0 0v6m0-6h-6M9 15l-6 6m0 0h6m-6 0v-6M15 15l6 6m0 0v-6m0 6h-6" />
              </svg>
            </button>
          </div>

          {/* Video area — fills remaining height */}
          <div className="flex-1 relative overflow-hidden flex items-center justify-center px-4 py-4 min-h-0">
            <div
              className="relative overflow-hidden rounded-xl border border-edge/40"
              style={fsMediaContainerStyle(videoNaturalSize.w, videoNaturalSize.h)}
            >
              <video
                ref={fullscreenVideoRef}
                src={videoPreviewUrl}
                muted
                playsInline
                onPlay={() => setFsIsPlaying(true)}
                onPause={() => setFsIsPlaying(false)}
                onTimeUpdate={() => setFsVideoCurrentTime(fullscreenVideoRef.current?.currentTime ?? 0)}
                className="absolute inset-0 w-full h-full"
                style={{ objectFit: "fill" }}
              />
              {hasCropFrame && (
                <CropBoxOverlay
                  box={activeCropMode === "climber" ? climberCrop : orbCrop}
                  onChange={activeCropMode === "climber" ? setClimberCrop : setOrbCrop}
                />
              )}
            </div>
          </div>

          {/* Controls */}
          {hasCropFrame && (
            <div className="flex items-center gap-3 px-4 py-3 border-t border-edge/40 bg-surface-alt/80 backdrop-blur">
              <button
                onClick={handleFsPlayPause}
                className="shrink-0 rounded p-1 text-fg-secondary transition hover:text-fg"
                aria-label={fsIsPlaying ? "Pause" : "Play"}
              >
                {fsIsPlaying ? (
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
                value={fsVideoCurrentTime}
                onChange={handleFsSeek}
                className="flex-1 accent-accent"
                aria-label="Video progress"
              />
              <span className="shrink-0 font-mono text-xs text-fg-secondary">
                {formatVideoTime(fsVideoCurrentTime)} / {formatVideoTime(videoDuration)}
              </span>
            </div>
          )}
        </div>,
        document.body,
      )}

      {/* ── Route photo fullscreen portal ── */}
      {routePhotoFullscreen && routePhotoPreviewUrl && createPortal(
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-surface"
          role="dialog"
          aria-modal="true"
          aria-label="Route photo crop — fullscreen"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-edge/40 bg-surface-alt/80 backdrop-blur">
            <p className="text-sm font-medium text-fg">Route photo — adjust ORB crop region</p>
            <button
              onClick={() => setRoutePhotoFullscreen(false)}
              className="rounded-lg border border-edge/50 bg-card/60 p-1.5 text-fg-muted hover:border-edge-hover hover:text-fg transition"
              aria-label="Close fullscreen (Escape)"
              title="Close fullscreen (Esc)"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L3 3m0 0h6m-6 0V9M15 9l6-6m0 0v6m0-6h-6M9 15l-6 6m0 0h6m-6 0v-6M15 15l6 6m0 0v-6m0 6h-6" />
              </svg>
            </button>
          </div>

          {/* Image area */}
          <div className="flex-1 relative overflow-hidden flex items-center justify-center px-4 py-4 min-h-0">
            <div
              className="relative overflow-hidden rounded-xl border border-edge/40"
              style={fsMediaContainerStyle(routePhotoNaturalSize.w, routePhotoNaturalSize.h)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={routePhotoPreviewUrl}
                alt="Route photo preview"
                className="absolute inset-0 w-full h-full"
                style={{ objectFit: "fill" }}
              />
              <CropBoxOverlay
                box={routePhotoCrop}
                onChange={setRoutePhotoCrop}
              />
            </div>
          </div>

          {/* Apply button */}
          {!routeMatchTriggered && (
            <div className="flex justify-center gap-3 px-4 py-3 border-t border-edge/40 bg-surface-alt/80 backdrop-blur">
              <button
                onClick={() => { setRoutePhotoFullscreen(false); handleApplyRouteMatch(); }}
                className="flex items-center justify-center gap-2 rounded-xl bg-accent px-8 py-3 text-sm font-semibold text-surface shadow-lg shadow-accent/20 transition-all duration-200 hover:bg-accent-hover hover:shadow-accent/30 ring-2 ring-accent/30 ring-offset-2 ring-offset-surface active:scale-[0.98]"
              >
                Apply &amp; View
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}

      {/* Map picker modal */}
      {showMapPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6">
          <div className="w-full max-w-2xl rounded-2xl border border-edge/50 bg-surface p-5 shadow-2xl animate-scale-in">
            <h2 className="mb-3 text-sm font-semibold text-fg">Pick climb location on map</h2>
            <MapPicker
              initialLat={coordinates?.lat}
              initialLng={coordinates?.lng}
              onConfirm={(lat, lng) => {
                setCoordinates({ lat, lng });
                setShowMapPicker(false);
              }}
              onCancel={() => setShowMapPicker(false)}
            />
          </div>
        </div>
      )}

      {/* Bottom sheet — metadata entry for save / upload */}
      {showBottomSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowBottomSheet(false)} />

          {/* Sheet */}
          <div className="animate-slide-up relative w-full max-w-lg rounded-t-2xl border border-b-0 border-edge/50 bg-surface px-6 pb-8 pt-5 shadow-2xl max-h-[85vh] overflow-y-auto">
            {/* Close / drag handle */}
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-fg">
                {bottomSheetAction === "save" ? "Save to Device" : "Upload"}
              </h2>
              <button
                onClick={() => setShowBottomSheet(false)}
                className="rounded-full p-1 text-fg-muted hover:text-fg transition"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col gap-4">
              {/* Location */}
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-fg-secondary">Location</p>
                <ComboInput
                  label="State / Region"
                  value={state}
                  onChange={handleStateChange}
                  suggestions={stateSuggestions}
                  placeholder="e.g. Colorado"
                />
                <ComboInput
                  label="Area"
                  value={area}
                  onChange={handleAreaChange}
                  suggestions={areaSuggestions}
                  placeholder="e.g. Red Rocks"
                />
                <ComboInput
                  label="Route"
                  value={route}
                  onChange={handleRouteChange}
                  suggestions={routeSuggestions}
                  placeholder="e.g. The Classic"
                />

                {/* GPS */}
                <div className="flex flex-col gap-2 pt-1">
                  <p className="text-xs font-medium text-fg-secondary">GPS Coordinates</p>
                  {coordinates ? (
                    <div className="flex items-center justify-between rounded-lg border border-success/40 bg-success/10 px-3 py-2">
                      <span className="text-xs text-success font-mono">
                        {coordinates.lat.toFixed(5)}, {coordinates.lng.toFixed(5)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCoordinates(null)}
                        className="ml-2 text-xs text-fg-muted hover:text-red-400 transition"
                        aria-label="Clear coordinates"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-fg-muted">No coordinates tagged.</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleUseGPS}
                      disabled={geoLoading}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-edge bg-inset px-2 py-1.5 text-xs text-fg-secondary transition hover:border-accent/60 hover:text-fg disabled:opacity-50"
                    >
                      {geoLoading ? (
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-edge border-t-accent" />
                      ) : (
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="12" cy="12" r="3"/>
                          <path strokeLinecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                        </svg>
                      )}
                      Use GPS
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowBottomSheet(false); setShowMapPicker(true); }}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-edge bg-inset px-2 py-1.5 text-xs text-fg-secondary transition hover:border-accent/60 hover:text-fg"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                      Pick on map
                    </button>
                  </div>
                </div>
              </div>

              {/* Climb type */}
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-fg-secondary">Climb type</p>
                <div className="flex gap-2">
                  {(["attempt", "send"] as RunType[]).map(t => (
                    <button
                      key={t}
                      onClick={() => setRunType(t)}
                      className={[
                        "flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition capitalize",
                        runType === t
                          ? t === "send"
                            ? "border-success/60 bg-success/10 text-success"
                            : "border-accent/60 bg-accent/10 text-accent"
                          : "border-edge bg-inset text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
                      ].join(" ")}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Details */}
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-fg-secondary">Details <span className="text-fg-muted font-normal">(optional)</span></p>
                <input
                  type="text"
                  value={rating}
                  onChange={e => setRating(e.target.value)}
                  placeholder="Grade / Rating (e.g. V3, 5.10a)"
                  className="rounded-xl border border-edge bg-inset px-3 py-2 text-sm text-fg outline-none transition placeholder:text-fg-placeholder focus:border-accent/60"
                />
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Notes…"
                  rows={2}
                  className="rounded-xl border border-edge bg-inset px-3 py-2 text-sm text-fg outline-none transition placeholder:text-fg-placeholder focus:border-accent/60 resize-none"
                />
              </div>

              {showLocationWarning && (
                <p className="rounded-xl border border-amber-800/60 bg-amber-950/40 px-4 py-2.5 text-xs text-amber-400">
                  Enter State/Region, Area, and Route before uploading.
                </p>
              )}
              {saveError && <p className="text-xs text-red-400">{saveError}</p>}

              {/* Action button */}
              <button
                onClick={bottomSheetAction === "save" ? handleSaveToDevice : handleSaveToS3}
                disabled={bottomSheetAction === "upload" && s3Status === "loading"}
                className="flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3.5 text-sm font-semibold text-surface shadow-lg shadow-accent/20 transition-all duration-200 hover:bg-accent-hover hover:shadow-accent/30 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
              >
                {bottomSheetAction === "save" ? (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Save to device
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                    </svg>
                    {s3Status === "loading" ? "Uploading\u2026" : "Upload"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
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
