"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import LoadingGate from "@/components/shared/LoadingGate";
import CropBoxOverlay, { type CropFraction } from "@/components/shared/CropBoxOverlay";
import S3RoutePicker from "@/components/shared/S3RoutePicker";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { usePoseVideo } from "@/hooks/usePoseVideo";
import { useMultiPoseVideo, type MultiPoseInput } from "@/hooks/useMultiPoseVideo";
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
  onMatchResult,
}: SlotProps) {
  const { matchImage, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();
  const { videoUrl, status: videoStatus, renderProgress } = usePoseVideo(
    cv,
    imageFile,
    attempt?.id ?? null,
    matchResult,
    { limbColor, jointColor: JOINT_COLOR, lineWidth, pointRadius },
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

  const isRendering = videoStatus === "rendering";
  const isReady = videoStatus === "ready";
  const isError = videoStatus === "error" || matchStatus === "error";

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
        <span className="text-xs font-medium text-zinc-300">Attempt {slotIndex + 1}</span>
        {attempt && (
          <span className="ml-auto text-xs text-zinc-600">
            {attempt.frames.length} frames
          </span>
        )}
      </div>

      {!attempt && (
        <p className="text-xs text-zinc-600 italic">No attempt loaded</p>
      )}

      {attempt && matchStatus === "matching" && (
        <p className="text-xs text-zinc-400 animate-pulse">Matching&#8230;</p>
      )}

      {isRendering && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Rendering&#8230;</span>
            <span>{renderProgress}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full transition-all duration-150"
              style={{ width: `${renderProgress}%`, backgroundColor: limbColor }}
            />
          </div>
        </div>
      )}

      {isReady && videoUrl && (
        <div className="flex flex-col gap-2">
          <video
            src={videoUrl}
            controls
            loop
            playsInline
            muted
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950"
          />
          <a
            href={videoUrl}
            download={`${attempt?.id ?? "attempt"}-overlay.webm`}
            className="text-center text-xs text-zinc-500 hover:text-zinc-300 transition"
          >
            Download .webm
          </a>
        </div>
      )}

      {isError && (
        <p className="text-xs text-red-400">{matchError ?? "Render failed."}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlay video: composite animation of all matched attempts simultaneously
// ---------------------------------------------------------------------------

interface OverlayVideoProps {
  cv: CV;
  imageFile: File;
  attempts: (RouteAttempt | null)[];
  matchResults: (ImageMatchResult | null)[];
  slotColors: string[];
  lineWidth: number;
  pointRadius: number;
}

function OverlayVideo({
  cv,
  imageFile,
  attempts,
  matchResults,
  slotColors,
  lineWidth,
  pointRadius,
}: OverlayVideoProps) {
  const inputs = useMemo<MultiPoseInput[]>(
    () =>
      attempts
        .map((att, i): MultiPoseInput | null =>
          att && matchResults[i]
            ? {
                attempt: att,
                matchResult: matchResults[i]!,
                skeletonStyle: { limbColor: slotColors[i], jointColor: JOINT_COLOR, lineWidth, pointRadius },
              }
            : null,
        )
        .filter((x): x is MultiPoseInput => x !== null),
    [attempts, matchResults, slotColors, lineWidth, pointRadius],
  );

  const { videoUrl, status, errorMessage, renderProgress } = useMultiPoseVideo(
    cv,
    imageFile,
    inputs,
  );

  if (status === "idle") {
    return (
      <p className="text-xs text-zinc-500 italic">
        Overlay will appear here once at least one attempt has been matched.
      </p>
    );
  }

  if (status === "rendering") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Rendering overlay&#8230;</span>
          <span>{renderProgress}%</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-zinc-400 transition-all duration-150"
            style={{ width: `${renderProgress}%` }}
          />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return <p className="text-sm text-red-400">{errorMessage}</p>;
  }

  if (status === "ready" && videoUrl) {
    return (
      <div className="flex flex-col gap-2">
        <video
          src={videoUrl}
          controls
          loop
          playsInline
          muted
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950"
          aria-label="Skeleton overlay composite video"
        />
        <a
          href={videoUrl}
          download="overlay-composite.webm"
          className="text-center text-xs text-zinc-500 hover:text-zinc-300 transition"
        >
          Download .webm
        </a>
      </div>
    );
  }

  return null;
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

  // Crop box for ORB detection on the shared route photo.
  const [imageCrop, setImageCrop] = useState<CropFraction>({ x: 0, y: 0, w: 1, h: 1 });
  // Incremented each time the user clicks "Apply & Match".
  const [matchTrigger, setMatchTrigger] = useState(0);
  const [cropConfirmed, setCropConfirmed] = useState(false);

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
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Compare Attempts</h1>
        <p className="text-sm text-zinc-400">
          Load multiple attempts and overlay or compare them side by side on the same route photo.
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
              className="flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply &amp; Match
            </button>
            {!anyLoaded && (
              <p className="text-xs text-zinc-500">Load at least one attempt below to enable matching.</p>
            )}
          </div>
        )}

      </div>

      {/* Skeleton style controls — shown once matching has been triggered */}
      {cropConfirmed && (
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm font-medium text-zinc-300">Skeleton style</p>
          <div className="flex flex-col gap-3">
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
        </div>
      )}

      {/* View mode */}
      {anyLoaded && imageFile && (
        <div className="flex gap-2">
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
        </div>
      )}

      {/* Attempt slots */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-300">Attempts</p>
          {slotCount < MAX_SLOTS && (
            <button
              onClick={() => setSlotCount(c => c + 1)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition"
            >
              + Add attempt
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
                  title={`Attempt ${i + 1} skeleton color`}
                  aria-label={`Attempt ${i + 1} skeleton color`}
                />
                <div className="min-w-0 flex-1">
                  <S3RoutePicker
                    label={
                      attempts[i]
                        ? `Change Attempt ${i + 1}`
                        : `Load Attempt ${i + 1}`
                    }
                    onLoad={(att) => handleLoadAttempt(i, att)}
                    compact
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
                  Attempt {i + 1}: {att.route || att.id}
                </span>
              ) : null,
            )}
          </div>
          <OverlayVideo
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
