"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useS3Storage } from "@/hooks/useS3Storage";
import type { S3AttemptEntry } from "@/hooks/useS3Storage";
import { attemptTimestampLabel, loadAttemptFromJson, parseRunType } from "@/utils/fsHelpers";
import { saveAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import { compressImageToDataUrl } from "@/utils/imageHelpers";
import RouteAnalysisGraph, { type RunMeta, formatDuration } from "@/components/shared/RouteAnalysisGraph";

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

interface S3RoutePickerProps {
  /** Called when an attempt is successfully loaded from S3. Second param is the S3 object key (absent for local file loads). */
  onLoad: (attempt: RouteAttempt, entryKey?: string) => void;
  /** Called when the route image changes (fetched from S3 or newly uploaded). Null when no image. */
  onRouteImageLoaded?: (dataUrl: string | null) => void;
  /** Called with the saved crop-box metadata from route-image.json, if present. */
  onRouteImageCropLoaded?: (crop: { x: number; y: number; w: number; h: number } | null) => void;
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
  onRouteImageCropLoaded,
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

  const onRouteImageCropLoadedRef = useRef(onRouteImageCropLoaded);
  useEffect(() => { onRouteImageCropLoadedRef.current = onRouteImageCropLoaded; });

  // Fetch route image whenever the selected route changes.
  useEffect(() => {
    if (!selectedRoute || !userPrefix || !selectedState || !selectedArea) {
      setRouteImageDataUrl(null);
      onRouteImageLoadedRef.current?.(null);
      onRouteImageCropLoadedRef.current?.(null);
      return;
    }
    const key = `${userPrefix}/${selectedState}/${selectedArea}/${selectedRoute}/route-image.json`;
    let cancelled = false;
    async function fetchImage() {
      try {
        const res = await fetch(`/api/s3/get?key=${encodeURIComponent(key)}`);
        if (!res.ok) { if (!cancelled) { setRouteImageDataUrl(null); onRouteImageLoadedRef.current?.(null); onRouteImageCropLoadedRef.current?.(null); } return; }
        const raw = await res.json() as Record<string, unknown>;
        const url = typeof raw.dataUrl === "string" ? raw.dataUrl : null;
        // Extract saved crop-box metadata if present.
        const savedCrop = (raw.cropBox && typeof raw.cropBox === "object")
          ? raw.cropBox as { x: number; y: number; w: number; h: number }
          : null;
        if (!cancelled) {
          setRouteImageDataUrl(url);
          onRouteImageLoadedRef.current?.(url);
          onRouteImageCropLoadedRef.current?.(savedCrop);
        }
      } catch {
        if (!cancelled) { setRouteImageDataUrl(null); onRouteImageLoadedRef.current?.(null); onRouteImageCropLoadedRef.current?.(null); }
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
