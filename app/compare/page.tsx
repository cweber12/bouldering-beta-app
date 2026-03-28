"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import LoadingGate from "@/components/shared/LoadingGate";
import CropBoxOverlay, { type CropFraction } from "@/components/shared/CropBoxOverlay";
import S3RoutePicker from "@/components/shared/S3RoutePicker";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { usePoseVideo } from "@/hooks/usePoseVideo";
import { computeHomography } from "@/pipeline/homography";
import { buildTransformedKeypoints, drawSkeleton } from "@/pipeline/skeletonOverlay";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";

// ---------------------------------------------------------------------------
// Types / constants
// ---------------------------------------------------------------------------

type ViewMode = "sidebyside" | "overlay";

// Per-attempt accent colors (limb, joint)
const SLOT_COLORS: Array<{ limb: string; joint: string; label: string }> = [
  { limb: "rgba(0,210,115,0.82)", joint: "rgba(255,215,0,0.9)", label: "Attempt 1" },
  { limb: "rgba(56,189,248,0.82)", joint: "rgba(255,255,255,0.9)", label: "Attempt 2" },
  { limb: "rgba(251,146,60,0.82)", joint: "rgba(255,255,255,0.9)", label: "Attempt 3" },
  { limb: "rgba(192,132,252,0.82)", joint: "rgba(255,255,255,0.9)", label: "Attempt 4" },
];

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
  onMatchResult: (idx: number, result: ImageMatchResult | null) => void;
}

function CompareSlot({ slotIndex, attempt, imageFile, imageCrop, matchTrigger, cv, onMatchResult }: SlotProps) {
  const colors = SLOT_COLORS[slotIndex];
  const { matchImage, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();
  const { videoUrl, status: videoStatus, renderProgress } =
    usePoseVideo(cv, imageFile, attempt?.id ?? null, matchResult);

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
      style={{ borderTopColor: colors.limb, borderTopWidth: 2 }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: colors.limb }}
        />
        <span className="text-xs font-medium text-zinc-300">{colors.label}</span>
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
              style={{ width: `${renderProgress}%`, backgroundColor: colors.limb }}
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
// Overlay canvas: composite static frame from all matched attempts
// ---------------------------------------------------------------------------

interface OverlayCanvasProps {
  imageFile: File | null;
  matchResults: (ImageMatchResult | null)[];
  attempts: (RouteAttempt | null)[];
  cv: CV;
}

function OverlayCanvas({ imageFile, matchResults, attempts, cv }: OverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageFile || !cv) return;

    const readyPairs = attempts
      .map((att, i) => ({ att, mr: matchResults[i] }))
      .filter((p): p is { att: RouteAttempt; mr: ImageMatchResult } => !!p.att && !!p.mr);

    if (readyPairs.length === 0) {
      // Defer state update to avoid calling setState synchronously inside an effect
      const id = setTimeout(() => setRendered(false), 0);
      return () => clearTimeout(id);
    }

    const img = new Image();
    const url = URL.createObjectURL(imageFile);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);

        for (let i = 0; i < readyPairs.length; i++) {
          const { att, mr } = readyPairs[i];
          const colors = SLOT_COLORS[attempts.indexOf(att)] ?? SLOT_COLORS[0];
          const h = computeHomography(cv, mr.matches, att.orbFeatures!, mr.queryOrb);
          if (!h) continue;

          // Pick the middle frame of the attempt
          const frame = att.frames[Math.floor(att.frames.length / 2)];
          if (!frame) continue;

          const kp = buildTransformedKeypoints(
            frame, h,
            att.videoMeta.width, att.videoMeta.height,
          );
          drawSkeleton(ctx, kp, { limbColor: colors.limb, jointColor: colors.joint });
        }
        setRendered(true);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Overlay failed.");
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); setError("Could not load route image."); };
    img.src = url;
  }, [imageFile, matchResults, attempts, cv]);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {!rendered && (
        <p className="text-xs text-zinc-500 italic">
          Overlay will appear here once at least one attempt has been matched.
        </p>
      )}
      <canvas
        ref={canvasRef}
        className="w-full rounded-xl border border-zinc-700 bg-zinc-900"
        aria-label="Skeleton overlay composite"
      />
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
                className="max-h-48 w-full rounded-xl border border-zinc-700 bg-zinc-900 object-contain"
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

        {/* Static preview after match triggered */}
        {imagePreviewUrl && cropConfirmed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imagePreviewUrl}
            alt="Route photo"
            className="max-h-48 w-full rounded-xl border border-zinc-700 bg-zinc-900 object-contain"
          />
        )}
      </div>

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

        {Array.from({ length: slotCount }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <S3RoutePicker
              label={attempts[i] ? `Change ${SLOT_COLORS[i].label}` : `Load ${SLOT_COLORS[i].label}`}
              onLoad={att => handleLoadAttempt(i, att)}
              compact
            />
            {attempts[i] && (
              <CompareSlot
                slotIndex={i}
                attempt={attempts[i]}
                imageFile={imageFile}
                imageCrop={imageCrop}
                matchTrigger={matchTrigger}
                cv={cv}
                onMatchResult={handleMatchResult}
              />
            )}
          </div>
        ))}
      </div>

      {/* Overlay mode result */}
      {viewMode === "overlay" && imageFile && anyLoaded && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-zinc-300">Overlay (middle frame per attempt)</p>
          <div className="flex flex-wrap gap-3 text-xs">
            {attempts.slice(0, slotCount).map((att, i) =>
              att ? (
                <span key={i} className="flex items-center gap-1.5 text-zinc-400">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: SLOT_COLORS[i].limb }}
                  />
                  {SLOT_COLORS[i].label}: {att.route || att.id}
                </span>
              ) : null,
            )}
          </div>
          <OverlayCanvas
            imageFile={imageFile}
            matchResults={matchResults.slice(0, slotCount)}
            attempts={attempts.slice(0, slotCount)}
            cv={cv}
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
