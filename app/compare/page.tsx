"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import LoadingGate from "@/components/shared/LoadingGate";
import CropBoxOverlay, { type CropFraction } from "@/components/shared/CropBoxOverlay";
import S3RoutePicker from "@/components/shared/S3RoutePicker";
import FramePlayer, { type FramePlayerLayer, type FramePlayerHandle } from "@/components/shared/FramePlayer";
import CameraRecorderModal from "@/components/shared/CameraRecorderModal";
import SkeletonStylePanel from "@/components/shared/SkeletonStylePanel";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { useSkeletonFrames } from "@/hooks/useSkeletonFrames";
import { buildMultiSkeletonFrames } from "@/pipeline/skeletonRenderer";
import { renderMultiPoseVideo } from "@/pipeline/multiPoseVideoRenderer";
import { renderPoseVideo } from "@/pipeline/poseVideoRenderer";
import { getAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";
import { getTopology } from "@/utils/poseConstants";

// ---------------------------------------------------------------------------
// Types / constants
// ---------------------------------------------------------------------------

type ViewMode = "sidebyside" | "overlay";

/**
 * Default limb colors for new slots (hex, accepted by CSS and SkeletonStyle).
 * Each slot index gets a visually distinct color from the start.
 */
const DEFAULT_LIMB_COLORS = ["#00d273", "#38bdf8", "#fb923c", "#c084fc"];
const JOINT_COLOR = "rgba(255,255,255,0.9)";

// ---------------------------------------------------------------------------
// Per-attempt render slot (owns its own hooks)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

interface SlotProps {
  slotIndex: number;
  attempt: RouteAttempt | null;
  imageFile: File | null;
  imageCrop: CropFraction;
  matchTrigger: number;
  cv: CV;
  limbColor: string;
  lineWidth: number;
  pointRadius: number;
  /** When true, the FramePlayer + download are hidden (overlay mode). */
  hidePlayer?: boolean;
  /** When true, the FramePlayer's built-in play button is hidden. */
  hidePlayButton?: boolean;
  /** Ref forwarded to the inner FramePlayer for external play control. */
  playerRef?: React.Ref<FramePlayerHandle>;
  onMatchResult: (idx: number, result: ImageMatchResult | null) => void;
}

function CompareSlot({
  slotIndex,
  attempt,
  imageFile,
  imageCrop,
  matchTrigger,
  cv,
  limbColor,
  lineWidth,
  pointRadius,
  hidePlayer = false,
  hidePlayButton = false,
  playerRef,
  onMatchResult,
}: SlotProps) {
  const { matchImage, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();

  const { data: skeletonData, status: skeletonStatus } = useSkeletonFrames(
    cv,
    attempt?.id ?? null,
    matchResult,
  );

  // Notify parent when match result changes
  useEffect(() => {
    onMatchResult(slotIndex, matchResult);
  }, [matchResult, slotIndex, onMatchResult]);

  // Re-run matching when the user triggers a match (via "Apply & Match" button).
  useEffect(() => {
    if (!attempt || !imageFile || !cv || matchTrigger === 0) return;
    matchImage(imageFile, attempt.id, cv, imageCrop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchTrigger, attempt?.id, imageFile, cv]);

  // On-demand video export for download.
  const [exportStatus, setExportStatus] = useState<"idle" | "rendering" | "done">("idle");
  const [exportProgress, setExportProgress] = useState(0);

  async function handleDownload() {
    if (!cv || !imageFile || !attempt || !matchResult) return;
    const att = getAttempt(attempt.id);
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
        skeletonStyle: (() => {
          const topo = getTopology(att.poseBackend ?? "mediapipe");
          return { limbColor, jointColor: JOINT_COLOR, lineWidth, pointRadius, skeletonEdges: topo.skeletonEdges, keypointNames: topo.keypointNames };
        })(),
        targetFps: 60,
        onProgress: (r, t) => setExportProgress(Math.round((r / t) * 100)),
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${attempt.id}-overlay.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus("done");
    } catch {
      setExportStatus("idle");
    }
  }

  const isReady = skeletonStatus === "ready" && !!skeletonData;
  const isError = skeletonStatus === "error" || matchStatus === "error";

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-edge bg-card p-4"
      style={{ borderTopColor: limbColor, borderTopWidth: 2 }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: limbColor }}
        />
        <span className="text-xs font-medium text-fg-light">Climb {slotIndex + 1}</span>
        {attempt && (
          <span className={[
            "rounded px-1.5 py-0.5 text-xs font-medium capitalize",
            attempt.runType === "send"
              ? "bg-emerald-900/40 text-emerald-400"
              : "bg-amber-900/40 text-amber-400",
          ].join(" ")}>
            {attempt.runType ?? "attempt"}
          </span>
        )}
        {attempt?.rating && (
          <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-inset text-fg-light">
            {attempt.rating}
          </span>
        )}
        {attempt && (
          <span className="ml-auto text-xs text-fg-muted">
            {attempt.frames.length} frames
            {attempt.videoMeta?.duration != null && (
              <> &middot; {Math.floor(attempt.videoMeta.duration / 60)}m {Math.floor(attempt.videoMeta.duration % 60)}s</>
            )}
          </span>
        )}
      </div>

      {attempt?.notes && (
        <div className="rounded border border-edge bg-inset/50 px-3 py-1.5">
          <p className="text-xs text-fg-muted">{attempt.notes}</p>
        </div>
      )}

      {!attempt && (
        <p className="text-xs text-fg-muted italic">No climb loaded</p>
      )}

      {attempt && matchStatus === "matching" && (
        <p className="text-xs text-fg-secondary animate-pulse">Matching&#8230;</p>
      )}

      {isReady && imageFile && !hidePlayer && (
        <div className="flex flex-col gap-2">
          <FramePlayer
            ref={playerRef}
            imageFile={imageFile}
            layers={[{
              frames: skeletonData.frames,
              style: (() => {
                const topo = getTopology(attempt?.poseBackend ?? "mediapipe");
                return { limbColor, jointColor: JOINT_COLOR, lineWidth, pointRadius, skeletonEdges: topo.skeletonEdges, keypointNames: topo.keypointNames };
              })(),
            }]}
            duration={skeletonData.duration}
            hidePlayButton={hidePlayButton}
          />
          {exportStatus === "rendering" ? (
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>Exporting&#8230;</span>
              <span>{exportProgress}%</span>
            </div>
          ) : (
            <button
              onClick={handleDownload}
              className="text-center text-xs text-fg-muted hover:text-fg-light transition"
            >
              Download .webm
            </button>
          )}
        </div>
      )}

      {isError && (
        <p className="text-xs text-red-400">{matchError ?? "Render failed."}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlay: composite animation of all matched attempts simultaneously
// ---------------------------------------------------------------------------

interface OverlayProps {
  cv: CV;
  imageFile: File;
  attempts: (RouteAttempt | null)[];
  matchResults: (ImageMatchResult | null)[];
  slotColors: string[];
  lineWidth: number;
  pointRadius: number;
}

function OverlayPlayer({
  cv,
  imageFile,
  attempts,
  matchResults,
  slotColors,
  lineWidth,
  pointRadius,
}: OverlayProps) {
  // Pre-compute multi-layer skeleton frames (sync, instant).
  const multiData = useMemo(() => {
    if (!cv) return null;
    const layerInputs = [];
    for (let i = 0; i < attempts.length; i++) {
      const att = attempts[i];
      const mr = matchResults[i];
      if (!att?.orbFeatures || !mr) continue;
      layerInputs.push({
        frames: att.frames,
        videoMeta: att.videoMeta,
        orbFeatures: att.orbFeatures,
        queryOrb: mr.queryOrb,
        matches: mr.matches,
      });
    }
    if (layerInputs.length === 0) return null;
    try {
      return buildMultiSkeletonFrames({ cv, layers: layerInputs });
    } catch {
      return null;
    }
  }, [cv, attempts, matchResults]);

  // Assemble layers with styles (lightweight — just attaches references).
  const playerLayers = useMemo<FramePlayerLayer[]>(() => {
    if (!multiData) return [];
    const layers: FramePlayerLayer[] = [];
    let layerIdx = 0;
    for (let i = 0; i < attempts.length; i++) {
      if (attempts[i] && matchResults[i]) {
        const topo = getTopology(attempts[i]?.poseBackend ?? "mediapipe");
        layers.push({
          frames: multiData.layers[layerIdx].frames,
          style: { limbColor: slotColors[i], jointColor: JOINT_COLOR, lineWidth, pointRadius, skeletonEdges: topo.skeletonEdges, keypointNames: topo.keypointNames },
        });
        layerIdx++;
      }
    }
    return layers;
  }, [multiData, attempts, matchResults, slotColors, lineWidth, pointRadius]);

  // On-demand video export.
  const [exportStatus, setExportStatus] = useState<"idle" | "rendering" | "done">("idle");
  const [exportProgress, setExportProgress] = useState(0);

  async function handleDownload() {
    if (!cv || !imageFile) return;
    const layerInputs = [];
    for (let i = 0; i < attempts.length; i++) {
      const att = attempts[i];
      const mr = matchResults[i];
      if (!att?.orbFeatures || !mr) continue;
      const topo = getTopology(att.poseBackend ?? "mediapipe");
      layerInputs.push({
        frames: att.frames,
        videoMeta: att.videoMeta,
        orbFeatures: att.orbFeatures,
        queryOrb: mr.queryOrb,
        matches: mr.matches,
        skeletonStyle: { limbColor: slotColors[i], jointColor: JOINT_COLOR, lineWidth, pointRadius, skeletonEdges: topo.skeletonEdges, keypointNames: topo.keypointNames },
      });
    }
    if (layerInputs.length === 0) return;
    setExportStatus("rendering");
    setExportProgress(0);
    try {
      const url = await renderMultiPoseVideo({
        cv,
        imageFile,
        layers: layerInputs,
        targetFps: 60,
        onProgress: (r, t) => setExportProgress(Math.round((r / t) * 100)),
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = "overlay-composite.webm";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus("done");
    } catch {
      setExportStatus("idle");
    }
  }

  if (playerLayers.length === 0 || !multiData) {
    return (
      <p className="text-xs text-fg-muted italic">
        Overlay will appear here once at least one run has been matched.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <FramePlayer
        imageFile={imageFile}
        layers={playerLayers}
        duration={multiData.duration}
      />
      {exportStatus === "rendering" ? (
        <div className="flex items-center justify-between text-xs text-fg-muted">
          <span>Exporting overlay&#8230;</span>
          <span>{exportProgress}%</span>
        </div>
      ) : (
        <button
          onClick={handleDownload}
          className="text-center text-xs text-fg-muted hover:text-fg-light transition"
        >
          Download .webm
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main compare page
// ---------------------------------------------------------------------------

const MAX_SLOTS = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function dataUrlToFile(dataUrl: string, filename = "route-image.jpg"): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type });
}

function ComparePageInner() {
  const { cv } = useOpenCV();
  const [attempts, setAttempts] = useState<(RouteAttempt | null)[]>(
    () => Array.from({ length: MAX_SLOTS }, () => null),
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [userPickedImage, setUserPickedImage] = useState(false);
  const routeImageConvertingRef = useRef(false);
  const imagePreviewUrlRef = useRef<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("sidebyside");
  const [matchResults, setMatchResults] = useState<(ImageMatchResult | null)[]>(
    () => Array.from({ length: MAX_SLOTS }, () => null),
  );

  // Track which S3 entry key is loaded in each slot for toggle-select.
  const [slotKeys, setSlotKeys] = useState<(string | null)[]>(
    () => Array.from({ length: MAX_SLOTS }, () => null),
  );
  const selectedKeys = useMemo(
    () => new Set(slotKeys.filter((k): k is string => k !== null)),
    [slotKeys],
  );

  // One hex limb color per slot; pre-populated from defaults so each slot
  // starts with a distinct color and duplicates are avoided by default.
  const [slotColors, setSlotColors] = useState<string[]>(
    () => [...DEFAULT_LIMB_COLORS],
  );

  // Shared skeleton style applied to all slots simultaneously.
  const [skeletonLineWidth, setSkeletonLineWidth] = useState(2.5);
  const [skeletonPointRadius, setSkeletonPointRadius] = useState(2);

  // Crop box for ORB detection on the shared route photo.
  const [imageCrop, setImageCrop] = useState<CropFraction>({ x: 0, y: 0, w: 1, h: 1 });
  // Incremented each time the user clicks "Apply & Match".
  const [matchTrigger, setMatchTrigger] = useState(0);
  const [cropConfirmed, setCropConfirmed] = useState(false);

  // Dropdown state for "Update route photo" button.
  const [showUpdateMenu, setShowUpdateMenu] = useState(false);
  const updateMenuRef = useRef<HTMLDivElement>(null);

  // FramePlayer refs for master play control (side-by-side).
  const playerRefs = useRef<(FramePlayerHandle | null)[]>(
    Array.from({ length: MAX_SLOTS }, () => null),
  );
  const [masterPlaying, setMasterPlaying] = useState(false);

  // Close update menu on outside click.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (updateMenuRef.current && !updateMenuRef.current.contains(e.target as Node)) {
        setShowUpdateMenu(false);
      }
    }
    if (showUpdateMenu) document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showUpdateMenu]);

  // Revoke objectURL on unmount.
  useEffect(() => {
    return () => {
      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    };
  }, []);

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

  const handleMatchResult = useCallback((idx: number, result: ImageMatchResult | null) => {
    setMatchResults(prev => {
      const next = [...prev];
      next[idx] = result;
      return next;
    });
  }, []);

  function handleSelectAttempt(attempt: RouteAttempt, entryKey?: string) {
    const idx = attempts.findIndex(a => a === null);
    if (idx === -1) return; // all slots full

    setAttempts(prev => {
      const next = [...prev];
      next[idx] = attempt;
      return next;
    });
    if (entryKey) {
      setSlotKeys(prev => {
        const next = [...prev];
        next[idx] = entryKey;
        return next;
      });
    }
    // Clear stale match result for this slot.
    setMatchResults(prev => {
      const next = [...prev];
      next[idx] = null;
      return next;
    });
    // Bump trigger so the CompareSlot effect re-fires matching.
    if (imageFile && cropConfirmed) {
      setMatchTrigger(t => t + 1);
    }
  }

  function handleDeselectAttempt(entryKey: string) {
    const idx = slotKeys.indexOf(entryKey);
    if (idx === -1) return;
    setAttempts(prev => { const n = [...prev]; n[idx] = null; return n; });
    setSlotKeys(prev => { const n = [...prev]; n[idx] = null; return n; });
    setMatchResults(prev => { const n = [...prev]; n[idx] = null; return n; });
  }

  function handleColorChange(idx: number, hex: string) {
    setSlotColors((prev) => {
      const next = [...prev];
      next[idx] = hex;
      return next;
    });
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFileWithPreview(file);
    setUserPickedImage(true);
    setImageCrop({ x: 0, y: 0, w: 1, h: 1 });
    setCropConfirmed(false);
    setMatchResults(Array.from({ length: MAX_SLOTS }, () => null));
    setShowUpdateMenu(false);
  }

  function handleCameraCapture(file: File) {
    setImageFileWithPreview(file);
    setUserPickedImage(true);
    setImageCrop({ x: 0, y: 0, w: 1, h: 1 });
    setCropConfirmed(false);
    setMatchResults(Array.from({ length: MAX_SLOTS }, () => null));
    setShowCamera(false);
    setShowUpdateMenu(false);
  }

  // Auto-populate route image from S3 when route has a route photo.
  const handleRouteImageLoaded = useCallback((dataUrl: string | null) => {
    if (!dataUrl || userPickedImage || routeImageConvertingRef.current) return;
    routeImageConvertingRef.current = true;
    dataUrlToFile(dataUrl)
      .then(file => { setImageFileWithPreview(file); })
      .catch(() => { /* ignore */ })
      .finally(() => { routeImageConvertingRef.current = false; });
  }, [userPickedImage]);

  function handleApplyAndMatch() {
    setCropConfirmed(true);
    setMatchTrigger(t => t + 1);
  }

  const activeSlots = attempts.filter(Boolean).length;
  const anyLoaded = activeSlots > 0;

  return (
    <div className="flex-1 bg-surface">
    <div className="mx-auto w-full max-w-4xl px-6 py-10 flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-fg">Compare Climbs</h1>
        <p className="text-sm text-fg-secondary">
          Select a route, then toggle climbs to compare them side by side or overlaid on the same route photo.
        </p>
      </div>

      {/* Single shared route picker with selectable climb entries */}
      <div className="flex flex-col gap-3">
        <S3RoutePicker
          label="Select Route"
          alwaysOpen
          selectable
          selectedKeys={selectedKeys}
          onLoad={handleSelectAttempt}
          onDeselect={handleDeselectAttempt}
          onRouteImageLoaded={handleRouteImageLoaded}
        />
      </div>

      {/* Route photo */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-fg-light">Route photo</p>

        {imageFile && imagePreviewUrl ? (
          /* Image exists — show preview with update button in corner */
          <div className="flex flex-col gap-3">
            <div className="relative w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrl}
                alt="Route photo"
                className="max-h-[32rem] w-full rounded-xl border border-edge bg-card object-contain"
              />
              {!cropConfirmed && <CropBoxOverlay box={imageCrop} onChange={setImageCrop} />}

              {/* Update route photo — corner dropdown */}
              <div ref={updateMenuRef} className="absolute top-2 right-2">
                <button
                  onClick={() => setShowUpdateMenu(v => !v)}
                  className="flex items-center gap-1.5 rounded-lg bg-surface/80 backdrop-blur px-3 py-1.5 text-xs font-medium text-fg-light border border-edge hover:bg-surface hover:text-fg transition shadow-sm"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                  Update photo
                </button>
                {showUpdateMenu && (
                  <div className="absolute right-0 mt-1 w-44 rounded-lg border border-edge bg-card shadow-lg overflow-hidden z-10">
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-xs text-fg-light hover:bg-inset transition">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
                      </svg>
                      Select file
                      <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                    </label>
                    <button
                      onClick={() => { setShowUpdateMenu(false); setShowCamera(true); }}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-xs text-fg-light hover:bg-inset transition"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                      </svg>
                      Take a photo
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Apply & View button — shown before crop is confirmed */}
            {!cropConfirmed && (
              <>
                <p className="text-xs text-fg-secondary">
                  Adjust the crop region to focus ORB matching on the relevant wall area.
                </p>
                <button
                  onClick={handleApplyAndMatch}
                  disabled={!anyLoaded}
                  className={[
                    "flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50",
                    anyLoaded ? "ring-2 ring-accent/30 ring-offset-2 ring-offset-surface animate-pulse" : "",
                  ].join(" ")}
                >
                  Apply &amp; View
                </button>
                {!anyLoaded && (
                  <p className="text-xs text-fg-muted">Select at least one climb above to enable matching.</p>
                )}
              </>
            )}
          </div>
        ) : (
          /* No image yet — show upload / camera cards */
          <div className="grid grid-cols-2 gap-3">
            <label
              className={[
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-4 py-6 text-sm transition",
                "bg-primary border-edge text-fg-light hover:border-accent/60 hover:text-fg",
                "animate-pulse border-accent/30",
              ].join(" ")}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
              </svg>
              <span className="font-medium text-fg">Select route photo</span>
              <span className="text-xs text-fg-light">JPG, PNG, WebP</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
            </label>

            <button
              type="button"
              onClick={() => setShowCamera(true)}
              className={[
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-4 py-6 text-sm transition",
                "bg-primary border-edge text-fg-light hover:border-accent/60 hover:text-fg",
                "animate-pulse border-accent/30",
              ].join(" ")}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
              </svg>
              <span className="font-medium text-fg">Take a photo</span>
              <span className="text-xs text-fg-light">Opens camera</span>
            </button>
          </div>
        )}
      </div>

      {/* View mode + skeleton style dropdown + master play */}
      {anyLoaded && imageFile && (
        <div className="flex items-center gap-2 flex-wrap">
          {([ "sidebyside", "overlay"] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={[
                "rounded-lg border px-4 py-2 text-sm font-medium transition",
                viewMode === mode
                  ? "border-accent/60 bg-card text-fg"
                  : "border-edge bg-card text-fg-muted hover:border-edge-hover hover:text-fg-light",
              ].join(" ")}
            >
              {mode === "sidebyside" ? "Side by side" : "Overlay"}
            </button>
          ))}

          {/* Skeleton style dropdown */}
          {cropConfirmed && (
            <SkeletonStylePanel
              onChange={s => {
                if (s.lineWidth != null) setSkeletonLineWidth(s.lineWidth);
                if (s.pointRadius != null) setSkeletonPointRadius(s.pointRadius);
              }}
            />
          )}

          {/* Master play button — side-by-side only */}
          {viewMode === "sidebyside" && cropConfirmed && (
            <button
              onClick={() => {
                const next = !masterPlaying;
                setMasterPlaying(next);
                for (let i = 0; i < MAX_SLOTS; i++) {
                  const ref = playerRefs.current[i];
                  if (ref) {
                    if (next) ref.play();
                    else ref.pause();
                  }
                }
              }}
              className="flex items-center gap-1.5 rounded-lg border border-edge bg-card px-4 py-2 text-sm font-medium text-fg-muted transition hover:border-edge-hover hover:text-fg-light"
              aria-label={masterPlaying ? "Pause all" : "Play all"}
            >
              {masterPlaying ? (
                <>
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                  Pause all
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  Play all
                </>
              )}
            </button>
          )}

          {/* Slot color pickers */}
          {cropConfirmed && (
            <div className="flex items-center gap-1 ml-auto">
              {Array.from({ length: MAX_SLOTS }, (_, i) =>
                attempts[i] ? (
                  <input
                    key={i}
                    type="color"
                    value={slotColors[i]}
                    onChange={(e) => handleColorChange(i, e.target.value)}
                    className="h-6 w-6 cursor-pointer rounded border border-edge bg-transparent p-0.5"
                    title={`Climb ${i + 1} color`}
                    aria-label={`Climb ${i + 1} skeleton color`}
                  />
                ) : null,
              )}
            </div>
          )}
        </div>
      )}

      {/* Climb slots — always rendered to preserve matching state */}
      <div
        className={
          viewMode === "sidebyside"
            ? "grid grid-cols-1 gap-4 sm:grid-cols-2"
            : "flex flex-col gap-4"
        }
      >
        {Array.from({ length: MAX_SLOTS }, (_, i) =>
          attempts[i] ? (
            <CompareSlot
              key={i}
              slotIndex={i}
              attempt={attempts[i]}
              imageFile={imageFile}
              imageCrop={imageCrop}
              matchTrigger={matchTrigger}
              cv={cv}
              limbColor={slotColors[i]}
              lineWidth={skeletonLineWidth}
              pointRadius={skeletonPointRadius}
              onMatchResult={handleMatchResult}
              hidePlayer={viewMode === "overlay"}
              hidePlayButton={viewMode === "sidebyside"}
              playerRef={(el) => { playerRefs.current[i] = el; }}
            />
          ) : null,
        )}
      </div>

      {/* Overlay mode result */}
      {viewMode === "overlay" && imageFile && anyLoaded && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-fg-light">
            Overlay (all skeletons simultaneously)
          </p>
          {/* Color legend */}
          <div className="flex flex-wrap gap-3 text-xs">
            {attempts.map((att, i) =>
              att ? (
                <span key={i} className="flex items-center gap-1.5 text-fg-secondary">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: slotColors[i] }}
                  />
                  Climb {i + 1}: {att.route || att.id}
                </span>
              ) : null,
            )}
          </div>
          <OverlayPlayer
            imageFile={imageFile}
            matchResults={matchResults}
            attempts={attempts}
            cv={cv}
            slotColors={slotColors}
            lineWidth={skeletonLineWidth}
            pointRadius={skeletonPointRadius}
          />
        </div>
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

export default function ComparePage() {
  return (
    <LoadingGate>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
            Loading&#8230;
          </div>
        }
      >
        <ComparePageInner />
      </Suspense>
    </LoadingGate>
  );
}
