"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useS3Storage } from "@/hooks/useS3Storage";
import type { S3AttemptEntry } from "@/hooks/useS3Storage";
import { attemptTimestampLabel, loadAttemptFromJson, parseRunType } from "@/utils/fsHelpers";
import { saveAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lightweight metadata extracted from a downloaded run JSON. */
interface RunMeta {
  rating?: string;
  duration?: number;
  notes?: string;
  runType: string;
  /** Timestamp parsed from filename for analysis graph. */
  timestamp: number;
  /** Scaled-down PNG data URL with ORB keypoints drawn. */
  thumbnail?: string;
}

type AnalysisTab = "day" | "week" | "month" | "all";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Resize and JPEG-compress a File to a base64 data URL (max 1280×960, 82 % quality). */
async function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_W = 1280, MAX_H = 960;
      const scale = Math.min(1, MAX_W / img.naturalWidth, MAX_H / img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.naturalWidth  * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("canvas context unavailable")); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

const ANALYSIS_TABS: AnalysisTab[] = ["day", "week", "month", "all"];
const TAB_MS: Record<AnalysisTab, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  all: Infinity,
};

// ---------------------------------------------------------------------------
// RouteAnalysisGraph — inline SVG time-series chart
// ---------------------------------------------------------------------------

function RouteAnalysisGraph({
  runMeta,
}: {
  runMeta: Map<string, RunMeta>;
}) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [activeTab, setActiveTab] = useState<AnalysisTab>("all");
  const [cutoff, setCutoff] = useState(0);

  const handleTabChange = useCallback((tab: AnalysisTab) => {
    setActiveTab(tab);
    setCutoff(TAB_MS[tab] === Infinity ? 0 : Date.now() - TAB_MS[tab]);
  }, []);

  const points = useMemo(() => {
    const pts: Array<{ ts: number; duration: number; isSend: boolean }> = [];
    for (const m of runMeta.values()) {
      if (m.timestamp > 0 && m.duration != null && m.timestamp >= cutoff) {
        pts.push({ ts: m.timestamp, duration: m.duration, isSend: m.runType === "send" });
      }
    }
    pts.sort((a, b) => a.ts - b.ts);
    return pts;
  }, [runMeta, cutoff]);

  if (runMeta.size === 0) return null;

  const W = 400;
  const H = 180;
  const PAD = { top: 16, right: 16, bottom: 32, left: 48 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const minTs = points.length ? points[0].ts : 0;
  const maxTs = points.length ? points[points.length - 1].ts : 1;
  const maxDur = points.length ? Math.max(...points.map(p => p.duration), 1) : 1;
  const rangeTs = maxTs - minTs || 1;

  function x(ts: number) { return PAD.left + ((ts - minTs) / rangeTs) * plotW; }
  function y(dur: number) { return PAD.top + plotH - (dur / maxDur) * plotH; }

  // Generate ~4 tick labels for x-axis
  const xTicks = points.length <= 4
    ? points.map(p => p.ts)
    : Array.from({ length: 4 }, (_, i) => minTs + (rangeTs * i) / 3);

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setShowAnalysis(!showAnalysis)}
        className="flex items-center gap-1.5 self-start rounded-lg border border-edge px-3 py-1.5 text-xs text-fg-secondary transition hover:border-edge-hover hover:text-fg"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
        Analysis
        <svg className={`h-3 w-3 transition ${showAnalysis ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {showAnalysis && (
        <div className="rounded-lg border border-edge bg-card p-3 flex flex-col gap-2">
          {/* Tabs */}
          <div className="flex gap-1">
            {ANALYSIS_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={[
                  "rounded px-2.5 py-1 text-xs font-medium capitalize transition",
                  activeTab === tab
                    ? "bg-inset text-fg"
                    : "text-fg-muted hover:text-fg",
                ].join(" ")}
              >
                {tab}
              </button>
            ))}
          </div>

          {points.length === 0 ? (
            <p className="text-xs text-fg-muted py-4 text-center">No runs with duration data in this range.</p>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map(f => {
                const yPos = PAD.top + plotH - f * plotH;
                return (
                  <g key={`grid-${f}`}>
                    <line x1={PAD.left} y1={yPos} x2={PAD.left + plotW} y2={yPos} stroke="var(--color-edge)" strokeWidth="0.5" />
                    <text x={PAD.left - 6} y={yPos + 3} textAnchor="end" className="fill-fg-muted" fontSize="9">
                      {formatDuration(maxDur * f)}
                    </text>
                  </g>
                );
              })}

              {/* X-axis ticks */}
              {xTicks.map((ts, i) => {
                const xPos = x(ts);
                return (
                  <text key={`xt-${i}`} x={xPos} y={H - 6} textAnchor="middle" className="fill-fg-muted" fontSize="8">
                    {new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </text>
                );
              })}

              {/* Connecting line */}
              {points.length > 1 && (
                <polyline
                  fill="none"
                  stroke="var(--color-fg-secondary)"
                  strokeWidth="1"
                  strokeLinejoin="round"
                  points={points.map(p => `${x(p.ts)},${y(p.duration)}`).join(" ")}
                />
              )}

              {/* Data points */}
              {points.map((p, i) => (
                <circle
                  key={i}
                  cx={x(p.ts)}
                  cy={y(p.duration)}
                  r="4"
                  className={p.isSend ? "fill-emerald-400" : "fill-amber-400"}
                >
                  <title>{new Date(p.ts).toLocaleString()} — {formatDuration(p.duration)}</title>
                </circle>
              ))}

              {/* Y-axis label */}
              <text x="10" y={PAD.top + plotH / 2} textAnchor="middle" transform={`rotate(-90, 10, ${PAD.top + plotH / 2})`} className="fill-fg-muted" fontSize="9">
                Elapsed
              </text>
            </svg>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 justify-center">
            <span className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> Attempt
            </span>
            <span className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" /> Send
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

interface S3RoutePickerProps {
  /** Called when an attempt is successfully loaded from S3. Second param is the S3 object key (absent for local file loads). */
  onLoad: (attempt: RouteAttempt, entryKey?: string) => void;
  /** Called when the route image changes (fetched from S3 or newly uploaded). Null when no image. */
  onRouteImageLoaded?: (dataUrl: string | null) => void;
  /** Button label. */
  label?: string;
  /** When true shows a compact inline layout. */
  compact?: boolean;
  /** Pre-fill State / Region when the picker opens. */
  defaultState?: string;
  /** Pre-fill Area when the picker opens. */
  defaultArea?: string;
  /** Pre-fill Route when the picker opens. */
  defaultRoute?: string;
  /** When true, pulse the entry buttons to indicate this is the next required action. */
  pulseButtons?: boolean;
  /** When true, the S3 panel opens automatically and the S3 load button is hidden. */
  alwaysOpen?: boolean;
  /** When true, entries show Select/Remove toggle instead of Load. */
  selectable?: boolean;
  /** S3 entry keys currently selected (used with selectable mode). */
  selectedKeys?: ReadonlySet<string>;
  /** Called when an entry is deselected in selectable mode. */
  onDeselect?: (entryKey: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dropdown-based route picker backed by S3 prefix listing.
 *
 * Replaces the file-system folder-picker pattern used previously. Fetches
 * state / area / route names from the S3 bucket using delimiter-based
 * listing, then shows attempt files under the selected route.
 */
export default function S3RoutePicker({
  onLoad,
  onRouteImageLoaded,
  label = "Load from S3",
  compact = false,
  defaultState,
  defaultArea,
  defaultRoute,
  pulseButtons = false,
  alwaysOpen = false,
  selectable = false,
  selectedKeys,
  onDeselect,
}: S3RoutePickerProps) {
  const { listPrefixes, listAttempts, downloadAttempt, deleteAttempt, userPrefix, status } = useS3Storage();

  const [open, setOpen] = useState(alwaysOpen);
  const [error, setError] = useState<string | null>(null);

  // Auto-open on mount when alwaysOpen and auth is ready.
  useEffect(() => {
    if (alwaysOpen && userPrefix) handleOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alwaysOpen, userPrefix]);

  const [stateNames, setStateNames] = useState<string[]>([]);
  const [selectedState, setSelectedState] = useState("");

  const [areaNames, setAreaNames] = useState<string[]>([]);
  const [selectedArea, setSelectedArea] = useState("");

  const [routeNames, setRouteNames] = useState<string[]>([]);
  const [selectedRoute, setSelectedRoute] = useState("");

  const [attemptEntries, setAttemptEntries] = useState<S3AttemptEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [runMeta, setRunMeta] = useState<Map<string, RunMeta>>(new Map());
  const [deletePending, setDeletePending] = useState<string | null>(null);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  // Route image stored in S3 at `{prefix}/{state}/{area}/{route}/route-image.json`.
  const [routeImageDataUrl, setRouteImageDataUrl] = useState<string | null>(null);
  const [routeImageUploading, setRouteImageUploading] = useState(false);

  // Stable ref for the callback so effects don't need it as a dependency.
  const onRouteImageLoadedRef = useRef(onRouteImageLoaded);
  useEffect(() => { onRouteImageLoadedRef.current = onRouteImageLoaded; });

  // Fetch route image whenever the selected route changes.
  useEffect(() => {
    if (!selectedRoute || !userPrefix || !selectedState || !selectedArea) {
      setRouteImageDataUrl(null);
      onRouteImageLoadedRef.current?.(null);
      return;
    }
    const key = `${userPrefix}/${selectedState}/${selectedArea}/${selectedRoute}/route-image.json`;
    let cancelled = false;
    async function fetchImage() {
      try {
        const res = await fetch(`/api/s3/get?key=${encodeURIComponent(key)}`);
        if (!res.ok) { if (!cancelled) { setRouteImageDataUrl(null); onRouteImageLoadedRef.current?.(null); } return; }
        const raw = await res.json() as Record<string, unknown>;
        const url = typeof raw.dataUrl === "string" ? raw.dataUrl : null;
        if (!cancelled) {
          setRouteImageDataUrl(url);
          onRouteImageLoadedRef.current?.(url);
        }
      } catch {
        if (!cancelled) { setRouteImageDataUrl(null); onRouteImageLoadedRef.current?.(null); }
      }
    }
    fetchImage();
    return () => { cancelled = true; };
  }, [selectedRoute, userPrefix, selectedState, selectedArea]);
  const routeGrades = useMemo(() => {
    const grades = new Set<string>();
    for (const m of runMeta.values()) {
      if (m.rating) grades.add(m.rating);
    }
    return Array.from(grades).sort();
  }, [runMeta]);

  // Fetch metadata for each run entry in the background when entries change.
  useEffect(() => {
    if (attemptEntries.length === 0) {
      setRunMeta(new Map());
      return;
    }
    let cancelled = false;
    const meta = new Map<string, RunMeta>();

    async function fetchMeta() {
      await Promise.all(
        attemptEntries.map(async (entry) => {
          try {
            const res = await fetch(`/api/s3/get?key=${encodeURIComponent(entry.key)}`);
            if (!res.ok) return;
            const raw = await res.json() as Record<string, unknown>;
            const fileName = entry.key.split("/").pop() ?? entry.key;
            const tsMatch = fileName.match(/(?:attempt|run)-(\d+)/);
            meta.set(entry.key, {
              rating: typeof raw.rating === "string" ? raw.rating : undefined,
              duration: (raw.videoMeta as Record<string, unknown> | undefined)?.duration as number | undefined,
              notes: typeof raw.notes === "string" ? raw.notes : undefined,
              runType: parseRunType(fileName),
              timestamp: tsMatch ? parseInt(tsMatch[1], 10) : 0,
              thumbnail: typeof raw.thumbnail === "string" ? raw.thumbnail : undefined,
            });
          } catch { /* ignore individual failures */ }
        }),
      );
      if (!cancelled) setRunMeta(new Map(meta));
    }

    fetchMeta();
    return () => { cancelled = true; };
  }, [attemptEntries]);

  // Fetch states on open — then auto-select defaults if provided.
  const handleOpen = useCallback(async () => {
    if (!userPrefix) return;
    setOpen(true);
    setError(null);
    setLoading(true);
    try {
      const names = await listPrefixes(`${userPrefix}/`);
      const sorted = names.sort((a, b) => a.localeCompare(b));
      setStateNames(sorted);

      // Auto-cascade through defaults.
      if (defaultState && sorted.includes(defaultState)) {
        setSelectedState(defaultState);
        const areas = (await listPrefixes(`${userPrefix}/${defaultState}/`)).sort((a, b) => a.localeCompare(b));
        setAreaNames(areas);

        if (defaultArea && areas.includes(defaultArea)) {
          setSelectedArea(defaultArea);
          const routes = (await listPrefixes(`${userPrefix}/${defaultState}/${defaultArea}/`)).sort((a, b) => a.localeCompare(b));
          setRouteNames(routes);

          if (defaultRoute && routes.includes(defaultRoute)) {
            setSelectedRoute(defaultRoute);
            const prefix = `${userPrefix}/${defaultState}/${defaultArea}/${defaultRoute}/`;
            const entries = await listAttempts(prefix);
            const filtered = entries.filter(e => e.key.endsWith(".json") && !e.key.endsWith("/route-image.json"));
            filtered.sort((a, b) => {
              const tsA = parseInt((a.key.match(/(?:attempt|run)-(\d+)/) ?? ["", "0"])[1], 10);
              const tsB = parseInt((b.key.match(/(?:attempt|run)-(\d+)/) ?? ["", "0"])[1], 10);
              return tsB - tsA;
            });
            setAttemptEntries(filtered);
          }
        }
      }
    } catch {
      setError("Could not list routes from S3.");
    } finally {
      setLoading(false);
    }
  }, [listPrefixes, listAttempts, userPrefix, defaultState, defaultArea, defaultRoute]);

  async function handleStateChange(state: string) {
    setSelectedState(state);
    setAreaNames([]);
    setSelectedArea("");
    setRouteNames([]);
    setSelectedRoute("");
    setAttemptEntries([]);
    if (!state || !userPrefix) return;
    setLoading(true);
    try {
      const names = await listPrefixes(`${userPrefix}/${state}/`);
      setAreaNames(names.sort((a, b) => a.localeCompare(b)));
    } catch {
      setError(`Could not list areas for "${state}".`);
    } finally {
      setLoading(false);
    }
  }

  async function handleAreaChange(area: string) {
    setSelectedArea(area);
    setRouteNames([]);
    setSelectedRoute("");
    setAttemptEntries([]);
    if (!area || !userPrefix) return;
    setLoading(true);
    try {
      const names = await listPrefixes(`${userPrefix}/${selectedState}/${area}/`);
      setRouteNames(names.sort((a, b) => a.localeCompare(b)));
    } catch {
      setError(`Could not list routes for "${area}".`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRouteChange(route: string) {
    setSelectedRoute(route);
    setAttemptEntries([]);
    if (!route || !userPrefix) return;
    setLoading(true);
    try {
      const prefix = `${userPrefix}/${selectedState}/${selectedArea}/${route}/`;
      const entries = await listAttempts(prefix);
      const filtered = entries.filter(e => e.key.endsWith(".json") && !e.key.endsWith("/route-image.json"));
      // Sort by embedded timestamp (newest first) so attempts and sends
      // are interleaved in chronological order.
      filtered.sort((a, b) => {
        const tsA = parseInt((a.key.match(/(?:attempt|run)-(\d+)/) ?? ["", "0"])[1], 10);
        const tsB = parseInt((b.key.match(/(?:attempt|run)-(\d+)/) ?? ["", "0"])[1], 10);
        return tsB - tsA;
      });
      setAttemptEntries(filtered);
    } catch {
      setError(`Could not list runs for "${route}".`);
    } finally {
      setLoading(false);
    }
  }

  async function handleAttemptSelect(entry: S3AttemptEntry) {
    setError(null);
    setLoading(true);
    try {
      const attempt = await downloadAttempt(entry.key);
      saveAttempt(attempt);
      onLoad(attempt, entry.key);
      if (!selectable) setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load attempt.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAttempt(entryKey: string) {
    setDeletePending(null);
    setLoading(true);
    try {
      await deleteAttempt(entryKey);
      const remaining = attemptEntries.filter(e => e.key !== entryKey);
      setAttemptEntries(remaining);

      // Cascade: if the route folder is now empty, re-fetch parent levels.
      if (remaining.length === 0 && userPrefix && selectedState && selectedArea && selectedRoute) {
        const routes = await listPrefixes(`${userPrefix}/${selectedState}/${selectedArea}/`);
        setRouteNames(routes.sort((a, b) => a.localeCompare(b)));
        if (!routes.includes(selectedRoute)) {
          setSelectedRoute("");
          if (routes.length === 0) {
            const areas = await listPrefixes(`${userPrefix}/${selectedState}/`);
            setAreaNames(areas.sort((a, b) => a.localeCompare(b)));
            if (!areas.includes(selectedArea)) {
              setSelectedArea("");
              if (areas.length === 0) {
                const states = await listPrefixes(`${userPrefix}/`);
                setStateNames(states.sort((a, b) => a.localeCompare(b)));
                if (!states.includes(selectedState)) {
                  setSelectedState("");
                }
              }
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setLoading(false);
    }
  }

  // Also accept a direct JSON file upload for browsers without S3 access
  function handleFileLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const attempt = loadAttemptFromJson(JSON.parse(ev.target?.result as string));
        saveAttempt(attempt);
        onLoad(attempt);
        // Populate dropdowns with the loaded attempt's route data.
        if (attempt.state) {
          setSelectedState(attempt.state);
          if (!stateNames.includes(attempt.state))
            setStateNames(prev => [...prev, attempt.state!].sort());
        }
        if (attempt.area) {
          setSelectedArea(attempt.area);
          if (!areaNames.includes(attempt.area))
            setAreaNames(prev => [...prev, attempt.area!].sort());
        }
        if (attempt.route) {
          setSelectedRoute(attempt.route);
          if (!routeNames.includes(attempt.route))
            setRouteNames(prev => [...prev, attempt.route!].sort());
        }
      } catch {
        setError("Could not parse the attempt JSON file.");
      }
    };
    reader.readAsText(file);
  }

  const selectClass = compact
    ? "rounded border border-edge bg-inset px-2 py-1 text-xs text-fg outline-none disabled:opacity-40"
    : "rounded-lg border border-edge bg-inset px-3 py-2 text-sm text-fg outline-none transition focus:border-accent/60 disabled:opacity-40";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {!alwaysOpen && (
          <button
            onClick={handleOpen}
            className={[
              "flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-xs text-fg-secondary transition hover:border-edge-hover hover:text-fg",
              pulseButtons && !open ? "ring-2 ring-accent/50 ring-offset-1 ring-offset-surface animate-pulse" : "",
            ].join(" ")}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
            </svg>
            {label}
          </button>
        )}

        <label className={[
          "flex cursor-pointer items-center gap-2 rounded-lg border border-edge px-3 py-2 text-xs text-fg-secondary transition hover:border-edge-hover hover:text-fg",
          !alwaysOpen && pulseButtons && !open ? "ring-2 ring-accent/50 ring-offset-1 ring-offset-surface animate-pulse" : "",
        ].join(" ")}>
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Load from file
          <input type="file" accept="application/json,.json" className="hidden" onChange={handleFileLoad} />
        </label>

        {loading && <span className="text-xs text-fg-muted animate-pulse">Loading&#8230;</span>}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {open && (
        <div className="flex flex-col gap-3 rounded-lg border border-edge bg-inset p-3">
          {stateNames.length === 0 && !loading && (
            <p className="text-xs text-fg-muted">No routes found in S3.</p>
          )}

          {stateNames.length > 0 && (
            <div className={compact ? "grid grid-cols-3 gap-2" : "grid grid-cols-1 gap-3 sm:grid-cols-3"}>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-fg-secondary">State / Region</label>
                <select value={selectedState} onChange={e => handleStateChange(e.target.value)} className={[selectClass, !selectedState ? "ring-2 ring-accent/50 ring-offset-1 ring-offset-surface animate-pulse" : ""].join(" ")}>
                  <option value="">— select —</option>
                  {stateNames.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-fg-secondary">Area</label>
                <select value={selectedArea} onChange={e => handleAreaChange(e.target.value)} disabled={!areaNames.length} className={[selectClass, selectedState && !selectedArea ? "ring-2 ring-accent/50 ring-offset-1 ring-offset-surface animate-pulse" : ""].join(" ")}>
                  <option value="">— select —</option>
                  {areaNames.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-fg-secondary">Route</label>
                <select value={selectedRoute} onChange={e => handleRouteChange(e.target.value)} disabled={!routeNames.length} className={[selectClass, selectedArea && !selectedRoute ? "ring-2 ring-accent/50 ring-offset-1 ring-offset-surface animate-pulse" : ""].join(" ")}>
                  <option value="">— select —</option>
                  {routeNames.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          )}

          {attemptEntries.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-3 flex-wrap px-1">
                <span className="text-base font-semibold text-fg">{selectedRoute}</span>
                {routeGrades.map(g => (
                  <span key={g} className="text-sm font-medium text-fg-secondary">{g}</span>
                ))}
              </div>
              {/* Route image — shown when available */}
              {routeImageDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- data URL, not remote image
                <img
                  src={routeImageDataUrl}
                  alt={`${selectedRoute} route photo`}
                  className="w-full rounded-lg border border-edge object-contain max-h-48"
                />
              )}
              {/* Route image upload */}
              {selectedRoute && userPrefix && (
                <label className="flex cursor-pointer items-center gap-1.5 self-start text-xs text-fg-muted hover:text-fg transition">
                  {routeImageUploading ? (
                    <span className="animate-pulse">Saving&#8230;</span>
                  ) : (
                    <>
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      {routeImageDataUrl ? "Update route photo" : "Upload route photo"}
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={routeImageUploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !userPrefix) return;
                      setRouteImageUploading(true);
                      try {
                        const dataUrl = await compressImageToDataUrl(file);
                        const key = `${userPrefix}/${selectedState}/${selectedArea}/${selectedRoute}/route-image.json`;
                        const res = await fetch("/api/s3/put", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ key, body: JSON.stringify({ dataUrl }) }),
                        });
                        if (res.ok) {
                          setRouteImageDataUrl(dataUrl);
                          onRouteImageLoadedRef.current?.(dataUrl);
                        }
                      } catch { /* ignore upload errors silently */ }
                      finally { setRouteImageUploading(false); }
                    }}
                  />
                </label>
              )}
              <div className="flex flex-col divide-y divide-edge rounded-lg border border-edge overflow-hidden">
                {attemptEntries.map(entry => {
                  const fileName = entry.key.split("/").pop() ?? entry.key;
                  const rType = parseRunType(fileName);
                  const isSend = rType === "send";
                  const meta = runMeta.get(entry.key);
                  const isPendingDelete = deletePending === entry.key;
                  const isExpanded = expandedEntry === entry.key;
                  return (
                    <div
                      key={entry.key}
                      className={[
                        "flex flex-col transition",
                        selectable && selectedKeys?.has(entry.key) ? "ring-1 ring-accent/40" : "",
                        isSend
                          ? "bg-emerald-950/20 text-emerald-300"
                          : "bg-amber-950/20 text-amber-300",
                        isPendingDelete ? "bg-red-950/30 border-red-800/40" : "",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <button
                          onClick={() => {
                            setExpandedEntry(isExpanded ? null : entry.key);
                          }}
                          className="flex-1 min-w-0 text-left flex items-center gap-2 flex-wrap"
                        >
                          {meta?.thumbnail && !isExpanded && (
                            // eslint-disable-next-line @next/next/no-img-element -- data URL thumbnail, not a remote image
                            <img
                              src={meta.thumbnail}
                              alt=""
                              className="h-10 w-10 rounded object-cover shrink-0"
                            />
                          )}
                          <span>{attemptTimestampLabel(fileName)}</span>
                          <span className={[
                            "rounded px-1.5 py-0.5 text-xs font-medium capitalize",
                            isSend
                              ? "bg-emerald-900/40 text-emerald-400"
                              : "bg-amber-900/40 text-amber-400",
                          ].join(" ")}>
                            {rType}
                          </span>
                          {meta?.duration != null && (
                            <span className="text-xs text-fg-muted">{formatDuration(meta.duration)}</span>
                          )}
                          {entry.size != null && (
                            <span className="text-xs text-fg-muted">{(entry.size / 1024).toFixed(0)} KB</span>
                          )}
                        </button>
                        <div className="flex items-center gap-1 shrink-0 ml-3">
                          {selectable && selectedKeys?.has(entry.key) ? (
                            <button
                              onClick={() => onDeselect?.(entry.key)}
                              disabled={isPendingDelete}
                              className="rounded px-3 py-1.5 text-xs font-semibold bg-emerald-900/40 text-emerald-400 hover:bg-red-900/40 hover:text-red-400 transition disabled:opacity-40"
                            >
                              Selected ✓
                            </button>
                          ) : (
                            <button
                              onClick={() => handleAttemptSelect(entry)}
                              disabled={status === "loading" || isPendingDelete}
                              className={[
                                "rounded px-3 py-1.5 text-xs font-semibold bg-accent text-surface hover:opacity-90 transition disabled:opacity-40",
                                pulseButtons && !isExpanded ? "animate-pulse" : "",
                              ].join(" ")}
                            >
                              {selectable ? "Select" : "Load"}
                            </button>
                          )}
                          {isPendingDelete ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleDeleteAttempt(entry.key)}
                                className="rounded px-2 py-1 text-xs font-medium bg-red-900/50 text-red-300 hover:bg-red-800/60 transition"
                              >
                                Delete
                              </button>
                              <button
                                onClick={() => setDeletePending(null)}
                                className="rounded px-2 py-1 text-xs font-medium bg-inset text-fg-secondary hover:bg-edge hover:text-fg transition"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeletePending(entry.key)}
                              className="rounded p-1 text-fg-muted hover:text-red-400 transition"
                              aria-label="Delete climb"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded detail panel */}
                      {isExpanded && (
                        <div className="flex gap-3 px-4 pb-3 pt-1">
                          {meta?.thumbnail && (
                            // eslint-disable-next-line @next/next/no-img-element -- data URL thumbnail, not a remote image
                            <img
                              src={meta.thumbnail}
                              alt="ORB feature thumbnail"
                              className="h-36 w-auto rounded border border-edge object-contain shrink-0"
                            />
                          )}
                          <div className="flex flex-col gap-1.5 text-sm text-fg-secondary min-w-0">
                            {meta?.duration != null && (
                              <p className="font-medium text-fg">{formatDuration(meta.duration)}</p>
                            )}
                            {meta?.notes && (
                              <p className="text-xs text-fg-muted italic break-words leading-relaxed">{meta.notes}</p>
                            )}
                            {meta?.duration == null && !meta?.notes && (
                              <p className="text-xs text-fg-muted">No additional info.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Analysis button + dropdown graph */}
              <RouteAnalysisGraph runMeta={runMeta} />
            </div>
          )}

          {attemptEntries.length === 0 && selectedRoute && !loading && (
            <p className="text-xs text-fg-muted">No run files found for this route.</p>
          )}
        </div>
      )}
    </div>
  );
}
