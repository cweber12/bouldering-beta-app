"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LoadingGate from "@/components/layout/LoadingGate";
import ToolPageShell from "@/components/layout/ToolPageShell";
/* CONSTANTS */
import { DEFAULT_CROP, type CropFraction } from "@/utils/cropFraction";
/* HOOKS */
import { useOpenCV } from "@/hooks/useOpenCV";
import { usePoseModel, type MediaPipeVariant } from "@/hooks/usePoseModel";
import { DEFAULT_TIER, getTierConfig, type QualityTier } from "@/utils/poseTiers";
import { useVideoProcessor } from "@/hooks/useVideoProcessor";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { useSkeletonFrames } from "@/hooks/useSkeletonFrames";
import { useHolds } from "@/hooks/useHolds";
import { useContrastAdjust } from "@/hooks/useContrastAdjust";
import { paletteContrastIsPoor } from "@/pipeline/overlay/contrastAdapter";
import { useS3Storage } from "@/hooks/useS3Storage";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useGeocoding } from "@/hooks/useGeocoding";
import { getAttempt } from "@/storage/sessionStore";
import type { RouteAttempt, RunType } from "@/storage/sessionStore";
import { sanitizeDirName, serializeAttemptForJson } from "@/utils/fsHelpers";
import { type SkeletonStyle } from "@/pipeline/overlay/skeletonOverlay";
import type { HoldStyle } from "@/pipeline/holds/holdsOverlay";
import type { RenderedSkeletonFrame } from "@/pipeline/overlay/skeletonRenderer";
import { renderPoseVideo } from "@/pipeline/render/poseVideoRenderer";
import { deriveTapCrop } from "@/pipeline/tracking/tapCropDetection";
import { frameClampCrop, defaultRouteAroundClimber } from "@/utils/cropContainment";
import { getTopology } from "@/utils/poseConstants";
import CameraRecorderModal from "@/components/capture/CameraRecorderModal";
import StepPickVideo from "@/components/scan/process-flow/StepPickVideo";
import StepSetDetection from "@/components/scan/process-flow/StepSetDetection";
import StepViewLandmarks from "@/components/scan/process-flow/StepViewLandmarks";
import StepMatchRoutePhoto from "@/components/scan/process-flow/StepMatchRoutePhoto";
import ScanLoadingBar from "@/components/scan/process-flow/ScanLoadingBar";
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
// Climber / Wall crop helpers (fraction space)
// ---------------------------------------------------------------------------

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Soft-fallback Climber box when click-time detection finds no pose: a modest
 * portrait box around the tap, clamped to the frame. Smaller than the old fixed
 * seed so it does not over-cover; the scan re-acquires the real extent anyway.
 */
