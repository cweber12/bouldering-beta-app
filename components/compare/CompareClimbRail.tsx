"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import RunTypeBadge from "@/components/shared/RunTypeBadge";

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
  /** S3 keys currently in the comparison, in slot order. */
  activeKeys: string[];
  /** Identity colour for an active key, or null when the key is not active. */
  colorForKey: (key: string) => string | null;
  /** True when the comparison is full (no more climbs can be added). */
  atMax: boolean;
  /** Minimum climbs needed for a real comparison (drives the "add" hint). */
  minToCompare: number;
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
  onAdd,
  onRemove,
  className,
}: CompareClimbRailProps) {
  const [climbs, setClimbs] = useState<ClimbSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all climbs for this route (up to 50 — enough for any realistic route).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ state, area, route, pageSize: "50", page: "1" });

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

    return () => { cancelled = true; };
  }, [userId, state, area, route]);

  const needsMore = activeKeys.length > 0 && activeKeys.length < minToCompare;

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col bg-surface-alt/30",
        className,
      )}
      aria-label={`Climbs on ${route}`}
    >
      {/* Header — hidden on the mobile strip to save vertical space. */}
      <div className="hidden shrink-0 items-baseline justify-between px-3 pt-3 pb-2 sm:flex">
        <p className="text-label font-semibold uppercase tracking-label text-fg-muted">
          Climbs
        </p>
        <span className="text-[10px] text-fg-muted">
          {activeKeys.length}/{4}
        </span>
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
          <p className="w-full py-6 text-center text-xs text-fg-muted">
            No climbs on this route.
          </p>
        )}

        {!loading && !error && climbs.map((c) => {
          const color = colorForKey(c.key);
          const isActive = color !== null;
          const isLocked = !isActive && atMax;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={isActive}
              disabled={isLocked}
              onClick={() => (isActive ? onRemove(c.key) : onAdd(c.key))}
              style={isActive ? { borderColor: color! } : undefined}
              className={cn(
                "group relative flex w-24 shrink-0 flex-col gap-1 rounded-lg border bg-surface p-1.5 text-left transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                "sm:w-full sm:flex-row sm:items-center sm:gap-2.5",
                isActive
                  ? "bg-card"
                  : isLocked
                  ? "cursor-not-allowed border-edge/40 opacity-40"
                  : "border-edge/50 hover:border-edge-hover hover:bg-card/70",
              )}
            >
              {/* Thumbnail */}
              <div className="relative aspect-square w-full overflow-hidden rounded-md bg-inset sm:h-12 sm:w-12 sm:shrink-0">
                {c.thumbnail ? (
                  <Image
                    src={c.thumbnail}
                    alt=""
                    fill
                    unoptimized
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-fg-muted/30">
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                    </svg>
                  </div>
                )}

                {/* Active check, filled with the identity colour. */}
                {isActive && (
                  <span
                    className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full"
                    style={{ backgroundColor: color! }}
                  >
                    <svg className="h-2.5 w-2.5 text-fg-inverse" fill="none" stroke="currentColor" strokeWidth="3.5" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </span>
                )}
              </div>

              {/* Meta */}
              <div className="flex min-w-0 flex-col gap-0.5 sm:flex-1">
                <div className="flex flex-wrap items-center gap-1">
                  <RunTypeBadge
                    runType={c.runType}
                    className="rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                  />
                  {c.rating && (
                    <span className="rounded bg-accent/15 px-1 py-0.5 text-[9px] font-medium text-accent">
                      {c.rating}
                    </span>
                  )}
                </div>
                <p className="truncate text-[10px] text-fg-muted">{c.timestamp}</p>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
