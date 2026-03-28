"use client";

import { useCallback, useState } from "react";
import { useS3Storage } from "@/hooks/useS3Storage";
import type { S3AttemptEntry } from "@/hooks/useS3Storage";
import { attemptTimestampLabel, loadAttemptFromJson, parseRunType } from "@/utils/fsHelpers";
import { saveAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const KEY_PREFIX = "RouteData";

interface S3RoutePickerProps {
  /** Called when an attempt is successfully loaded from S3. */
  onLoad: (attempt: RouteAttempt) => void;
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
  label = "Load from S3",
  compact = false,
  defaultState,
  defaultArea,
  defaultRoute,
}: S3RoutePickerProps) {
  const { listPrefixes, listAttempts, downloadAttempt, status } = useS3Storage();

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stateNames, setStateNames] = useState<string[]>([]);
  const [selectedState, setSelectedState] = useState("");

  const [areaNames, setAreaNames] = useState<string[]>([]);
  const [selectedArea, setSelectedArea] = useState("");

  const [routeNames, setRouteNames] = useState<string[]>([]);
  const [selectedRoute, setSelectedRoute] = useState("");

  const [attemptEntries, setAttemptEntries] = useState<S3AttemptEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch states on open — then auto-select defaults if provided.
  const handleOpen = useCallback(async () => {
    setOpen(true);
    setError(null);
    setLoading(true);
    try {
      const names = await listPrefixes(`${KEY_PREFIX}/`);
      const sorted = names.sort((a, b) => a.localeCompare(b));
      setStateNames(sorted);

      // Auto-cascade through defaults.
      if (defaultState && sorted.includes(defaultState)) {
        setSelectedState(defaultState);
        const areas = (await listPrefixes(`${KEY_PREFIX}/${defaultState}/`)).sort((a, b) => a.localeCompare(b));
        setAreaNames(areas);

        if (defaultArea && areas.includes(defaultArea)) {
          setSelectedArea(defaultArea);
          const routes = (await listPrefixes(`${KEY_PREFIX}/${defaultState}/${defaultArea}/`)).sort((a, b) => a.localeCompare(b));
          setRouteNames(routes);

          if (defaultRoute && routes.includes(defaultRoute)) {
            setSelectedRoute(defaultRoute);
            const prefix = `${KEY_PREFIX}/${defaultState}/${defaultArea}/${defaultRoute}/`;
            const entries = await listAttempts(prefix);
            const filtered = entries.filter(e => e.key.endsWith(".json"));
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
  }, [listPrefixes, listAttempts, defaultState, defaultArea, defaultRoute]);

  async function handleStateChange(state: string) {
    setSelectedState(state);
    setAreaNames([]);
    setSelectedArea("");
    setRouteNames([]);
    setSelectedRoute("");
    setAttemptEntries([]);
    if (!state) return;
    setLoading(true);
    try {
      const names = await listPrefixes(`${KEY_PREFIX}/${state}/`);
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
    if (!area) return;
    setLoading(true);
    try {
      const names = await listPrefixes(`${KEY_PREFIX}/${selectedState}/${area}/`);
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
    if (!route) return;
    setLoading(true);
    try {
      const prefix = `${KEY_PREFIX}/${selectedState}/${selectedArea}/${route}/`;
      const entries = await listAttempts(prefix);
      const filtered = entries.filter(e => e.key.endsWith(".json"));
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
      onLoad(attempt);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load attempt.");
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
      } catch {
        setError("Could not parse the attempt JSON file.");
      }
    };
    reader.readAsText(file);
  }

  const selectClass = compact
    ? "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none disabled:opacity-40"
    : "rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500 disabled:opacity-40";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          onClick={handleOpen}
          className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
          </svg>
          {label}
        </button>

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Load from file
          <input type="file" accept="application/json,.json" className="hidden" onChange={handleFileLoad} />
        </label>

        {loading && <span className="text-xs text-zinc-500 animate-pulse">Loading&#8230;</span>}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {open && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3">
          {stateNames.length === 0 && !loading && (
            <p className="text-xs text-zinc-500">No routes found in S3.</p>
          )}

          {stateNames.length > 0 && (
            <div className={compact ? "grid grid-cols-3 gap-2" : "grid grid-cols-1 gap-3 sm:grid-cols-3"}>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400">State / Region</label>
                <select value={selectedState} onChange={e => handleStateChange(e.target.value)} className={selectClass}>
                  <option value="">— select —</option>
                  {stateNames.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400">Area</label>
                <select value={selectedArea} onChange={e => handleAreaChange(e.target.value)} disabled={!areaNames.length} className={selectClass}>
                  <option value="">— select —</option>
                  {areaNames.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-400">Route</label>
                <select value={selectedRoute} onChange={e => handleRouteChange(e.target.value)} disabled={!routeNames.length} className={selectClass}>
                  <option value="">— select —</option>
                  {routeNames.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          )}

          {attemptEntries.length > 0 && (
            <div className="flex flex-col divide-y divide-zinc-800 rounded-lg border border-zinc-800 overflow-hidden">
              {attemptEntries.map(entry => {
                const fileName = entry.key.split("/").pop() ?? entry.key;
                const rType = parseRunType(fileName);
                const isSend = rType === "send";
                return (
                  <button
                    key={entry.key}
                    onClick={() => handleAttemptSelect(entry)}
                    disabled={status === "loading"}
                    className={[
                      "flex items-center justify-between px-4 py-2.5 text-left text-sm transition disabled:opacity-50",
                      isSend
                        ? "bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/40"
                        : "bg-amber-950/20 text-amber-300 hover:bg-amber-950/40",
                    ].join(" ")}
                  >
                    <span className="flex items-center gap-2">
                      <span>{attemptTimestampLabel(fileName)}</span>
                      <span className={[
                        "rounded px-1.5 py-0.5 text-xs font-medium capitalize",
                        isSend
                          ? "bg-emerald-900/40 text-emerald-400"
                          : "bg-amber-900/40 text-amber-400",
                      ].join(" ")}>
                        {rType}
                      </span>
                    </span>
                    {entry.size != null && (
                      <span className="text-xs text-zinc-600">{(entry.size / 1024).toFixed(0)} KB</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {attemptEntries.length === 0 && selectedRoute && !loading && (
            <p className="text-xs text-zinc-500">No run files found for this route.</p>
          )}
        </div>
      )}
    </div>
  );
}
