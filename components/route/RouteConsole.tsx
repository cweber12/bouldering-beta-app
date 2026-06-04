"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/utils/cn";
import ToolRouteHeader from "@/components/layout/ToolRouteHeader";
import CropBoxOverlay, { type CropFraction } from "@/components/capture/CropBoxOverlay";
import CameraRecorderModal from "@/components/capture/CameraRecorderModal";
import CompareSlot from "@/components/compare/CompareSlot";
import CompareOverlayPlayer from "@/components/compare/CompareOverlayPlayer";
import CompareClimbRail from "@/components/compare/CompareClimbRail";
import CompareToolbar, { type ViewMode } from "@/components/compare/CompareToolbar";
import RunStatusDot from "@/components/run/RunStatusDot";
import { formatRunTimestamp } from "@/utils/formatRunTimestamp";
import { EMPTY_HIGHLIGHT, type HighlightSelection } from "@/utils/bodyRegions";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useS3Storage } from "@/hooks/useS3Storage";
import { saveAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";
import type { FramePlayerHandle } from "@/components/skeleton/FramePlayer";
import { mediaContainerStyle } from "@/utils/mediaContainerStyle";
import { dataUrlToFile } from "@/utils/imageHelpers";
import { buildRouteUrl, type ConsoleMode } from "@/utils/routeUrl";

// ---------------------------------------------------------------------------
// Types / constants
// ---------------------------------------------------------------------------

export interface RouteConsoleProps {
  /** Owner of the route (path param) — scopes the rail, climbs, and route photo. */
  userId: string;
  /** Route context (from the path). */
  state: string;
  area: string;
  route: string;
  /** Climb keys to load into slots on mount. */
  initialKeys: string[];
  /** Explicit console mode, or null to derive from the key count. */
  initialMode: ConsoleMode | null;
}

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
// RouteConsole — the climb console for a single route. Single mode = focused
// one-climb viewer; multiple mode = 2–4 climb comparison. Formerly the body of
// the /compare page; now driven by props from the /route/[userId]/… path.
// ---------------------------------------------------------------------------

export default function RouteConsole({
  userId,
  state,
  area,
  route,
  initialKeys,
  initialMode,
}: RouteConsoleProps) {
  const { cv } = useOpenCV();
  const router = useRouter();
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
  // S3 key of this route's saved Route Photo, or null when none exists. Detected
  // by a metadata-only list probe; the photo is never auto-applied — the chooser
  // offers "Use saved photo" alongside take/upload (camera is the priority case).
  const [savedPhotoKey, setSavedPhotoKey] = useState<string | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const imagePreviewUrlRef = useRef<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("overlay");

  // Console mode — single-climb viewer vs multi-climb comparison. Derived once
  // from the path/query: an explicit mode wins; otherwise the climb count decides.
  // Switching multiple→single keeps every loaded climb in its slot (the in-memory
  // slot arrays are the parking store); only the URL and the rendered view narrow
  // to the first climb, so single→multiple restores the rest for free this session.
  const [consoleMode, setConsoleModeState] = useState<ConsoleMode>(() =>
    initialMode === "single" || initialMode === "multiple"
      ? initialMode
      : initialKeys.length >= 2 ? "multiple" : "single",
  );
  const [matchResults, setMatchResults] = useState<(ImageMatchResult | null)[]>(
    () => Array.from({ length: MAX_SLOTS }, () => null),
  );

  // One hex limb color per slot; pre-populated from defaults so each slot
  // starts with a distinct color and duplicates are avoided by default.
  const [slotColors, setSlotColors] = useState<string[]>(
    () => [...DEFAULT_LIMB_COLORS],
  );

  // Per-slot start anchor (seconds). The frame the user flags as each climb's
  // sequence start; master play runs every climb from its own anchor, and the
  // overlay composite respects the same offsets.
  const [slotOffsets, setSlotOffsets] = useState<number[]>(
    () => Array.from({ length: MAX_SLOTS }, () => 0),
  );

  // Shared skeleton sizing applied to all slots simultaneously.
  const skeletonLineWidth = 2.5;
  const skeletonPointRadius = 2;

  // Body-part highlight focus — emphasizes selected regions across all climbs
  // and dims the rest. Empty = full-colour skeletons.
  const [highlight, setHighlight] = useState<HighlightSelection>(EMPTY_HIGHLIGHT);

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

  // Measured height of the side-by-side stage — drives per-column width so the
  // portrait overlays size to the media and sit close together (not marooned in
  // 50% cells). 0 until measured; columns fill until then.
  const [stageH, setStageH] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

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

  // URL sync is a side effect of state, never a render-time action.
  const didMountSyncRef = useRef(false);
  useEffect(() => {
    if (!didMountSyncRef.current) {
      didMountSyncRef.current = true;
      return;
    }
    const active = activeKeysOf(slotKeys);
    const keysForUrl = consoleMode === "single" ? active.slice(0, 1) : active;
    router.replace(
      buildRouteUrl(userId, { state, area, route }, { keys: keysForUrl, mode: consoleMode }),
      { scroll: false },
    );
  }, [slotKeys, consoleMode, router, userId, state, area, route]);

  /** Flips console mode and re-syncs the URL; slot data is untouched (parked). */
  const setConsoleMode = useCallback((next: ConsoleMode) => {
    setConsoleModeState(next);
  }, []);

  /** Adds a climb to the first free slot (no-op when full or already present). */
  const addClimb = useCallback((key: string) => {
    if (slotKeys.includes(key)) return;
    const slot = slotKeys.findIndex((k) => k === null);
    if (slot === -1) return; // at max
    const next = [...slotKeys];
    next[slot] = key;
    setSlotKeys(next);
    void loadIntoSlot(slot, key);
  }, [slotKeys, loadIntoSlot]);

  /**
   * Single-mode selection: collapse to exactly one shown climb. Reuses the
   * already-loaded attempt when the tapped climb was parked in another slot,
   * otherwise loads it. Clearing the other slots is intentional — single mode
   * means one selected climb, so picking a new one replaces the set. (A plain
   * multiple→single→multiple toggle without tapping the rail still preserves the
   * set, because that path never calls this.)
   */
  const swapSingle = useCallback((key: string) => {
    const fromSlot = slotKeys.indexOf(key);
    if (fromSlot === 0 && activeKeysOf(slotKeys).length === 1) return; // already the sole climb
    const existing = fromSlot !== -1 ? attempts[fromSlot] : null;
    const nextKeys = Array.from({ length: MAX_SLOTS }, (_, i) => (i === 0 ? key : null));
    setSlotKeys(nextKeys);
    setAttempts(Array.from({ length: MAX_SLOTS }, (_, i) => (i === 0 ? existing : null)));
    setMatchResults(Array.from({ length: MAX_SLOTS }, () => null));
    setSlotOffsets(Array.from({ length: MAX_SLOTS }, () => 0));
    if (!existing) void loadIntoSlot(0, key);
  }, [slotKeys, attempts, loadIntoSlot]);

  /** Removes a climb, freeing its slot without reshuffling the others. */
  const removeClimb = useCallback((key: string) => {
    const slot = slotKeys.findIndex((k) => k === key);
    if (slot === -1) return;
    setSlotKeys((prev) => {
      const n = [...prev];
      n[slot] = null;
      return n;
    });
    setAttempts((a) => { const n = [...a]; n[slot] = null; return n; });
    setMatchResults((m) => { const n = [...m]; n[slot] = null; return n; });
    setSlotOffsets((o) => { const n = [...o]; n[slot] = 0; return n; });
  }, [slotKeys]);

  // Pre-load climbs from the path/query into slots (once, on mount).
  useEffect(() => {
    const initial = Array.from({ length: MAX_SLOTS }, (_, i) => initialKeys[i] ?? null);
    setSlotKeys(initial);
    initial.forEach((key, i) => { if (key) void loadIntoSlot(i, key); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // intentionally run once on mount

  // Detect whether this route has a saved Route Photo — a metadata-only list
  // probe, NOT a download. We never auto-apply it: the chooser surfaces "Use
  // saved photo" only when one exists, and the full object is fetched lazily on
  // click (see handleUseSavedPhoto). Keeps the camera-first path zero-cost.
  useEffect(() => {
    if (!userId || !state || !area || !route) return;
    let cancelled = false;
    // Raw (unencoded) names as stored in the key; only the query transport is
    // encoded, so encoding the segments here too would double-encode.
    const prefix = `RouteData/${userId}/${state}/${area}/${route}/`;
    const photoKey = `${prefix}route-image.json`;
    (async () => {
      try {
        const res = await fetch(`/api/s3/list?prefix=${encodeURIComponent(prefix)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { objects?: { Key?: string }[] };
        const exists = (data.objects ?? []).some((o) => o.Key === photoKey);
        if (!cancelled) setSavedPhotoKey(exists ? photoKey : null);
      } catch { /* no saved-photo option — the user can still take/upload */ }
    })();
    return () => { cancelled = true; };
  }, [userId, state, area, route]);

  // Auto-match: as soon as a route photo and at least one climb are both ready,
  // run the match once — no "Apply" gate. Newly added slots match on their own
  // (CompareSlot re-runs when its attempt id changes and matchTrigger is non-zero).
  const anyLoaded = attempts.some(Boolean);
  useEffect(() => {
    if (!cv || !imageFile || !anyLoaded) return;
    setMatchTrigger(t => (t === 0 ? 1 : t));
  }, [cv, imageFile, anyLoaded]);

  // Auto re-match when the crop changes (debounced). Once an initial match has
  // run, adjusting the crop in the Refine panel re-runs matching automatically —
  // no need to find a separate button. `imageCrop` is a new object reference only
  // when the user actually edits the crop, so unrelated re-renders are ignored.
  const cropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCropRef = useRef(imageCrop);
  useEffect(() => {
    if (prevCropRef.current === imageCrop) return; // not a crop edit
    prevCropRef.current = imageCrop;
    if (!cv || !imageFile || !anyLoaded || matchTrigger === 0) return;
    if (cropTimerRef.current) clearTimeout(cropTimerRef.current);
    cropTimerRef.current = setTimeout(() => setMatchTrigger(t => t + 1), 400);
    return () => { if (cropTimerRef.current) clearTimeout(cropTimerRef.current); };
  }, [imageCrop, cv, imageFile, anyLoaded, matchTrigger]);

  // Close update menu on outside click.
  useClickOutside(updateMenuRef, () => setShowUpdateMenu(false), showUpdateMenu, "pointerdown");

  // Revoke objectURL on unmount.
  useEffect(() => {
    return () => {
      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    };
  }, []);

  // Capture the route-photo natural size as soon as a photo is set, so column
  // sizing has the correct aspect even before the Refine panel is opened.
  useEffect(() => {
    if (!imagePreviewUrl) return;
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled && img.naturalWidth && img.naturalHeight) {
        setImageSize({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.src = imagePreviewUrl;
    return () => { cancelled = true; };
  }, [imagePreviewUrl]);

  // Track the side-by-side stage height so columns can be capped to the media
  // width. Re-attaches when the stage mounts (view-mode switch).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setStageH(e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode, imagePreviewUrl, refineOpen, consoleMode]);

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

  // Flag the slot player's current scrub position as that climb's start.
  const handleSetStart = useCallback((idx: number) => {
    const t = playerRefs.current[idx]?.getCurrentTime() ?? 0;
    setSlotOffsets((prev) => { const n = [...prev]; n[idx] = t; return n; });
  }, []);

  const handleClearStart = useCallback((idx: number) => {
    setSlotOffsets((prev) => { const n = [...prev]; n[idx] = 0; return n; });
  }, []);

  /** Applies a chosen photo through the shared selection path: resets the crop
   *  and clears stale matches so every slot re-matches against the new photo. */
  function applyPhoto(file: File) {
    setImageFileWithPreview(file);
    setImageCrop({ x: 0, y: 0, w: 1, h: 1 });
    setMatchResults(Array.from({ length: MAX_SLOTS }, () => null));
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    applyPhoto(file);
    setShowUpdateMenu(false);
  }

  function handleCameraCapture(file: File) {
    applyPhoto(file);
    setShowCamera(false);
    setShowUpdateMenu(false);
  }

  /** Lazily downloads the saved Route Photo and applies it via the same path as
   *  take/upload — so matching always runs and the overlay renders. */
  async function handleUseSavedPhoto() {
    if (!savedPhotoKey || loadingSaved) return;
    setLoadingSaved(true);
    try {
      const res = await fetch(`/api/s3/get?key=${encodeURIComponent(savedPhotoKey)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { dataUrl?: string };
      if (!data.dataUrl) return;
      applyPhoto(await dataUrlToFile(data.dataUrl, "route-image.jpg"));
      setShowUpdateMenu(false);
    } catch { /* leave the chooser up — the user can take/upload instead */ }
    finally { setLoadingSaved(false); }
  }

  /** Re-runs matching across all slots (after a crop or photo change). */
  function handleReMatch() {
    if (cropTimerRef.current) clearTimeout(cropTimerRef.current);
    setMatchTrigger(t => t + 1);
    setRefineOpen(false); // collapse so the updated comparison is visible
  }

  const hasPhoto = !!(imageFile && imagePreviewUrl);
  // Route grade lives per-attempt; compared climbs share a route so the grade is
  // consistent — surface the first non-empty one, accented, next to the route name.
  const grade = attempts.find((a) => a?.rating)?.rating ?? null;
  const subtitle: React.ReactNode = route ? (
    <span>
      {route}
      {grade && <span className="ml-1.5 font-semibold text-accent">{grade}</span>}
      {area && <span className="text-fg-secondary"> · {area}</span>}
      {state && <span className="text-fg-secondary"> · {state}</span>}
    </span>
  ) : (
    "Compare loaded climbs side by side or overlaid."
  );

  // Derived rail props: which keys are active and each active key's colour.
  const activeKeys = activeKeysOf(slotKeys);
  // The slot shown in single mode — the first occupied slot. Other loaded
  // climbs stay parked; the rail swaps which one occupies this slot.
  const singleIdx = slotKeys.findIndex((k) => k !== null);

  // Side-by-side column sizing. All overlays share the route-photo aspect, so we
  // cap each column to the media's display width (measured stage height minus the
  // per-slot chrome). fit="contain" handles any residual fitting. Undefined until
  // measured — columns simply fill their cells until then.
  const mediaAspect = imageSize.h > 0 ? imageSize.w / imageSize.h : 4 / 3;
  const SLOT_CHROME_PX = 96; // metadata row + transport bar + download + gaps
  const stageRows = activeKeys.length > 2 ? 2 : 1;
  const perRowH = stageH > 0 ? (stageH - (stageRows - 1) * 16) / stageRows : 0;
  const colMaxW = perRowH > SLOT_CHROME_PX ? (perRowH - SLOT_CHROME_PX) * mediaAspect : undefined;
  const colorForKey = useCallback((key: string): string | null => {
    const slot = slotKeys.indexOf(key);
    return slot === -1 ? null : slotColors[slot];
  }, [slotKeys, slotColors]);

  // Stage controls live in the header (in line with the route info) so the
  // overlay previews get the full height below. Only shown once a photo exists.
  const headerActions = hasPhoto ? (
    <CompareToolbar
      consoleMode={consoleMode}
      viewMode={viewMode}
      onViewMode={setViewMode}
      masterPlaying={masterPlaying}
      onTogglePlayAll={() => {
        const next = !masterPlaying;
        setMasterPlaying(next);
        for (let i = 0; i < MAX_SLOTS; i++) {
          const ref = playerRefs.current[i];
          if (!ref) continue;
          if (next) { ref.seek(slotOffsets[i]); ref.play(); }
          else ref.pause();
        }
      }}
      highlight={highlight}
      onHighlightChange={setHighlight}
      refineOpen={refineOpen}
      onToggleRefine={() => setRefineOpen(v => !v)}
    />
  ) : undefined;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <ToolRouteHeader title="Route" subtitle={subtitle} actions={headerActions} />

      {/* Rail (left on desktop, bottom strip on mobile) + main column. */}
      <div className="flex-1 min-h-0 flex flex-col-reverse overflow-hidden sm:flex-row">
        {state && area && route && (
          <CompareClimbRail
            className="max-h-[42%] border-t border-edge/40 sm:max-h-none sm:w-64 sm:border-r sm:border-t-0"
            userId={userId}
            state={state}
            area={area}
            route={route}
            mode={consoleMode}
            onToggleMode={() => setConsoleMode(consoleMode === "single" ? "multiple" : "single")}
            activeKeys={
              consoleMode === "single"
                ? (singleIdx !== -1 ? [slotKeys[singleIdx] as string] : [])
                : activeKeys
            }
            colorForKey={colorForKey}
            atMax={activeKeys.length >= MAX_SLOTS}
            minToCompare={MIN_TO_COMPARE}
            onAdd={consoleMode === "single" ? swapSingle : addClimb}
            onRemove={removeClimb}
          />
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

      {/* No route photo yet — the comparison needs a frame to overlay onto. */}
      {!hasPhoto && (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
            <p className="mb-3 text-sm text-fg-secondary">
              Take a photo of the wall to overlay {anyLoaded ? "the loaded climbs" : "climbs"} on it
              {savedPhotoKey ? ", or reuse this route's saved photo" : ""}.
            </p>

            {/* Primary: take a photo — the priority case (you're at the wall). */}
            <button
              type="button"
              onClick={() => setShowCamera(true)}
              className={cn(
                "mb-3 flex w-full cursor-pointer items-center justify-center gap-3 rounded-lg border px-4 py-5 text-sm transition-colors duration-150",
                "border-accent/50 bg-accent/10 text-fg hover:border-accent hover:bg-accent/15",
              )}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
              </svg>
              <span className="font-medium">Take a photo</span>
            </button>

            {/* Secondary: upload a file, or reuse the saved route photo if one exists. */}
            <div className="flex gap-3">
              <label
                className={cn(
                  "flex flex-1 cursor-pointer flex-col items-center gap-2 rounded-lg border px-4 py-4 text-sm transition-colors duration-150",
                  "bg-card/50 border-accent/25 text-fg-secondary hover:border-accent/50 hover:bg-card/80 hover:text-fg",
                )}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
                </svg>
                <span className="font-medium text-fg">Upload a photo</span>
                <span className="text-xs text-fg-muted">JPG, PNG, WebP</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              </label>

              {savedPhotoKey && (
                <button
                  type="button"
                  onClick={handleUseSavedPhoto}
                  disabled={loadingSaved}
                  className={cn(
                    "flex flex-1 cursor-pointer flex-col items-center gap-2 rounded-lg border px-4 py-4 text-sm transition-colors duration-150 disabled:cursor-wait disabled:opacity-60",
                    "bg-card/50 border-accent/25 text-fg-secondary hover:border-accent/50 hover:bg-card/80 hover:text-fg",
                  )}
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
                  </svg>
                  <span className="font-medium text-fg">{loadingSaved ? "Loading…" : "Use saved photo"}</span>
                  <span className="text-xs text-fg-muted">{"This route's photo"}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Comparison view — shows immediately once a photo is available. */}
      {hasPhoto && (
        <>
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
                        {savedPhotoKey && (
                          <button
                            onClick={handleUseSavedPhoto}
                            disabled={loadingSaved}
                            className="flex w-full items-center gap-2 px-3 py-2.5 text-xs text-fg-secondary transition hover:bg-inset/80 hover:text-fg disabled:cursor-wait disabled:opacity-60"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
                            </svg>
                            {loadingSaved ? "Loading…" : "Use saved photo"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-fg-secondary">
                    Adjust the crop to focus matching on the relevant wall area —
                    changes apply automatically.
                  </p>
                  <button
                    onClick={handleReMatch}
                    disabled={!anyLoaded}
                    className="ui-control-primary shrink-0 rounded-lg px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Done
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

            {/* Single mode — focused one-climb viewer. One CompareSlot, centered
                and capped to the media width, with its own play button; no colour
                swatch or start anchors (those only matter when aligning climbs). */}
            {consoleMode === "single" && anyLoaded && singleIdx !== -1 && attempts[singleIdx] && (
              <div
                ref={stageRef}
                className="flex h-full min-h-0 items-stretch justify-center rounded-xl border border-edge/40 bg-card/20 p-3"
              >
                <div
                  className="flex h-full min-h-0 w-full"
                  style={colMaxW ? { maxWidth: colMaxW } : undefined}
                >
                  <CompareSlot
                    slotIndex={singleIdx}
                    attempt={attempts[singleIdx]}
                    imageFile={imageFile}
                    imageCrop={imageCrop}
                    matchTrigger={matchTrigger}
                    cv={cv}
                    limbColor={slotColors[singleIdx]}
                    lineWidth={skeletonLineWidth}
                    pointRadius={skeletonPointRadius}
                    highlight={highlight}
                    onMatchResult={handleMatchResult}
                    fillHeight
                    playerRef={(el) => { playerRefs.current[singleIdx] = el; }}
                  />
                </div>
              </div>
            )}

            {/* Side-by-side — all climbs grouped under one shared surface, each
                column capped to the media width so the overlays sit close. */}
            {consoleMode === "multiple" && viewMode === "sidebyside" && anyLoaded && (
              <div className="h-full min-h-0 rounded-xl border border-edge/40 bg-card/20 p-3">
                <div
                  ref={stageRef}
                  className={cn(
                    "flex h-full min-h-0 content-center items-stretch justify-center gap-4",
                    activeKeys.length > 2 ? "flex-wrap" : "flex-nowrap",
                  )}
                >
                  {Array.from({ length: MAX_SLOTS }, (_, i) =>
                    attempts[i] ? (
                      <div
                        key={i}
                        className={cn(
                          "flex min-w-0 min-h-0 flex-1 basis-0",
                          activeKeys.length > 2 && "basis-[calc(50%-0.5rem)] grow-0",
                        )}
                        style={colMaxW ? { maxWidth: colMaxW } : undefined}
                      >
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
                          highlight={highlight}
                          startOffset={slotOffsets[i]}
                          onMatchResult={handleMatchResult}
                          onColorChange={handleColorChange}
                          onSetStart={handleSetStart}
                          onClearStart={handleClearStart}
                          hidePlayButton
                          fillHeight
                          playerRef={(el) => { playerRefs.current[i] = el; }}
                        />
                      </div>
                    ) : null,
                  )}
                </div>
              </div>
            )}

            {/* Overlay (default) — all skeletons on one frame. The matchers still
                run per-slot via hidden CompareSlots so each slot's match result
                feeds the overlay player. */}
            {consoleMode === "multiple" && viewMode === "overlay" && anyLoaded && (
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
                        highlight={highlight}
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
                    highlight={highlight}
                    slotOffsets={slotOffsets}
                  />
                </div>

                {/* Legend — editable colour ↔ climb identity (date distinguishes runs). */}
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {attempts.map((att, i) => {
                    if (!att) return null;
                    const ts = formatRunTimestamp(att.id);
                    return (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 rounded-full border border-edge/60 bg-card/60 py-1 pl-1.5 pr-2.5 text-xs"
                      >
                        <label
                          className="relative inline-flex h-4 w-4 shrink-0 cursor-pointer rounded-md ring-1 ring-edge/60 transition hover:ring-edge-hover"
                          style={{ backgroundColor: slotColors[i] }}
                          title="Climb colour"
                        >
                          <input
                            type="color"
                            value={slotColors[i]}
                            onChange={(e) => handleColorChange(i, e.target.value)}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            aria-label="Climb colour"
                          />
                        </label>
                        <span className="font-medium text-fg">{ts ? ts.date : att.route}</span>
                        {ts && <span className="text-fg-muted">{ts.time}</span>}
                        <RunStatusDot runType={att.runType} />
                      </span>
                    );
                  })}
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