function defaultClimberBox(point: { x: number; y: number }): CropFraction {
  const w = 0.25;
  const h = 0.55;
  return {
    x: clamp01(point.x - w / 2),
    y: clamp01(point.y - h / 2),
    w: Math.min(w, 1 - clamp01(point.x - w / 2)),
    h: Math.min(h, 1 - clamp01(point.y - h / 2)),
  };
}

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
  const router = useRouter();

  // Quality tier is the primary detection control; it seeds the model variant,
  // frame step, and maxPoses. The advanced panel can override variant/frameStep.
  const [tier, setTier] = useState<QualityTier>(DEFAULT_TIER);
  const [modelVariant, setModelVariant] = useState<MediaPipeVariant>(getTierConfig(DEFAULT_TIER).variant);
  const [maxPoses, setMaxPoses] = useState(getTierConfig(DEFAULT_TIER).maxPoses);
  const poseModelConfig = useMemo(
    () => ({ backend: "mediapipe" as const, variant: modelVariant, maxPoses }),
    [modelVariant, maxPoses],
  );
  const { model } = usePoseModel(poseModelConfig);
  const { process, reset: resetProcessor, status, orbStatus, currentFrame, totalFrames, attemptId, firstFrameFile, errorMessage, scanDiagnostics } =
    useVideoProcessor(100);
  const { uploadAttempt, listPrefixes, listAttempts, userPrefix, status: s3Status } = useS3Storage();
  const { matchImage, estimateCrop, autoFrameStatus, reset: resetMatcher, status: matchStatus, result: matchResult, errorMessage: matchError, matchDiagnostics } =
    useImageMatcher();

  const [state, setState]   = useState("");
  const [area,  setArea]    = useState("");
  const [route, setRoute]   = useState("");
  const [runType, setRunType]   = useState<RunType>("attempt");
  const [rating, setRating]     = useState("");
  const [notes, setNotes]       = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(() => cachedPendingFile);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(() => cachedVideoUrl);
  const [frameStep, setFrameStep] = useState(getTierConfig(DEFAULT_TIER).frameStep);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [s3Saved, setS3Saved]   = useState(false);
  const [locationWarning, setLocationWarning] = useState(false);
  const [savedRouteDirHandle, setSavedRouteDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const previewUrlRef = useRef<string | null>(cachedVideoUrl);

  // Step-based navigation — always start fresh
  const [step, setStep] = useState<ScanStep>("pick");

  // First-frame image for the Detection Preview background is produced by
  // useVideoProcessor during the seek loop (see `firstFrameFile` above) — no
  // separate decode here.

  // Inline route photo overlay state
  const [routePhotoFile, setRoutePhotoFile] = useState<File | null>(null);
  const [routePhotoPreviewUrl, setRoutePhotoPreviewUrl] = useState<string | null>(null);
  const routePhotoPreviewUrlRef = useRef<string | null>(null);
  const [routePhotoCrop, setRoutePhotoCrop] = useState<CropFraction>({ x: 0, y: 0, w: 1, h: 1 });
  const [routeMatchTriggered, setRouteMatchTriggered] = useState(false);
  // True once a preliminary match auto-positioned the crop box over the photo.
  const [autoFramed, setAutoFramed] = useState(false);

  // Skeleton style for overlays — SkeletonStylePanel emits a full style on mount;
  // start from built-in defaults.
  const [skeletonStyle, setSkeletonStyle] = useState<SkeletonStyle>({});
  // Holds overlay style — the Overlay panel emits a full HoldStyle on mount.
  const [holdStyle, setHoldStyle] = useState<HoldStyle>({});
  // Contrast boost — opt-in (off by default). When on, gates backdrop adaptation
  // for both the Skeleton and Holds overlays. Off renders the authored palette.
  const [contrastEnabled, setContrastEnabled] = useState(false);

  // On-demand video export state
  const [exportStatus, setExportStatus] = useState<"idle" | "rendering" | "done">("idle");
  const [exportProgress, setExportProgress] = useState(0);
  const styleRef = useRef<SkeletonStyle>({});

  const [climberCrop, setClimberCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [wallCrop, setWallCrop] = useState<CropFraction>(DEFAULT_CROP);
  // True once the user has hand-adjusted the Wall Crop, so a re-tap does not
  // clobber their framing with the auto climber-expanded region.
  const wallTouchedRef = useRef(false);
  // Normalised point the user tapped to identify the climber (seeds tracking).
  const [climberPoint, setClimberPoint] = useState<{ x: number; y: number } | null>(null);
  // Panning Capture (long route): align per keyframe instead of a single frame-0
  // homography. Opt-in at scan setup; does not replace Fixed Capture.
  const [panning, setPanning] = useState(false);

  // Bottom sheet for metadata entry (triggered by save/upload buttons)
  const [showBottomSheet, setShowBottomSheet] = useState(false);
  const [bottomSheetAction, setBottomSheetAction] = useState<"save" | "upload">("save");
  // Persists the action so we can re-open the sheet after the map picker closes
  const bottomSheetActionRef = useRef<"save" | "upload">("save");

  // Derive topology-aware skeleton style
  const activeAttemptId0 = (status === "done") ? attemptId : null;
  const activeAttempt0 = activeAttemptId0 ? getAttempt(activeAttemptId0) : null;
  // Adaptive contrast — always sample each surface's backdrop luminance band once
  // (memoised by file identity + crop) so we can *detect* poor contrast and offer
  // the opt-in boost. The sampled adjust is only applied when the user turns the
  // boost on (contrastEnabled); otherwise the overlay renders the authored palette.
  //  • post-scan review (Skeleton over the first video frame) → the wall crop.
  //  • route-photo overlay + exported WebM → the whole route photo.
  const wallContrastAdjust = useContrastAdjust(firstFrameFile, wallCrop);
  const routeContrastAdjust = useContrastAdjust(routePhotoFile);

  // Poor-contrast detection drives the panel's one-click prompt.
  const wallContrastPoor = !!wallContrastAdjust && paletteContrastIsPoor(wallContrastAdjust);
  const routeContrastPoor = !!routeContrastAdjust && paletteContrastIsPoor(routeContrastAdjust);

  const baseTopoStyle: SkeletonStyle = useMemo(() => {
    const backend = activeAttempt0?.poseBackend ?? "mediapipe";
    const topo = getTopology(backend);
    return { ...skeletonStyle, skeletonEdges: topo.skeletonEdges, keypointNames: topo.keypointNames };
  }, [skeletonStyle, activeAttempt0]);

  // Per-surface styles: the review step adapts to the wall, the match step (and
  // the exported WebM, via styleRef) adapts to the route photo — only while the
  // boost is enabled.
  const landmarksTopoStyle: SkeletonStyle = useMemo(
    () => ({ ...baseTopoStyle, contrastAdjust: contrastEnabled ? wallContrastAdjust : undefined }),
    [baseTopoStyle, contrastEnabled, wallContrastAdjust],
  );
  const topoStyle: SkeletonStyle = useMemo(
    () => ({ ...baseTopoStyle, contrastAdjust: contrastEnabled ? routeContrastAdjust : undefined }),
    [baseTopoStyle, contrastEnabled, routeContrastAdjust],
  );

  // Holds style with the route-photo adaptation merged in for the overlay pass.
  const topoHoldStyle: HoldStyle = useMemo(
    () => ({ ...holdStyle, contrastAdjust: contrastEnabled ? routeContrastAdjust : undefined }),
    [holdStyle, contrastEnabled, routeContrastAdjust],
  );

  // Keep styleRef in sync
  useEffect(() => { styleRef.current = topoStyle; }, [topoStyle]);

  // Pre-compute skeleton frames for the inline route photo overlay
  const { data: skeletonData, status: frameStatus, errorMessage: frameError } =
    useSkeletonFrames(cv, activeAttemptId0 || null, matchResult);

  // Derive the Holds overlay on the fly from the same pose frames + match result.
  const { holds } = useHolds(cv, activeAttemptId0 || null, matchResult);

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
          .filter(e => e.key.endsWith(".json") && !e.key.endsWith(".data.json") && !e.key.endsWith("/route-image.json"))
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

  // Loading view: shown from the moment Scan is pressed until results are ready —
  // through the seek loop (isProcessing) and the post-loop tail where refinement
  // and ORB extraction still run (status done, ORB not yet resolved). Covering
  // the whole tail avoids a one-tick flash of the empty review step.
  const showScanLoading =
    step === "landmarks" &&
    (isProcessing || (isDone && orbStatus !== "ready" && orbStatus !== "failed"));

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

  // Build animated skeleton frames from all pose frames in video-pixel space.
  // Start from the first frame that has detected keypoints so playback begins
  // at the first real detection rather than showing a blank/frozen window for
  // pre-detection timestamps (which now have empty keypoints after the
  // poseInterpolator fix).
  const firstFrameSkeletonData = useMemo(() => {
    if (!activeAttempt) return null;
    const { frames, videoMeta } = activeAttempt;
    if (!frames.length) return null;
    const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);
    const firstDetected = sorted.find(f => f.keypoints.length > 0);
    if (!firstDetected) return null;
    const firstTs = firstDetected.timestamp;
    const lastTs  = sorted[sorted.length - 1].timestamp;
    const duration = Math.max(lastTs - firstTs, 0.1);
    const renderedFrames: RenderedSkeletonFrame[] = sorted
      .filter(f => f.timestamp >= firstTs)
      .map(f => ({
        timestamp: f.timestamp - firstTs,
        keypoints: Object.fromEntries(
          f.keypoints.map(kp => [kp.name, { x: kp.x * videoMeta.width, y: kp.y * videoMeta.height }])
        ),
      }));
    return { frames: renderedFrames, duration, fps: videoMeta.fps ?? 30 };
  }, [activeAttempt]);

  function loadVideoFile(file: File) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setVideoPreviewUrl(url);
    setPendingFile(file);
    setClimberCrop(DEFAULT_CROP);
    setWallCrop(DEFAULT_CROP);
    wallTouchedRef.current = false;
    setS3Saved(false);
    setSaveError(null);
    setSavedRouteDirHandle(null);
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
    setAutoFramed(false);
    setExportStatus("idle");
    setExportProgress(0);
    resetMatcher();
  }

  /**
   * Set (or change) the route photo, then run a preliminary match to auto-frame
   * the route. On a confident estimate the crop box is positioned over the
   * projected climb area; otherwise it defaults to a visible inset box and the
   * user frames it manually (StepMatchRoutePhoto surfaces the failure hint).
   */
  async function handleSetRoutePhoto(file: File) {
    resetMatcher();
    setRoutePhotoWithPreview(file);
    setRouteMatchTriggered(false);
    setAutoFramed(false);
    // Start from a visible inset box so the crop is grabbable before/without an
    // auto-frame; an estimate overwrites it below.
    setRoutePhotoCrop(DEFAULT_CROP);
    if (cv && activeAttemptId) {
      const estimate = await estimateCrop(file, activeAttemptId, cv);
      if (estimate) {
        setRoutePhotoCrop(estimate.crop);
        setAutoFramed(true);
      }
    }
  }

  function handleApplyRouteMatch() {
    if (!routePhotoFile || !cv || !activeAttemptId) return;
    setRouteMatchTriggered(true);
    matchImage(routePhotoFile, activeAttemptId, cv, routePhotoCrop);
  }

  // ---- Step navigation handlers ----

  function handleSelectFile(file: File) {
    loadVideoFile(file);
    setClimberPoint(null);
    setStep("detection");
  }

  // Selecting a tier seeds the model variant, frame step, and maxPoses.
  // The advanced panel may subsequently override variant/frameStep.
  function handleTierChange(t: QualityTier) {
    setTier(t);
    const cfg = getTierConfig(t);
    setModelVariant(cfg.variant);
    setFrameStep(cfg.frameStep);
    setMaxPoses(cfg.maxPoses);
  }

  // Click-time Climber crop: landmark-derive the box from the tapped frame.
  // Returns false when no pose was found at the tap, so the caller can hint the
  // user to pick a clearer frame; the soft fallback box is set either way so the
  // scan never blocks. The Wall Crop ("Route") is left at the full-frame default
  // (Climber masked out during ORB) so route-photo matching has the most wall
  // texture — a climber-hugging wall crop starves ORB. The User may still shrink
  // it. Mirrors ADR 0013.
  const handleClimberTapDetect = useCallback(
    (frame: ImageData, point: { x: number; y: number }, timestampSec: number): boolean => {
      const derived = model ? deriveTapCrop(model, frame, point, timestampSec) : null;
      const climber = derived ?? defaultClimberBox(point);
      setClimberCrop(climber);
      // Route starts framed around the Climber (inset from the edges, floor
      // trimmed). It is independent of the Climber, so keep the User's own
      // framing untouched if they already sized it (ADR 0016).
      setWallCrop((prev) => (wallTouchedRef.current ? prev : defaultRouteAroundClimber(climber)));
      return derived != null;
    },
    [model],
  );

  // The user dragged the Climber box — it overrides the detection seed region.
  // The Climber and Route are independent, so this leaves the Route alone.
  const handleClimberCropChange = useCallback((c: CropFraction) => {
    setClimberCrop(c);
  }, []);

  // The user dragged the Route box — remember it so a re-tap keeps their framing.
  // The Route is free to be any size (frame-clamped only), independent of the
  // Climber, so the User can trim it down to just the rock face.
  const handleWallCropChange = useCallback((c: CropFraction) => {
    wallTouchedRef.current = true;
    setWallCrop(frameClampCrop(c));
  }, []);

  // Re-tap (point → null) clears the auto-wall lock so the next tap re-derives it.
  const handleClimberPointChange = useCallback((p: { x: number; y: number } | null) => {
    if (p === null) wallTouchedRef.current = false;
    setClimberPoint(p);
  }, []);

  function handleScan(startTime: number) {
    if (!pendingFile || !model || !cv) return;
    clearRoutePhoto();
    const cfg = getTierConfig(tier);
    process(pendingFile, model, cv, frameStep, {
      state, area, route, runType,
      rating: rating || undefined,
      notes: notes || undefined,
    }, { climberCrop, wallCrop, climberPoint: climberPoint ?? undefined, panning }, startTime, "mediapipe", {
      maxRecoveryFrames: cfg.maxRecoveryFrames,
      filterTolerance: cfg.filterTolerance,
      motionThreshold: cfg.motionThreshold,
      refineStride: cfg.refineStride,
    });
    setStep("landmarks");
  }

  // Abort an in-flight scan from the loading view and return to detection so the
  // user can re-frame and try again.
  function handleCancelScan() {
    resetProcessor();
    setStep("detection");
  }

  function handleViewOnRoutePhoto(file: File) {
    setStep("match");
    void handleSetRoutePhoto(file);
  }

  function handleEditClimb() {
    clearRoutePhoto();
    setStep("detection");
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
        targetFps: 30,
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
      setShowBottomSheet(false); // close sheet; success banner shown in StepViewLandmarks
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "S3 upload failed.");
    }
  }

  function handleOpenSaveSheet() {
    setSaveError(null);
    setBottomSheetAction("save");
    bottomSheetActionRef.current = "save";
    setShowBottomSheet(true);
  }

  function handleOpenUploadSheet() {
    setSaveError(null);
    setBottomSheetAction("upload");
    bottomSheetActionRef.current = "upload";
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
      {/* -- Step content (each step renders its own ProcessFlowShell header) -- */}
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
          wallCrop={wallCrop}
          onClimberCropChange={handleClimberCropChange}
          onWallCropChange={handleWallCropChange}
          climberPoint={climberPoint}
          onClimberPointChange={handleClimberPointChange}
          onClimberTapDetect={handleClimberTapDetect}
          tier={tier}
          onTierChange={handleTierChange}
          modelVariant={modelVariant}
          onModelVariantChange={setModelVariant}
          frameStep={frameStep}
          onFrameStepChange={setFrameStep}
          panning={panning}
          onPanningChange={setPanning}
          canScan={!!(model && cv)}
          onScan={handleScan}
          onBack={() => { setStep("pick"); }}
        />
      )}

      {step === "landmarks" && (
        <div className="relative flex h-[calc(100dvh-var(--nav-h))] min-h-0 flex-col">
          <StepViewLandmarks
            isProcessing={isProcessing}
            currentFrame={currentFrame}
            totalFrames={totalFrames}
            orbStatus={orbStatus}
            frameStep={frameStep}
            processingError={status === "error" ? errorMessage : null}
            activeAttempt={activeAttempt}
            sourceVideoUrl={videoPreviewUrl}
            firstFrameFile={firstFrameFile}
            firstFrameSkeletonData={firstFrameSkeletonData}
            topoStyle={landmarksTopoStyle}
            onSkeletonStyleChange={setSkeletonStyle}
            contrastEnabled={contrastEnabled}
            onContrastToggle={setContrastEnabled}
            contrastPoor={wallContrastPoor}
            onEditClimb={handleEditClimb}
            onScanAnother={handleSaveComplete}
            orbReady={orbReady}
            onViewOnRoutePhoto={handleViewOnRoutePhoto}
            onUpload={handleOpenUploadSheet}
            s3Saved={s3Saved}
            s3Loading={s3Status === "loading"}
            saveError={saveError}
            onViewScans={() => router.push("/profile")}
            scanDiagnostics={scanDiagnostics}
          />

          {showScanLoading && (
            <div className="absolute inset-0 z-20 bg-surface/70 backdrop-blur-sm">
              <div className="absolute inset-x-0 top-0">
                <ScanLoadingBar
                  progressPct={progressPct}
                  finishing={!isProcessing || progressPct >= 100}
                />
              </div>

              <div className="flex h-full items-center justify-center px-4">
                <div className="rounded-(--radius-panel) border border-edge/60 bg-surface-alt/90 px-4 py-2 text-sm text-fg-secondary">
                  {!isProcessing || progressPct >= 100
                    ? "Finishing up..."
                    : `Scanning ${progressPct}%`}
                </div>
              </div>

              <button
                type="button"
                onClick={handleCancelScan}
                aria-label="Cancel scan"
                className="absolute right-4 top-4 rounded-md border border-edge/60 bg-surface px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-alt"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {step === "match" && routePhotoFile && routePhotoPreviewUrl && (
        <StepMatchRoutePhoto
          routePhotoFile={routePhotoFile}
          routePhotoPreviewUrl={routePhotoPreviewUrl}
          routePhotoCrop={routePhotoCrop}
          onRoutePhotoCropChange={(c) => { setRoutePhotoCrop(c); setAutoFramed(false); }}
          routeMatchTriggered={routeMatchTriggered}
          autoFramed={autoFramed}
          autoFrameStatus={autoFrameStatus}
          matchResult={matchResult}
          matchStatus={matchStatus}
          matchError={matchError}
          skeletonData={skeletonData}
          frameStatus={frameStatus}
          frameError={frameError}
          topoStyle={topoStyle}
          isFrameReady={isFrameReady}
          isMatching={isMatching}
          holds={holds}
          holdStyle={topoHoldStyle}
          onSkeletonStyleChange={setSkeletonStyle}
          onHoldsStyleChange={setHoldStyle}
          contrastEnabled={contrastEnabled}
          onContrastToggle={setContrastEnabled}
          contrastPoor={routeContrastPoor}
          exportStatus={exportStatus}
          exportProgress={exportProgress}
          onApplyMatch={handleApplyRouteMatch}
          onExportVideo={handleExportVideo}
          onChangePhoto={(file) => { void handleSetRoutePhoto(file); }}
          onBack={handleBackToLandmarks}
          onSaveToDevice={handleOpenSaveSheet}
          onUpload={handleOpenUploadSheet}
          s3Saved={s3Saved}
          s3Loading={s3Status === "loading"}
          savedRouteDirHandle={savedRouteDirHandle}
          onDeleteFromDevice={handleDeleteFromDevice}
          saveError={saveError}
          matchDiagnostics={matchDiagnostics}
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
        onConfirm={(lat, lng) => { setCoordinates({ lat, lng }); setShowMapPicker(false); setBottomSheetAction(bottomSheetActionRef.current); setShowBottomSheet(true); }}
        onClose={() => { setShowMapPicker(false); setBottomSheetAction(bottomSheetActionRef.current); setShowBottomSheet(true); }}
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
      <ToolPageShell>
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-sm text-fg-secondary">
              Loading&#8230;
            </div>
          }
        >
          <ScanPageInner />
        </Suspense>
      </ToolPageShell>
    </LoadingGate>
  );
}
