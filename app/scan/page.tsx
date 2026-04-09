"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import LoadingGate from "@/components/shared/LoadingGate";

import { DEFAULT_CROP, type CropFraction } from "@/components/shared/CropBoxOverlay";
import { useOpenCV } from "@/hooks/useOpenCV";
import { usePoseModel, type MediaPipeVariant } from "@/hooks/usePoseModel";
import { useVideoProcessor } from "@/hooks/useVideoProcessor";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { useSkeletonFrames } from "@/hooks/useSkeletonFrames";
import { useS3Storage } from "@/hooks/useS3Storage";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useGeocoding } from "@/hooks/useGeocoding";
import { getAttempt } from "@/storage/sessionStore";
import type { RouteAttempt, RunType } from "@/storage/sessionStore";
import { sanitizeDirName, serializeAttemptForJson } from "@/utils/fsHelpers";
import { type SkeletonStyle } from "@/pipeline/skeletonOverlay";
import type { RenderedSkeletonFrame } from "@/pipeline/skeletonRenderer";
import { renderPoseVideo } from "@/pipeline/poseVideoRenderer";
import { getTopology } from "@/utils/poseConstants";
import CameraRecorderModal from "@/components/shared/CameraRecorderModal";
import StepPickVideo from "@/components/scan/process-flow/StepPickVideo";
import StepSetDetection from "@/components/scan/process-flow/StepSetDetection";
import StepViewLandmarks from "@/components/scan/process-flow/StepViewLandmarks";
import StepMatchRoutePhoto from "@/components/scan/process-flow/StepMatchRoutePhoto";
import MetadataBottomSheet, {
  type MetadataSheetLocation,
  type MetadataSheetRunDetails,
  type MetadataSheetActions,
} from "@/components/scan/modals/MetadataBottomSheet";
import MapPickerModal from "@/components/scan/modals/MapPickerModal";

type ScanStep = "pick" | "detection" | "landmarks" | "match";

// ---------------------------------------------------------------------------
// RouteData folder name
// ---------------------------------------------------------------------------
const BETA_FOLDER = "RouteData";
const SESSION_KEY = "bouldering_last_attempt_id";

// Module-level cached state — survives re-renders and fast-refresh.
// These are intentionally outside React so the video file and preview URL
// are not lost when the user navigates away from the scan page and returns.
let cachedRootHandle: FileSystemDirectoryHandle | null = null;
let cachedPendingFile: File | null = null;
let cachedVideoUrl: string | null = null;

// ---------------------------------------------------------------------------
// File-system helpers
// ---------------------------------------------------------------------------
async function acquireRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (cachedRootHandle) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let perm = await (cachedRootHandle as any).queryPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      perm = await (cachedRootHandle as any).requestPermission({ mode: "readwrite" });
    }
    if (perm === "granted") return cachedRootHandle;
    cachedRootHandle = null;
  }
  if (!("showDirectoryPicker" in window)) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cachedRootHandle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
    return cachedRootHandle;
  } catch {
    return null;
  }
}

async function saveAttemptToDevice(
  attempt: RouteAttempt,
): Promise<FileSystemDirectoryHandle | null> {
  const root = await acquireRootHandle();
  if (!root) {
    // Fall back to a plain download when the File System Access API is
    // unavailable (e.g. Firefox, iOS Safari).
    const json = serializeAttemptForJson(attempt);
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${attempt.id}-${attempt.runType ?? "attempt"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return null;
  }

  const state = sanitizeDirName(attempt.state ?? "unknown_state");
  const area  = sanitizeDirName(attempt.area  ?? "unknown_area");
  const route = sanitizeDirName(attempt.route ?? "unknown_route");

  const betaDir  = await root.getDirectoryHandle(BETA_FOLDER, { create: true });
  const stateDir = await betaDir.getDirectoryHandle(state, { create: true });
  const areaDir  = await stateDir.getDirectoryHandle(area,  { create: true });
  const routeDir = await areaDir.getDirectoryHandle(route,  { create: true });

  const json = serializeAttemptForJson(attempt);
  const fileName = `${attempt.id}-${attempt.runType ?? "attempt"}.json`;
  const fileHandle = await routeDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(json, null, 2));
  await writable.close();

  return routeDir;
}

// ---------------------------------------------------------------------------
// ScanPageInner
// ---------------------------------------------------------------------------

