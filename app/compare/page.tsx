"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import LoadingGate from "@/components/shared/LoadingGate";
import CropBoxOverlay, { type CropFraction } from "@/components/shared/CropBoxOverlay";
import S3RoutePicker from "@/components/shared/S3RoutePicker";
import CameraRecorderModal from "@/components/shared/CameraRecorderModal";
import SkeletonStylePanel from "@/components/shared/SkeletonStylePanel";
import CompareSlot from "@/components/compare/CompareSlot";
import CompareOverlayPlayer from "@/components/compare/CompareOverlayPlayer";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useS3Storage } from "@/hooks/useS3Storage";
import { saveAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";
import type { FramePlayerHandle } from "@/components/shared/FramePlayer";
import { dataUrlToFile } from "@/utils/imageHelpers";

// ---------------------------------------------------------------------------
// Types / constants
// ---------------------------------------------------------------------------

type ViewMode = "sidebyside" | "overlay";

/**
 * Default limb colors for new slots (hex, accepted by CSS and SkeletonStyle).
 * Each slot index gets a visually distinct color from the start.
 */
const DEFAULT_LIMB_COLORS = ["#00d273", "#38bdf8", "#fb923c", "#c084fc"];

const MAX_SLOTS = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main compare page
// ---------------------------------------------------------------------------
function ComparePageInner() {
  const { cv } = useOpenCV();
  const params = useSearchParams();
  const urlClimbKey = params.get("key") ?? "";
  // Optional route-lock params — when provided the S3RoutePicker is pre-filled
  // and the user can only select climbs from the same state/area/route.
  const urlState = params.get("state") ?? undefined;
  const urlArea  = params.get("area")  ?? undefined;
  const urlRoute = params.get("route") ?? undefined;
  const routeLocked = !!(urlState && urlArea && urlRoute);
  const { downloadAttempt } = useS3Storage();
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

  // Pre-load climb from ?key= URL param into the first slot.
  useEffect(() => {
    if (!urlClimbKey) return;
    let cancelled = false;
    (async () => {
      try {
        const loaded = await downloadAttempt(urlClimbKey);
        if (cancelled) return;
        saveAttempt(loaded);
        setAttempts(prev => { const n = [...prev]; n[0] = loaded; return n; });
        setSlotKeys(prev => { const n = [...prev]; n[0] = urlClimbKey; return n; });
      } catch { /* ignore — user can still select manually */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlClimbKey]);

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
    <div className="flex-1">
    <div className="mx-auto w-full max-w-4xl px-4 py-8 flex flex-col gap-6 sm:px-6 sm:py-10 sm:gap-8">
      {/* Header */}
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-bold tracking-tight text-fg sm:text-2xl">Compare Runs</h1>
        <p className="text-[13px] text-fg-secondary leading-relaxed">
          Select a route, then toggle climbs to compare them side by side or overlaid on the same route photo.
        </p>
      </div>

      {/* Single shared route picker with selectable climb entries */}
      <div className="flex flex-col gap-3">
        {routeLocked && (
          <p className="text-[11px] text-fg-muted">
            Showing climbs from <span className="font-medium text-fg">{urlRoute}</span> &middot; {urlArea} &middot; {urlState}
          </p>
        )}
        <S3RoutePicker
          label="Select Route"
          alwaysOpen
          selectable
          selectedKeys={selectedKeys}
          onLoad={handleSelectAttempt}
          onDeselect={handleDeselectAttempt}
          onRouteImageLoaded={handleRouteImageLoaded}
          defaultState={urlState}
          defaultArea={urlArea}
          defaultRoute={urlRoute}
        />
      </div>

      {/* Route photo */}
      <div className="flex flex-col gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fg-muted">Route photo</p>

        {imageFile && imagePreviewUrl ? (
          /* Image exists — show preview with update button in corner */
          <div className="flex flex-col gap-3">
            <div className="relative w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrl}
                alt="Route photo"
                className="max-h-128 w-full rounded-2xl border border-edge/50 bg-card/70 object-contain"
              />
              {!cropConfirmed && <CropBoxOverlay box={imageCrop} onChange={setImageCrop} />}

              {/* Update route photo — corner dropdown */}
              <div ref={updateMenuRef} className="absolute top-2 right-2">
                <button
                  onClick={() => setShowUpdateMenu(v => !v)}
                  className="flex items-center gap-1.5 rounded-lg bg-surface/80 backdrop-blur-xl px-3 py-1.5 text-xs font-medium text-fg border border-edge/50 hover:bg-surface hover:text-fg transition shadow-sm"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                  Update photo
                </button>
                {showUpdateMenu && (
                  <div className="absolute right-0 mt-1 w-44 rounded-xl border border-edge/50 bg-card/95 shadow-2xl overflow-hidden z-10 backdrop-blur-xl animate-fade-in">
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-xs text-fg-secondary hover:bg-inset hover:text-fg transition">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
                      </svg>
                      Select file
                      <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                    </label>
                    <button
                      onClick={() => { setShowUpdateMenu(false); setShowCamera(true); }}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-xs text-fg-secondary hover:bg-inset hover:text-fg transition"
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
                    "flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-surface shadow-lg shadow-accent/20 transition-all duration-200 hover:bg-accent-hover hover:shadow-accent/30 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]",
                    anyLoaded ? "ring-2 ring-accent/30 ring-offset-2 ring-offset-surface" : "",
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
                "flex cursor-pointer flex-col items-center gap-3 rounded-2xl border px-4 py-5 text-sm transition-all duration-200",
                "bg-card/50 border-edge/50 text-fg-secondary hover:border-accent/50 hover:bg-card/80 hover:text-fg",
                "border-accent/25",
              ].join(" ")}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
              </svg>
              <span className="font-medium text-fg">Select route photo</span>
              <span className="text-xs text-fg-muted">JPG, PNG, WebP</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
            </label>

            <button
              type="button"
              onClick={() => setShowCamera(true)}
              className={[
                "flex cursor-pointer flex-col items-center gap-3 rounded-2xl border px-4 py-5 text-sm transition-all duration-200",
                "bg-card/50 border-edge/50 text-fg-secondary hover:border-accent/50 hover:bg-card/80 hover:text-fg",
                "border-accent/25",
              ].join(" ")}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
              </svg>
              <span className="font-medium text-fg">Take a photo</span>
              <span className="text-xs text-fg-muted">Opens camera</span>
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
                "rounded-lg border px-4 py-2 text-sm font-medium transition-all duration-200",
                viewMode === mode
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-edge/50 bg-card/60 text-fg-muted hover:border-edge-hover hover:text-fg",
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
              className="flex items-center gap-1.5 rounded-lg border border-edge/50 bg-card/60 px-4 py-2 text-sm font-medium text-fg-muted transition-all duration-200 hover:border-edge-hover hover:text-fg"
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-fg-muted">
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
          <CompareOverlayPlayer
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
