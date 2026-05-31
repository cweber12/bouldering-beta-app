"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/utils/cn";
import LoadingGate from "@/components/shared/LoadingGate";
import ToolPageShell from "@/components/shared/ToolPageShell";
import ToolRouteHeader from "@/components/shared/ToolRouteHeader";
import CropBoxOverlay, { type CropFraction } from "@/components/shared/CropBoxOverlay";
import CameraRecorderModal from "@/components/shared/CameraRecorderModal";
import CompareSlot from "@/components/compare/CompareSlot";
import CompareOverlayPlayer from "@/components/compare/CompareOverlayPlayer";
import CompareClimbRail from "@/components/compare/CompareClimbRail";
import CompareToolbar, { type ViewMode } from "@/components/compare/CompareToolbar";
import RunTypeBadge from "@/components/shared/RunTypeBadge";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useS3Storage } from "@/hooks/useS3Storage";
import { useAuth } from "@/hooks/useAuth";
import { saveAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";
import type { FramePlayerHandle } from "@/components/shared/FramePlayer";
import { mediaContainerStyle } from "@/utils/mediaContainerStyle";
import { buildCompareUrl } from "@/utils/compareUrl";

// ---------------------------------------------------------------------------
// Types / constants
// ---------------------------------------------------------------------------

/**
 * Default limb colors for new slots (hex, accepted by CSS and SkeletonStyle).
 * Each slot index gets a visually distinct color from the start. A climb keeps
 * its slot — and therefore its color — for the life of the session; removing a
 * climb frees its slot without reshuffling the others.
 */
const DEFAULT_LIMB_COLORS = ["#00d273", "#38bdf8", "#fb923c", "#c084fc"];

const MAX_SLOTS = 4;
const MIN_TO_COMPARE = 2;

/** Active (non-null) keys in slot order — the value mirrored into the URL. */
function activeKeysOf(slotKeys: (string | null)[]): string[] {
  return slotKeys.filter((k): k is string => Boolean(k));
}

// ---------------------------------------------------------------------------
// Main compare page
// ---------------------------------------------------------------------------
function ComparePageInner() {
  const { cv } = useOpenCV();
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  // Accept ?keys=<csv> (multi-climb entry point) with ?key= backward-compat.
  const urlClimbKeys: string[] = (() => {
    const csv = params.get("keys");
    if (csv) return csv.split(",").map(k => k.trim()).filter(Boolean);
    const single = params.get("key");
    return single ? [single] : [];
  })();
  // Route context — used for the page header, route-photo auto-load, and the
  // climb rail (added in a later task).
  const urlState = params.get("state") ?? undefined;
  const urlArea  = params.get("area")  ?? undefined;
  const urlRoute = params.get("route") ?? undefined;
  const { downloadAttempt } = useS3Storage();

  // The comparison is a fixed set of up to MAX_SLOTS slots. `slotKeys` is the S3
  // key occupying each slot (the value mirrored into the URL); `attempts` is the
  // loaded data. Slot index drives the identity color, and a climb keeps its
  // slot — and colour — for the session; removing one frees its slot without
  // reshuffling the others.
  const [slotKeys, setSlotKeys] = useState<(string | null)[]>(
    () => Array.from({ length: MAX_SLOTS }, () => null),
  );
  const [attempts, setAttempts] = useState<(RouteAttempt | null)[]>(
    () => Array.from({ length: MAX_SLOTS }, () => null),
  );

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  // Natural dimensions of the loaded route photo (needed for the aspect-ratio container).
  const [imageSize, setImageSize] = useState<{ w: number; h: number }>({ w: 4, h: 3 });
  const [showCamera, setShowCamera] = useState(false);
  // True once the user has manually supplied a photo — suppresses the S3 auto-load.
  const [userPickedImage, setUserPickedImage] = useState(false);
  const imagePreviewUrlRef = useRef<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("overlay");
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
  // Incremented to (re)run matching across all slots. Starts at 0 (no match yet);
  // the auto-match effect bumps it to 1 once a photo and a climb are both ready.
  const [matchTrigger, setMatchTrigger] = useState(0);

  // Refine disclosure — the route photo + crop controls, collapsed by default.
  const [refineOpen, setRefineOpen] = useState(false);

  // Dropdown state for the in-refine "Update photo" button.
  const [showUpdateMenu, setShowUpdateMenu] = useState(false);
  const updateMenuRef = useRef<HTMLDivElement>(null);

  // FramePlayer refs for master play control (side-by-side).
  const playerRefs = useRef<(FramePlayerHandle | null)[]>(
    Array.from({ length: MAX_SLOTS }, () => null),
  );
  const [masterPlaying, setMasterPlaying] = useState(false);

  // ── Slot loading + URL sync ──────────────────────────────────────────────

  /** Loads an S3 climb into a specific slot. */
  const loadIntoSlot = useCallback(async (slot: number, key: string) => {
    try {
      const a = await downloadAttempt(key);
      saveAttempt(a);
      setAttempts(prev => { const n = [...prev]; n[slot] = a; return n; });
    } catch { /* leave the slot empty — the rail still shows the climb as available */ }
  }, [downloadAttempt]);

  /** Rewrites `keys` in the URL (replace — no history entry, no scroll). */
  const syncUrl = useCallback((nextSlotKeys: (string | null)[]) => {
    router.replace(
      buildCompareUrl(activeKeysOf(nextSlotKeys), { state: urlState, area: urlArea, route: urlRoute }),
      { scroll: false },
    );
  }, [router, urlState, urlArea, urlRoute]);

  /** Adds a climb to the first free slot (no-op when full or already present). */
  const addClimb = useCallback((key: string) => {
    setSlotKeys(prev => {
      if (prev.includes(key)) return prev;
      const slot = prev.findIndex(k => k === null);
      if (slot === -1) return prev; // at max
      const next = [...prev];
      next[slot] = key;
      void loadIntoSlot(slot, key);
      syncUrl(next);
      return next;
    });
  }, [loadIntoSlot, syncUrl]);

  /** Removes a climb, freeing its slot without reshuffling the others. */
  const removeClimb = useCallback((key: string) => {
    setSlotKeys(prev => {
      const slot = prev.findIndex(k => k === key);
      if (slot === -1) return prev;
      const next = [...prev];
      next[slot] = null;
      setAttempts(a => { const n = [...a]; n[slot] = null; return n; });
      setMatchResults(m => { const n = [...m]; n[slot] = null; return n; });
      syncUrl(next);
      return next;
    });
  }, [syncUrl]);

  // Pre-load climbs from URL params into slots (once, on mount).
  useEffect(() => {
    const initial = Array.from({ length: MAX_SLOTS }, (_, i) => urlClimbKeys[i] ?? null);
    setSlotKeys(initial);
    initial.forEach((key, i) => { if (key) void loadIntoSlot(i, key); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // intentionally run once on mount

  // Auto-load route photo from S3 when route context is provided in the URL.
  // The user can always manually override by uploading their own photo.
  useEffect(() => {
    if (!urlState || !urlArea || !urlRoute || userPickedImage) return;
    let cancelled = false;
    (async () => {
      try {
        const key = `RouteData/_/${encodeURIComponent(urlState)}/${encodeURIComponent(urlArea)}/${encodeURIComponent(urlRoute)}/route-image.json`;
        const res = await fetch(`/api/s3/get?key=${encodeURIComponent(key)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { dataUrl?: string };
        if (!data.dataUrl || cancelled) return;
        // Convert the data URL to a File so the existing imageFile pipeline works.
        const blob = await fetch(data.dataUrl).then(r => r.blob());
        const file = new File([blob], "route-image.jpg", { type: blob.type || "image/jpeg" });
        if (cancelled) return;
        setImageFileWithPreview(file);
      } catch { /* silently skip — user can still upload manually */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlState, urlArea, urlRoute]); // userPickedImage intentionally omitted — only run when route changes

  // Auto-match: as soon as a route photo and at least one climb are both ready,
  // run the match once — no "Apply" gate. Newly added slots match on their own
  // (CompareSlot re-runs when its attempt id changes and matchTrigger is non-zero).
  const anyLoaded = attempts.some(Boolean);
  useEffect(() => {
    if (!cv || !imageFile || !anyLoaded) return;
    setMatchTrigger(t => (t === 0 ? 1 : t));
  }, [cv, imageFile, anyLoaded]);

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
    } else {
      setImagePreviewUrl(null);
    }
  }

  const handleMatchResult = useCallback((idx: number, result: ImageMatchResult | null) => {
    setMatchResults(prev => {
      const next = [...prev];
      next[idx] = result;
      return next;
    });
  }, []);

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
    setMatchResults(Array.from({ length: MAX_SLOTS }, () => null));
    setShowUpdateMenu(false);
  }

  function handleCameraCapture(file: File) {
    setImageFileWithPreview(file);
    setUserPickedImage(true);
    setImageCrop({ x: 0, y: 0, w: 1, h: 1 });
    setMatchResults(Array.from({ length: MAX_SLOTS }, () => null));
    setShowCamera(false);
    setShowUpdateMenu(false);
  }

  /** Re-runs matching across all slots (after a crop or photo change). */
  function handleReMatch() {
    setMatchTrigger(t => t + 1);
  }

  const hasPhoto = !!(imageFile && imagePreviewUrl);
  const subtitle = urlRoute
    ? `${urlRoute}${urlArea ? ` · ${urlArea}` : ""}${urlState ? ` · ${urlState}` : ""}`
    : "Compare loaded climbs side by side or overlaid.";

  // Derived rail props: which keys are active and each active key's colour.
  const activeKeys = activeKeysOf(slotKeys);
  const colorForKey = useCallback((key: string): string | null => {
    const slot = slotKeys.indexOf(key);
    return slot === -1 ? null : slotColors[slot];
  }, [slotKeys, slotColors]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <ToolRouteHeader title="Compare" subtitle={subtitle} />

      {/* Rail (left on desktop, bottom strip on mobile) + main column. */}
      <div className="flex-1 min-h-0 flex flex-col-reverse overflow-hidden sm:flex-row">
        {user && urlState && urlArea && urlRoute && (
          <CompareClimbRail
            className="max-h-[42%] border-t border-edge/40 sm:max-h-none sm:w-52 sm:border-r sm:border-t-0"
            userId={user.uid}
            state={urlState}
            area={urlArea}
            route={urlRoute}
            activeKeys={activeKeys}
            colorForKey={colorForKey}
            atMax={activeKeys.length >= MAX_SLOTS}
            minToCompare={MIN_TO_COMPARE}
            onAdd={addClimb}
            onRemove={removeClimb}
          />
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

      {/* No route photo yet — the comparison needs a frame to overlay onto. */}
      {!hasPhoto && (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
            <p className="mb-3 text-sm text-fg-secondary">
              Add a route photo to compare {anyLoaded ? "the loaded climbs" : "climbs"} on it.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-3 rounded-lg border px-4 py-5 text-sm transition-colors duration-150",
                  "bg-card/50 border-accent/25 text-fg-secondary hover:border-accent/50 hover:bg-card/80 hover:text-fg",
                )}
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
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-3 rounded-lg border px-4 py-5 text-sm transition-colors duration-150",
                  "bg-card/50 border-accent/25 text-fg-secondary hover:border-accent/50 hover:bg-card/80 hover:text-fg",
                )}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                </svg>
                <span className="font-medium text-fg">Take a photo</span>
                <span className="text-xs text-fg-muted">Opens camera</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Comparison view — shows immediately once a photo is available. */}
      {hasPhoto && (
        <>
          {/* Toolbar */}
          <CompareToolbar
            viewMode={viewMode}
            onViewMode={setViewMode}
            masterPlaying={masterPlaying}
            onTogglePlayAll={() => {
              const next = !masterPlaying;
              setMasterPlaying(next);
              for (let i = 0; i < MAX_SLOTS; i++) {
                const ref = playerRefs.current[i];
                if (ref) { if (next) ref.play(); else ref.pause(); }
              }
            }}
            onSkeletonStyle={(s) => {
              if (s.lineWidth != null) setSkeletonLineWidth(s.lineWidth);
              if (s.pointRadius != null) setSkeletonPointRadius(s.pointRadius);
            }}
            refineOpen={refineOpen}
            onToggleRefine={() => setRefineOpen(v => !v)}
            activeSlots={attempts.flatMap((a, i) => (a ? [{ index: i, color: slotColors[i] }] : []))}
            onColorChange={handleColorChange}
          />

          {/* Refine panel — route photo + crop, collapsed by default. */}
          {refineOpen && (
            <div className="shrink-0 border-b border-edge/30 px-4 py-3">
              <div className="mx-auto flex w-full max-w-md flex-col gap-3">
                <div className="relative" style={mediaContainerStyle(imageSize.w, imageSize.h, "12rem")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreviewUrl!}
                    alt="Route photo"
                    className="absolute inset-0 h-full w-full rounded-lg border border-edge/50 bg-surface-alt/40 object-fill"
                    onLoad={(e) => {
                      const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                      if (w && h) setImageSize({ w, h });
                    }}
                  />
                  <CropBoxOverlay box={imageCrop} onChange={setImageCrop} />

                  {/* Update route photo — corner dropdown */}
                  <div ref={updateMenuRef} className="absolute top-2 right-2">
                    <button
                      onClick={() => setShowUpdateMenu(v => !v)}
                      className="ui-control flex items-center gap-1.5 bg-surface/80 px-3 py-1.5 text-xs font-medium text-fg"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                      </svg>
                      Update photo
                    </button>
                    {showUpdateMenu && (
                      <div className="ui-popover animate-fade-in absolute right-0 z-10 mt-1 w-44 overflow-hidden">
                        <label className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-xs text-fg-secondary transition hover:bg-inset/80 hover:text-fg">
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
                          </svg>
                          Select file
                          <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                        </label>
                        <button
                          onClick={() => { setShowUpdateMenu(false); setShowCamera(true); }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-xs text-fg-secondary transition hover:bg-inset/80 hover:text-fg"
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

                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-fg-secondary">
                    Adjust the crop to focus matching on the relevant wall area.
                  </p>
                  <button
                    onClick={handleReMatch}
                    disabled={!anyLoaded}
                    className="ui-control-primary shrink-0 rounded-lg px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Re-match
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Stage — fills remaining height; never grows past the viewport. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            {!anyLoaded && (
              <p className="py-12 text-center text-sm text-fg-muted">
                No climbs loaded yet.
              </p>
            )}

            {/* Side-by-side — viewport-fit grid; rows share the stage height so
                portrait frames shrink to fit rather than overflowing. */}
            {viewMode === "sidebyside" && anyLoaded && (
              <div
                className={cn(
                  "grid h-full min-h-0 gap-3",
                  activeKeys.length <= 1 ? "grid-cols-1" : "grid-cols-2",
                  activeKeys.length <= 2 ? "grid-rows-1" : "grid-rows-2",
                )}
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
                      hidePlayButton
                      fillHeight
                      playerRef={(el) => { playerRefs.current[i] = el; }}
                    />
                  ) : null,
                )}
              </div>
            )}

            {/* Overlay (default) — all skeletons on one frame. The matchers still
                run per-slot via hidden CompareSlots so each slot's match result
                feeds the overlay player. */}
            {viewMode === "overlay" && anyLoaded && (
              <div className="flex h-full min-h-0 flex-col gap-2">
                {/* Hidden matcher slots — feed each slot's match result to the
                    overlay player without rendering a visible card. */}
                <div className="hidden">
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
                        hidePlayer
                      />
                    ) : null,
                  )}
                </div>

                <div className="min-h-0 flex-1">
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

                {/* Legend — color ↔ climb identity. */}
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {attempts.map((att, i) =>
                    att ? (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 rounded-full border border-edge/60 bg-card/60 py-1 pl-1.5 pr-2.5 text-xs"
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slotColors[i] }} />
                        <span className="font-medium text-fg">{att.route || `Climb ${i + 1}`}</span>
                        <RunTypeBadge runType={att.runType} className="px-1 py-0 text-[9px] uppercase tracking-wider" />
                      </span>
                    ) : null,
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

        </div>
      </div>

      {showCamera && (
        <CameraRecorderModal
          mode="photo"
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <LoadingGate>
      <ToolPageShell>
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
              Loading&#8230;
            </div>
          }
        >
          <ComparePageInner />
        </Suspense>
      </ToolPageShell>
    </LoadingGate>
  );
}