function ScanPageInner() {
  const { cv } = useOpenCV();

  // Model selection state — MediaPipe only
  const [modelVariant, setModelVariant] = useState<MediaPipeVariant>("lite");
  const { model } = usePoseModel({ backend: "mediapipe", variant: modelVariant });
  const { process, status, orbStatus, currentFrame, totalFrames, attemptId, errorMessage } =
    useVideoProcessor(100);
  const { uploadAttempt, listPrefixes, listAttempts, userPrefix, status: s3Status } = useS3Storage();
  const { matchImage, reset: resetMatcher, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();

  const [state, setState]   = useState("");
  const [area,  setArea]    = useState("");
  const [route, setRoute]   = useState("");
  const [runType, setRunType]   = useState<RunType>("attempt");
  const [rating, setRating]     = useState("");
  const [notes, setNotes]       = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(() => cachedPendingFile);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(() => cachedVideoUrl);
  const [frameStep, setFrameStep] = useState(5);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [s3Saved, setS3Saved]   = useState(false);
  const [locationWarning, setLocationWarning] = useState(false);
  const [savedRouteDirHandle, setSavedRouteDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [conditions, setConditions] = useState<Set<string>>(new Set());
  const [showCamera, setShowCamera] = useState(false);
  const previewUrlRef = useRef<string | null>(cachedVideoUrl);

  // Step-based navigation — always start fresh
  const [step, setStep] = useState<ScanStep>("pick");

  // First-frame image for animated landmark preview (FramePlayer background)
  const [firstFrameFile, setFirstFrameFile] = useState<File | null>(null);

  // Inline route photo overlay state
  const [routePhotoFile, setRoutePhotoFile] = useState<File | null>(null);
  const [routePhotoPreviewUrl, setRoutePhotoPreviewUrl] = useState<string | null>(null);
  const routePhotoPreviewUrlRef = useRef<string | null>(null);
  const [routePhotoCrop, setRoutePhotoCrop] = useState<CropFraction>({ x: 0, y: 0, w: 1, h: 1 });
  const [routeMatchTriggered, setRouteMatchTriggered] = useState(false);

  // Edit-mode flag — set when user clicks "Edit climb" from results.
  const [editMode, setEditMode] = useState(false);

  // Skeleton style for overlays
  const [skeletonStyle, setSkeletonStyle] = useState<SkeletonStyle>({ lineWidth: 2.5, pointRadius: 5 });

  // On-demand video export state
  const [exportStatus, setExportStatus] = useState<"idle" | "rendering" | "done">("idle");
  const [exportProgress, setExportProgress] = useState(0);
  const styleRef = useRef<SkeletonStyle>({ lineWidth: 2.5, pointRadius: 5 });

  const [climberCrop, setClimberCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [orbCrop, setOrbCrop]         = useState<CropFraction>(DEFAULT_CROP);

  // Bottom sheet for metadata entry (triggered by save/upload buttons)
  const [showBottomSheet, setShowBottomSheet] = useState(false);
  const [bottomSheetAction, setBottomSheetAction] = useState<"save" | "upload">("save");

  // Derive topology-aware skeleton style
  const activeAttemptId0 = (status === "done") ? attemptId : null;
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
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const { request: geoRequest, loading: geoLoading } = useGeolocation();
  const { reverseGeocode } = useGeocoding();

  // S3-backed suggestions for location fields
  const [stateSuggestions, setStateSuggestions]   = useState<string[]>([]);
  const [areaSuggestions, setAreaSuggestions]     = useState<string[]>([]);
  const [routeSuggestions, setRouteSuggestions]   = useState<string[]>([]);

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

  const progressPct  = totalFrames > 0 ? Math.round((currentFrame / totalFrames) * 100) : 0;
  const isProcessing = status === "processing";
  const isDone       = status === "done";
  const orbReady     = orbStatus === "ready";

  // Active attempt — only from the current scan session
  const activeAttemptId = isDone ? attemptId : null;
  const activeAttempt   = activeAttemptId ? (getAttempt(activeAttemptId) ?? null) : null;

  // Cache file and URL in module scope so state survives re-renders.
  useEffect(() => { cachedPendingFile = pendingFile; }, [pendingFile]);
  useEffect(() => { cachedVideoUrl = videoPreviewUrl; }, [videoPreviewUrl]);

  // Cleanup on unmount — clear session and cached state so the next visit starts fresh.
  useEffect(() => {
    return () => {
      try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
      cachedPendingFile = null;
      cachedVideoUrl = null;
      if (routePhotoPreviewUrlRef.current) URL.revokeObjectURL(routePhotoPreviewUrlRef.current);
      if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    };
  }, []);

  // Capture first video frame as a File for the animated landmark preview.
  useEffect(() => {
    if (step !== "landmarks" || !activeAttempt || !videoPreviewUrl) return;
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
  }, [step, activeAttemptId, videoPreviewUrl]);

  // Build animated skeleton frames from all pose frames in video-pixel space.
  const firstFrameSkeletonData = useMemo(() => {
    if (!activeAttempt) return null;
    const { frames, videoMeta } = activeAttempt;
    if (!frames.length) return null;
    const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);
    const firstTs = sorted[0].timestamp;
    const lastTs  = sorted[sorted.length - 1].timestamp;
    const duration = Math.max(lastTs - firstTs, 0.1);
    const renderedFrames: RenderedSkeletonFrame[] = sorted.map(f => ({
      timestamp: f.timestamp - firstTs,
      keypoints: Object.fromEntries(
        f.keypoints.map(kp => [kp.name, { x: kp.x * videoMeta.width, y: kp.y * videoMeta.height }])
      ),
    }));
    return { frames: renderedFrames, duration, fps: videoMeta.fps ?? 30 };
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
    setS3Saved(false);
    setSaveError(null);
    setSavedRouteDirHandle(null);
    setEditMode(false);
    setFirstFrameFile(null);
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

  function handleApplyRouteMatch() {
    if (!routePhotoFile || !cv || !activeAttemptId) return;
    setRouteMatchTriggered(true);
    matchImage(routePhotoFile, activeAttemptId, cv, routePhotoCrop);
  }

  // ---- Step navigation handlers ----

  function handleSelectFile(file: File) {
    loadVideoFile(file);
    setStep("detection");
  }

  function handleScan(startTime: number) {
    if (!pendingFile || !model || !cv) return;
    setEditMode(false);
    setFirstFrameFile(null);
    clearRoutePhoto();
    process(pendingFile, model, cv, frameStep, {
      state, area, route, runType,
      rating: rating || undefined,
      notes: notes || undefined,
    }, { climberCrop, orbCrop, conditions }, startTime);
    setStep("landmarks");
  }

  function handleViewOnRoutePhoto(file: File) {
    resetMatcher();
    setRoutePhotoWithPreview(file);
    setRoutePhotoCrop({ x: 0, y: 0, w: 1, h: 1 });
    setRouteMatchTriggered(false);
    setStep("match");
  }

  function handleEditClimb() {
    setEditMode(true);
    setFirstFrameFile(null);
    clearRoutePhoto();
    setStep("detection");
  }

  function handleBackToResults() {
    setEditMode(false);
    setStep("landmarks");
  }

  function handleBackToLandmarks() {
    clearRoutePhoto();
    setStep("landmarks");
  }

  function handleSaveComplete() {
    setShowBottomSheet(false);
    setStep("pick");
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    setVideoPreviewUrl(null);
    setPendingFile(null);
    setFirstFrameFile(null);
    setEditMode(false);
    cachedPendingFile = null;
    cachedVideoUrl = null;
    clearRoutePhoto();
    try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* quota */ }
  }

  const handleExportVideo = useCallback(async () => {
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
      console.error("[ScanPage] Video export failed:", err);
      setExportStatus("idle");
    }
  }, [cv, routePhotoFile, activeAttemptId, matchResult]);

  const isFrameReady = frameStatus === "ready" && !!skeletonData;
  const isMatching   = matchStatus === "matching";

  async function handleSaveToDevice() {
    if (!activeAttemptId) return;
    const attempt = getAttempt(activeAttemptId);
    if (!attempt) return;
    setSaveError(null);
    try {
      const routeDir = await saveAttemptToDevice(attempt);
      setSavedRouteDirHandle(routeDir);
      handleSaveComplete();
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
      handleSaveComplete();
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

  // ---------------------------------------------------------------------------
  // Grouped props for MetadataBottomSheet
  // ---------------------------------------------------------------------------
  const sheetLocation: MetadataSheetLocation = {
    state,
    area,
    route,
    stateSuggestions,
    areaSuggestions,
    routeSuggestions,
    coordinates,
  };

  const sheetRunDetails: MetadataSheetRunDetails = { runType, rating, notes };

  const sheetActions: MetadataSheetActions = {
    onStateChange: handleStateChange,
    onAreaChange: handleAreaChange,
    onRouteChange: handleRouteChange,
    onClearCoordinates: () => setCoordinates(null),
    onUseGPS: handleUseGPS,
    onOpenMapPicker: () => { setShowBottomSheet(false); setShowMapPicker(true); },
    onRunTypeChange: setRunType,
    onRatingChange: setRating,
    onNotesChange: setNotes,
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* -- Step content -- */}
      {step === "pick" && (
        <StepPickVideo
          onFile={handleSelectFile}
          onCamera={() => setShowCamera(true)}
        />
      )}

      {step === "detection" && pendingFile && videoPreviewUrl && (
        <StepSetDetection
          videoPreviewUrl={videoPreviewUrl}
          climberCrop={climberCrop}
          onClimberCropChange={setClimberCrop}
          orbCrop={orbCrop}
          onOrbCropChange={setOrbCrop}
          conditions={conditions}
          onConditionToggle={toggleCondition}
          modelVariant={modelVariant}
          onModelVariantChange={setModelVariant}
          frameStep={frameStep}
          onFrameStepChange={setFrameStep}
          canScan={!!(model && cv)}
          onScan={handleScan}
          editMode={editMode}
          onBackToResults={handleBackToResults}
        />
      )}

      {step === "landmarks" && (
        <StepViewLandmarks
          isProcessing={isProcessing}
          currentFrame={currentFrame}
          totalFrames={totalFrames}
          progressPct={progressPct}
          orbStatus={orbStatus}
          frameStep={frameStep}
          processingError={status === "error" ? errorMessage : null}
          activeAttempt={activeAttempt}
          firstFrameFile={firstFrameFile}
          firstFrameSkeletonData={firstFrameSkeletonData}
          topoStyle={topoStyle}
          onSkeletonStyleChange={setSkeletonStyle}
          orbReady={orbReady}
          onViewOnRoutePhoto={handleViewOnRoutePhoto}
          onEditClimb={handleEditClimb}
          onChooseVideo={handleSelectFile}
          onTakeVideo={() => setShowCamera(true)}
          onSaveToDevice={handleOpenSaveSheet}
          onUpload={handleOpenUploadSheet}
          s3Saved={s3Saved}
          s3Loading={s3Status === "loading"}
          savedRouteDirHandle={savedRouteDirHandle}
          onDeleteFromDevice={handleDeleteFromDevice}
          saveError={saveError}
        />
      )}

      {step === "match" && routePhotoFile && routePhotoPreviewUrl && (
        <StepMatchRoutePhoto
          routePhotoFile={routePhotoFile}
          routePhotoPreviewUrl={routePhotoPreviewUrl}
          routePhotoCrop={routePhotoCrop}
          onRoutePhotoCropChange={setRoutePhotoCrop}
          routeMatchTriggered={routeMatchTriggered}
          matchResult={matchResult}
          matchStatus={matchStatus}
          matchError={matchError}
          skeletonData={skeletonData}
          frameStatus={frameStatus}
          frameError={frameError}
          topoStyle={topoStyle}
          isFrameReady={isFrameReady}
          isMatching={isMatching}
          onSkeletonStyleChange={setSkeletonStyle}
          exportStatus={exportStatus}
          exportProgress={exportProgress}
          onApplyMatch={handleApplyRouteMatch}
          onExportVideo={handleExportVideo}
          onChangePhoto={(file) => {
            resetMatcher();
            setRoutePhotoWithPreview(file);
            setRoutePhotoCrop({ x: 0, y: 0, w: 1, h: 1 });
            setRouteMatchTriggered(false);
          }}
          onBack={handleBackToLandmarks}
          onSaveToDevice={handleOpenSaveSheet}
          onUpload={handleOpenUploadSheet}
          s3Saved={s3Saved}
          s3Loading={s3Status === "loading"}
          savedRouteDirHandle={savedRouteDirHandle}
          onDeleteFromDevice={handleDeleteFromDevice}
          saveError={saveError}
        />
      )}

      {/* Camera recording modal */}
      {showCamera && (
        <CameraRecorderModal
          onCapture={(file) => { handleSelectFile(file); setShowCamera(false); }}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* Map picker modal */}
      <MapPickerModal
        open={showMapPicker}
        initialLat={coordinates?.lat}
        initialLng={coordinates?.lng}
        onConfirm={(lat, lng) => { setCoordinates({ lat, lng }); setShowMapPicker(false); }}
        onClose={() => setShowMapPicker(false)}
      />

      {/* Metadata bottom sheet — for save / upload */}
      <MetadataBottomSheet
        open={showBottomSheet}
        onClose={() => setShowBottomSheet(false)}
        action={bottomSheetAction}
        location={sheetLocation}
        geoLoading={geoLoading}
        runDetails={sheetRunDetails}
        actions={sheetActions}
        showLocationWarning={showLocationWarning}
        saveError={saveError}
        s3Loading={s3Status === "loading"}
        onConfirm={bottomSheetAction === "save" ? handleSaveToDevice : handleSaveToS3}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScanPage (exported default)
// ---------------------------------------------------------------------------
export default function ScanPage() {
  return (
    <LoadingGate>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-fg-secondary">
            Loading&#8230;
          </div>
        }
      >
        <ScanPageInner />
      </Suspense>
    </LoadingGate>
  );
}
