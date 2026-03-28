"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import LoadingGate from "@/components/shared/LoadingGate";
import CropBoxOverlay, { type CropFraction } from "@/components/shared/CropBoxOverlay";
import S3RoutePicker from "@/components/shared/S3RoutePicker";
import FramePlayer, { type FramePlayerLayer, type FramePlayerHandle } from "@/components/shared/FramePlayer";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { useSkeletonFrames } from "@/hooks/useSkeletonFrames";
import { buildMultiSkeletonFrames } from "@/pipeline/skeletonRenderer";
import { renderMultiPoseVideo } from "@/pipeline/multiPoseVideoRenderer";
import { renderPoseVideo } from "@/pipeline/poseVideoRenderer";
import { getAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";

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
        skeletonStyle: { limbColor, jointColor: JOINT_COLOR, lineWidth, pointRadius },
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
      className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4"
      style={{ borderTopColor: limbColor, borderTopWidth: 2 }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: limbColor }}
        />
        <span className="text-xs font-medium text-zinc-300">Climb {slotIndex + 1}</span>
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
          <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-800 text-zinc-300">
            {attempt.rating}
          </span>
        )}
        {attempt && (
          <span className="ml-auto text-xs text-zinc-600">
            {attempt.frames.length} frames
            {attempt.videoMeta?.duration != null && (
              <> &middot; {Math.floor(attempt.videoMeta.duration / 60)}m {Math.floor(attempt.videoMeta.duration % 60)}s</>
            )}
          </span>
        )}
      </div>

      {attempt?.notes && (
        <div className="rounded border border-zinc-800 bg-zinc-950/50 px-3 py-1.5">
          <p className="text-xs text-zinc-500">{attempt.notes}</p>
        </div>
      )}

      {!attempt && (
        <p className="text-xs text-zinc-600 italic">No climb loaded</p>
      )}

      {attempt && matchStatus === "matching" && (
        <p className="text-xs text-zinc-400 animate-pulse">Matching&#8230;</p>
      )}

      {isReady && imageFile && !hidePlayer && (
        <div className="flex flex-col gap-2">
          <FramePlayer
            ref={playerRef}
            imageFile={imageFile}
            layers={[{
              frames: skeletonData.frames,
              style: { limbColor, jointColor: JOINT_COLOR, lineWidth, pointRadius },
            }]}
            duration={skeletonData.duration}
            hidePlayButton={hidePlayButton}
          />
          {exportStatus === "rendering" ? (
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Exporting&#8230;</span>
              <span>{exportProgress}%</span>
            </div>
          ) : (
            <button
              onClick={handleDownload}
              className="text-center text-xs text-zinc-500 hover:text-zinc-300 transition"
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
        layers.push({
          frames: multiData.layers[layerIdx].frames,
          style: { limbColor: slotColors[i], jointColor: JOINT_COLOR, lineWidth, pointRadius },
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
      layerInputs.push({
        frames: att.frames,
        videoMeta: att.videoMeta,
        orbFeatures: att.orbFeatures,
        queryOrb: mr.queryOrb,
        matches: mr.matches,
        skeletonStyle: { limbColor: slotColors[i], jointColor: JOINT_COLOR, lineWidth, pointRadius },
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
      <p className="text-xs text-zinc-500 italic">
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
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Exporting overlay&#8230;</span>
          <span>{exportProgress}%</span>
        </div>
      ) : (
        <button
          onClick={handleDownload}
          className="text-center text-xs text-zinc-500 hover:text-zinc-300 transition"
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
const INITIAL_SLOTS = 2;

function ComparePageInner() {
  const { cv } = useOpenCV();
  const [attempts, setAttempts] = useState<(RouteAttempt | null)[]>(
    () => Array.from({ length: MAX_SLOTS }, () => null),
  );
  const [slotCount, setSlotCount] = useState(INITIAL_SLOTS);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const imagePreviewRef = useRef<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("sidebyside");
  const [matchResults, setMatchResults] = useState<(ImageMatchResult | null)[]>(
    () => Array.from({ length: MAX_SLOTS }, () => null),
  );

  // One hex limb color per slot; pre-populated from defaults so each slot
  // starts with a distinct color and duplicates are avoided by default.
  const [slotColors, setSlotColors] = useState<string[]>(
    () => [...DEFAULT_LIMB_COLORS],
  );

  // Shared skeleton style applied to all slots simultaneously.
  const [skeletonLineWidth, setSkeletonLineWidth] = useState(2.5);
  const [skeletonPointRadius, setSkeletonPointRadius] = useState(2);
  const [styleOpen, setStyleOpen] = useState(false);

  // Crop box for ORB detection on the shared route photo.
  const [imageCrop, setImageCrop] = useState<CropFraction>({ x: 0, y: 0, w: 1, h: 1 });
  // Incremented each time the user clicks "Apply & Match".
  const [matchTrigger, setMatchTrigger] = useState(0);
  const [cropConfirmed, setCropConfirmed] = useState(false);

  // Auto-populate state/area/route from the first loaded run.
  const [defaultState, setDefaultState] = useState<string | undefined>();
  const [defaultArea, setDefaultArea] = useState<string | undefined>();
  const [defaultRoute, setDefaultRoute] = useState<string | undefined>();

  // FramePlayer refs for master play control (side-by-side).
  const playerRefs = useRef<(FramePlayerHandle | null)[]>(
    Array.from({ length: MAX_SLOTS }, () => null),
  );
  const [masterPlaying, setMasterPlaying] = useState(false);

  useEffect(() => {
    return () => {
      if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current);
    };
  }, []);

  const handleMatchResult = useCallback((idx: number, result: ImageMatchResult | null) => {
    setMatchResults(prev => {
      const next = [...prev];
      next[idx] = result;
      return next;
    });
  }, []);

  function handleLoadAttempt(idx: number, attempt: RouteAttempt) {
    setAttempts(prev => {
      const next = [...prev];
      next[idx] = attempt;
      // Auto-populate defaults from the first loaded run.
      const isFirstRun = prev.every(a => a === null);
      if (isFirstRun) {
        setDefaultState(attempt.state || undefined);
        setDefaultArea(attempt.area || undefined);
        setDefaultRoute(attempt.route || undefined);
      }
      return next;
    });
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
    if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current);
    const url = URL.createObjectURL(file);
    imagePreviewRef.current = url;
    setImagePreviewUrl(url);
    setImageFile(file);
    setImageCrop({ x: 0, y: 0, w: 1, h: 1 });
    setCropConfirmed(false);
    setMatchResults(Array.from({ length: MAX_SLOTS }, () => null));
  }

  function handleApplyAndMatch() {
    setCropConfirmed(true);
    setMatchTrigger(t => t + 1);
  }

  const anyLoaded = attempts.slice(0, slotCount).some(Boolean);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10 flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Compare Climbs</h1>
        <p className="text-sm text-zinc-400">
          Load multiple climbs and overlay or compare them side by side on the same route photo.
        </p>
      </div>

      {/* Route photo */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-zinc-300">Route photo</p>
        <label
          className={[
            "flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-8 py-5 text-sm transition",
            imageFile
              ? "border-zinc-600 bg-zinc-900 text-zinc-400"
              : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
            !imageFile ? "ring-2 ring-zinc-400/50 ring-offset-2 ring-offset-zinc-950 animate-pulse" : "",
          ].join(" ")}
        >
          <svg className="h-5 w-5 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
          </svg>
          <span>{imageFile ? imageFile.name : "Select route photo"}</span>
          <span className="text-xs text-zinc-600">JPG, PNG, WebP</span>
          <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
        </label>

        {/* Crop UI — shown after image selected, before match triggered */}
        {imagePreviewUrl && imageFile && !cropConfirmed && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-zinc-400">
              Adjust the crop region to focus ORB matching on the relevant wall area.
            </p>
            <div className="relative w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrl}
                alt="Route photo"
                className="max-h-[32rem] w-full rounded-xl border border-zinc-700 bg-zinc-900 object-contain"
              />
              <CropBoxOverlay box={imageCrop} onChange={setImageCrop} />
            </div>
            <button
              onClick={handleApplyAndMatch}
              disabled={!anyLoaded}
              className={[
                "flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50",
                anyLoaded ? "ring-2 ring-zinc-400/50 ring-offset-2 ring-offset-zinc-950 animate-pulse" : "",
              ].join(" ")}
            >
              Apply &amp; View
            </button>
            {!anyLoaded && (
              <p className="text-xs text-zinc-500">Load at least one climb below to enable matching.</p>
            )}
          </div>
        )}

      </div>

      {/* View mode + skeleton style dropdown + master play */}
      {anyLoaded && imageFile && (
        <div className="flex items-center gap-2">
          {(["sidebyside", "overlay"] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={[
                "rounded-lg border px-4 py-2 text-sm font-medium transition",
                viewMode === mode
                  ? "border-zinc-400 bg-zinc-800 text-zinc-100"
                  : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300",
              ].join(" ")}
            >
              {mode === "sidebyside" ? "Side by side" : "Overlay"}
            </button>
          ))}

          {/* Skeleton style dropdown */}
          {cropConfirmed && (
            <div className="relative">
              <button
                onClick={() => setStyleOpen(o => !o)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-300"
              >
                Style ▾
              </button>
              {styleOpen && (
                <div className="absolute left-0 top-full z-20 mt-1 flex w-56 flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
                  <label className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span>Line width</span>
                      <span className="tabular-nums">{skeletonLineWidth.toFixed(1)} px</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      step="0.5"
                      value={skeletonLineWidth}
                      onChange={(e) => setSkeletonLineWidth(parseFloat(e.target.value))}
                      className="w-full accent-zinc-400"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span>Point radius</span>
                      <span className="tabular-nums">{skeletonPointRadius} px</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="1"
                      value={skeletonPointRadius}
                      onChange={(e) => setSkeletonPointRadius(parseInt(e.target.value, 10))}
                      className="w-full accent-zinc-400"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Master play button — side-by-side only */}
          {viewMode === "sidebyside" && cropConfirmed && (
            <button
              onClick={() => {
                const next = !masterPlaying;
                setMasterPlaying(next);
                for (let i = 0; i < slotCount; i++) {
                  const ref = playerRefs.current[i];
                  if (ref) {
                    if (next) ref.play();
                    else ref.pause();
                  }
                }
              }}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-300"
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
        </div>
      )}

      {/* Run slots */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-300">Climbs</p>
          {slotCount < MAX_SLOTS && (
            <button
              onClick={() => setSlotCount(c => c + 1)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition"
            >
              + Add climb
            </button>
          )}
        </div>

        {/* In side-by-side mode render slots in a 2-column grid so both are
            visible simultaneously. In overlay mode keep them stacked. */}
        <div
          className={
            viewMode === "sidebyside"
              ? "grid grid-cols-1 gap-4 sm:grid-cols-2"
              : "flex flex-col gap-4"
          }
        >
          {Array.from({ length: slotCount }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              {/* Color picker + route loader row */}
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={slotColors[i]}
                  onChange={(e) => handleColorChange(i, e.target.value)}
                  className="h-7 w-7 cursor-pointer rounded border border-zinc-700 bg-transparent p-0.5"
                  title={`Climb ${i + 1} skeleton color`}
                  aria-label={`Climb ${i + 1} skeleton color`}
                />
                <div className="min-w-0 flex-1">
                  <S3RoutePicker
                    label={
                      attempts[i]
                        ? `Change Climb ${i + 1}`
                        : `Load Climb ${i + 1}`
                    }
                    onLoad={(att) => handleLoadAttempt(i, att)}
                    compact
                    defaultState={defaultState}
                    defaultArea={defaultArea}
                    defaultRoute={defaultRoute}
                    pulseButtons={i === 0 && !!imageFile && !anyLoaded}
                  />
                </div>
              </div>
              {attempts[i] && (
                <CompareSlot
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
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Overlay mode result */}
      {viewMode === "overlay" && imageFile && anyLoaded && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-zinc-300">
            Overlay (all skeletons simultaneously)
          </p>
          {/* Color legend */}
          <div className="flex flex-wrap gap-3 text-xs">
            {attempts.slice(0, slotCount).map((att, i) =>
              att ? (
                <span key={i} className="flex items-center gap-1.5 text-zinc-400">
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
            matchResults={matchResults.slice(0, slotCount)}
            attempts={attempts.slice(0, slotCount)}
            cv={cv}
            slotColors={slotColors.slice(0, slotCount)}
            lineWidth={skeletonLineWidth}
            pointRadius={skeletonPointRadius}
          />
        </div>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <LoadingGate requiresTF={false}>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            Loading&#8230;
          </div>
        }
      >
        <ComparePageInner />
      </Suspense>
    </LoadingGate>
  );
}
