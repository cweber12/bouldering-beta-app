"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { cn } from "@/utils/cn";
import LoadingGate from "@/components/shared/LoadingGate";

import { type CropFraction, DEFAULT_CROP } from "@/components/shared/CropBoxOverlay";
import ComboInput from "@/components/shared/ComboInput";
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
import StepPickVideo from "@/components/scan/process-flow/StepPickVideo";
import StepSetDetection from "@/components/scan/process-flow/StepSetDetection";
import StepViewLandmarks from "@/components/scan/process-flow/StepViewLandmarks";
import StepMatchRoutePhoto from "@/components/scan/process-flow/StepMatchRoutePhoto";

type ScanStep = "pick" | "detection" | "landmarks" | "match";

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
// Module-level cache � survives component unmount so state persists when
// the user navigates away from the upload page and returns.
// ---------------------------------------------------------------------------
let cachedPendingFile: File | null = null;
let cachedVideoUrl: string | null = null;

// ---------------------------------------------------------------------------
// Upload page inner
// ---------------------------------------------------------------------------

function UploadPageInner() {
  const { cv } = useOpenCV();

  // Model selection state � MediaPipe only
  const [modelVariant, setModelVariant] = useState<MediaPipeVariant>("lite");
  const { model } = usePoseModel({ backend: "mediapipe", variant: modelVariant });
  const { process, status, orbStatus, currentFrame, totalFrames, attemptId, errorMessage } =
    useVideoProcessor(100);
  const { uploadAttempt, listPrefixes, listAttempts, userPrefix, status: s3Status } = useS3Storage();
  const { matchImage, reset: resetMatcher, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();

  const [state, setState] = useState("");
  const [area,  setArea]  = useState("");
  const [route, setRoute] = useState("");
  const [runType, setRunType] = useState<RunType>("attempt");
  const [rating, setRating] = useState("");
  const [notes, setNotes] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(() => cachedPendingFile);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(() => cachedVideoUrl);
  const [frameStep, setFrameStep] = useState(5);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [s3Saved, setS3Saved] = useState(false);
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

  // Edit-mode flag � set when user clicks "Edit climb" from results.
  const [editMode, setEditMode] = useState(false);

  // Skeleton style for overlays
  const [skeletonStyle, setSkeletonStyle] = useState<SkeletonStyle>({ lineWidth: 2.5, pointRadius: 5 });

  // On-demand video export state
  const [exportStatus, setExportStatus] = useState<"idle" | "rendering" | "done">("idle");
  const [exportProgress, setExportProgress] = useState(0);
  const styleRef = useRef<SkeletonStyle>({ lineWidth: 2.5, pointRadius: 5 });

  const [climberCrop, setClimberCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [orbCrop, setOrbCrop] = useState<CropFraction>(DEFAULT_CROP);

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
  // No homography needed � this is for the first-frame landmark preview.
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
          onExportVideo={handleExportUploadVideo}
          onChangePhoto={(file: File) => {
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

      {/* -- Map picker modal -- */}
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

      {/* -- Bottom sheet � metadata entry for save / upload -- */}
      {showBottomSheet && createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowBottomSheet(false)} />

          {/* Sheet */}
          <div className="animate-slide-up relative w-full max-w-lg rounded-t-2xl border border-b-0 border-edge/50 bg-surface px-6 pb-8 pt-5 shadow-2xl max-h-[85vh] overflow-y-auto">
            {/* Close handle */}
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
                    <div className="flex items-center justify-between rounded-lg border border-send/40 bg-send-surface px-3 py-2">
                      <span className="text-xs text-send font-mono">
                        {coordinates.lat.toFixed(5)}, {coordinates.lng.toFixed(5)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCoordinates(null)}
                        className="ml-2 text-xs text-fg-muted hover:text-danger transition"
                        aria-label="Clear coordinates"
                      >
                        ?
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
                      className={cn(
                        "flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition capitalize",
                        runType === t
                          ? t === "send"
                            ? "border-send/60 bg-send-surface text-send"
                            : "border-attempt/60 bg-attempt-surface text-attempt"
                          : "border-edge bg-inset text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
                      )}
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
                  placeholder="Notes\u2026"
                  rows={2}
                  className="rounded-xl border border-edge bg-inset px-3 py-2 text-sm text-fg outline-none transition placeholder:text-fg-placeholder focus:border-accent/60 resize-none"
                />
              </div>

              {showLocationWarning && (
                <p className="rounded-xl border border-caution-border bg-caution-surface px-4 py-2.5 text-xs text-caution">
                  Enter State/Region, Area, and Route before uploading.
                </p>
              )}
              {saveError && <p className="text-xs text-danger">{saveError}</p>}

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
        </div>,
        document.body,
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
