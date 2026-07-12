"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import type { ConsoleMode } from "@/utils/compareUrl";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClimbSummary {
  key: string;
  state: string;
  area: string;
  route: string;
  runType: string;
  timestamp: string;
  rating?: string;
  thumbnail?: string;
}

interface ClimbPageResponse {
  items: ClimbSummary[];
  total: number;
}

export interface CompareClimbRailProps {
  /** Authenticated user ID — scopes the climbs fetch. */
  userId: string;
  /** Route context — only climbs from this route are listed. */
  state: string;
  area: string;
  route: string;
  /** S3 keys currently active, in slot order (single mode: just the shown one). */
  activeKeys: string[];
  /** Identity colour for an active key, or null when the key is not active. */
  colorForKey: (key: string) => string | null;
  /** True when the comparison is full (no more climbs can be added). */
  atMax: boolean;
  /** Minimum climbs needed for a real comparison (drives the "add" hint). */
  minToCompare: number;
  /**
   * Console mode. In `single` the rail still lists every climb but selection is
   * exclusive: tapping a climb swaps the shown one (via `onAdd`) rather than
   * adding a second, the active tap is a no-op, and the count/hint/identity
   * colours are hidden (one climb needs none).
   */
  mode?: ConsoleMode;
  /** Toggles single ↔ multiple via the header "Compare Multiple" button. */
  onToggleMode?: () => void;
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// CompareClimbRail
//
// Persistent rail of every saved climb on the current route. Active climbs are
// lit in their identity colour; tapping toggles them in and out of the
// comparison. Renders as a vertical side rail on desktop and a horizontal
// bottom strip on mobile (orientation only — same logic either way).
// ---------------------------------------------------------------------------

export default function CompareClimbRail({
  userId,
  state,
  area,
  route,
  activeKeys,
  colorForKey,
  atMax,
  minToCompare,
  mode = "multiple",
  onToggleMode,
  onAdd,
  onRemove,
  className,
}: CompareClimbRailProps) {
  const isSingle = mode === "single";
  const [climbs, setClimbs] = useState<ClimbSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all climbs for this route (up to 50 — enough for any realistic route).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      state,
      area,
      route,
      pageSize: "50",
      page: "1",
      exact: "1",
    });

    (async () => {
      try {
        const res = await fetch(`/api/profile/${userId}/climbs/page?${params}`);
        if (!res.ok) throw new Error("Failed to load climbs.");
        const data = (await res.json()) as ClimbPageResponse;
        if (!cancelled) setClimbs(data.items);
      } catch {
        if (!cancelled) setError("Could not load climbs for this route.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, state, area, route]);

  // The "add to compare" hint only applies when building a multi-climb comparison.
  const needsMore = !isSingle && activeKeys.length > 0 && activeKeys.length < minToCompare;

  return (
    <aside
      className={cn("flex shrink-0 flex-col bg-surface-alt/30", className)}
      aria-label={`Climbs on ${route}`}
    >
      {/* Header — hidden on the mobile strip to save vertical space. The
          "Compare Multiple" toggle lives here, inline with the CLIMBS label. */}
      <div className="hidden shrink-0 flex-col gap-2 px-3 pt-3 pb-2 sm:flex">
        <div className="flex items-center justify-between gap-2">
          <p className="text-label font-semibold uppercase tracking-label text-fg-muted">Climbs</p>
          {/* Slot counter only matters when filling a multi-climb comparison. */}
          {!isSingle && (
            <span className="text-[10px] text-fg-muted">
              {activeKeys.length}/{4}
            </span>
          )}
        </div>
        {onToggleMode && (
          <button
            type="button"
            onClick={onToggleMode}
            aria-pressed={!isSingle}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              !isSingle
                ? "border-accent/60 bg-accent/10 text-accent"
                : "border-edge/50 text-fg-secondary hover:border-edge-hover hover:text-fg",
            )}
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 5.5A1.5 1.5 0 015.5 4h2A1.5 1.5 0 019 5.5v13A1.5 1.5 0 017.5 20h-2A1.5 1.5 0 014 18.5v-13z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 5.5A1.5 1.5 0 0116.5 4h2A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5h-2a1.5 1.5 0 01-1.5-1.5v-13z"
              />
            </svg>
            Compare Multiple
          </button>
        )}
      </div>

      {/* Add hint when a comparison needs at least one more climb. */}
      {needsMore && !loading && (
        <p className="shrink-0 px-3 py-2 text-center text-[11px] font-medium text-accent sm:text-left">
          Add a climb to compare
        </p>
      )}

      {/* List — vertical scroll on desktop, horizontal strip on mobile. */}
      <div
        className={cn(
          "flex min-h-0 flex-1 gap-2 overflow-x-auto p-3 pt-0",
          "sm:flex-col sm:overflow-x-visible sm:overflow-y-auto",
        )}
      >
        {loading && (
          <div className="flex w-full items-center justify-center py-6">
            <LoadingSpinner />
          </div>
        )}

        {!loading && error && (
          <p className="w-full rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        {!loading && !error && climbs.length === 0 && (
          <p className="w-full py-6 text-center text-xs text-fg-muted">No climbs on this route.</p>
        )}

        {!loading &&
          !error &&
          climbs.map((c) => {
            const isActive = activeKeys.includes(c.key);
            // Identity colour is a multi-climb concept; single mode shows none.
            const color = isSingle ? null : colorForKey(c.key);
            // Single mode is always swappable — never locked. Multiple locks
            // inactive climbs once every slot is full.
            const isLocked = !isSingle && !isActive && atMax;
            // Single mode: tapping the active climb is a no-op (can't deselect the
            // only view); tapping another swaps via onAdd. Multiple mode toggles.
            const handleClick = isSingle
              ? () => {
                  if (!isActive) onAdd(c.key);
                }
              : () => (isActive ? onRemove(c.key) : onAdd(c.key));
            // The only run-type signal: a green dot for sends, nothing for attempts.
            const isSend = c.runType === "send";
            // Selection is shown by the border — identity colour in multiple mode,
            // accent in single mode. (The top-right dot is reserved for sends.)
            const selectionBorder = isActive
              ? color
                ? undefined // inline style below
                : "border-accent"
              : isLocked
                ? "border-edge/40"
                : "border-edge/50 hover:border-edge-hover";
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={isActive}
                disabled={isLocked}
                onClick={handleClick}
                style={isActive && color ? { borderColor: color } : undefined}
                className={cn(
                  "group relative flex w-28 shrink-0 flex-col gap-1 rounded-lg border bg-surface p-2 text-left transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  "sm:w-full sm:flex-row sm:items-center sm:gap-3",
                  isActive
                    ? cn("bg-card", color ? "border-2" : "border-2 border-accent")
                    : selectionBorder,
                  !isActive && isLocked && "cursor-not-allowed opacity-40",
                  !isActive && !isLocked && "hover:bg-card/70",
                )}
              >
                {/* Thumbnail */}
                <div className="relative aspect-square w-full overflow-hidden rounded-md bg-inset sm:h-16 sm:w-16 sm:shrink-0">
                  {c.thumbnail ? (
                    <Image src={c.thumbnail} alt="" fill unoptimized className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-fg-muted/30">
                      <svg
                        className="h-6 w-6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
                        />
                      </svg>
                    </div>
                  )}

                  {/* Send indicator — the sole send/attempt signal: a green dot in
                    the top-right corner for sends, nothing for attempts. */}
                  {isSend && (
                    <span
                      className="absolute right-1 top-1 h-3 w-3 rounded-full bg-send ring-2 ring-surface"
                      title="Send"
                      aria-label="Send"
                      role="img"
                    />
                  )}
                </div>

                {/* Meta — date/time and grade; no run-type badge. */}
                <div className="flex min-w-0 flex-col gap-0.5 sm:flex-1">
                  {c.rating && (
                    <span className="w-fit rounded bg-accent/15 px-1 py-0.5 text-[10px] font-medium text-accent">
                      {c.rating}
                    </span>
                  )}
                  <p className="truncate text-[11px] text-fg-muted">{c.timestamp}</p>
                </div>
              </button>
            );
          })}
      </div>
    </aside>
  );
}
