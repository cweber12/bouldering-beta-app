"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { cn } from "@/utils/cn";

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

interface CompareSelectSheetProps {
  /** The route context — only climbs from this route are shown. */
  state: string;
  area: string;
  route: string;
  /** S3 key of the climb the user clicked "Compare" from — pre-selected on open. */
  originKey: string;
  /** Authenticated user ID — used to fetch from /api/profile/{userId}/climbs/page. */
  userId: string;
  onClose: () => void;
}

const MIN_SELECT = 2;
const MAX_SELECT = 4;

// ---------------------------------------------------------------------------
// CompareSelectSheet
//
// Full-screen portal sheet that shows all of the user's climbs for a specific
// route so they can pick 2–4 to compare. Rendered above ClimbDetailModal
// (z-[1001]) via createPortal.
// ---------------------------------------------------------------------------

export default function CompareSelectSheet({
  state,
  area,
  route,
  originKey,
  userId,
  onClose,
}: CompareSelectSheetProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [climbs, setClimbs] = useState<ClimbSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Selected S3 keys (Set for O(1) toggle checks).
  const [selected, setSelected] = useState<Set<string>>(() => new Set([originKey]));

  // SSR guard
  useEffect(() => setMounted(true), []);

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

    return () => { cancelled = true; };
  }, [userId, state, area, route]);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function toggleClimb(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Always allow deselecting — but keep origin key de-selectable too;
        // user may want to compare others without including the origin.
        next.delete(key);
      } else {
        if (next.size >= MAX_SELECT) return prev; // silently ignore beyond max
        next.add(key);
      }
      return next;
    });
  }

  function handleConfirm() {
    if (selected.size < MIN_SELECT) return;
    const keys = Array.from(selected).join(",");
    const url = [
      `/compare?keys=${encodeURIComponent(keys)}`,
      `state=${encodeURIComponent(state)}`,
      `area=${encodeURIComponent(area)}`,
      `route=${encodeURIComponent(route)}`,
    ].join("&");
    onClose();
    router.push(url);
  }

  if (!mounted) return null;

  const canConfirm = selected.size >= MIN_SELECT && selected.size <= MAX_SELECT;
  const selCount = selected.size;

  return createPortal(
    <div
      className="fixed inset-0 z-[1002] flex flex-col bg-surface/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Select climbs to compare on ${route}`}
    >
      {/* Sheet panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-fg-muted">Compare climbs on</p>
            <h2 className="truncate text-base font-semibold text-fg leading-tight">{route}</h2>
            <p className="truncate text-xs text-fg-muted">{area} &middot; {state}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-secondary transition hover:bg-inset hover:text-fg"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Selection hint */}
        <div className="border-b border-edge bg-inset/50 px-4 py-2 text-xs text-fg-muted sm:px-6">
          Select {MIN_SELECT}–{MAX_SELECT} climbs to compare.
          {selCount > 0 && (
            <span className="ml-1.5 font-medium text-accent">
              {selCount} selected{selCount > MAX_SELECT ? ` (max ${MAX_SELECT})` : ""}
            </span>
          )}
        </div>

        {/* Climb grid */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-edge border-t-fg" />
              <p className="text-sm text-fg-muted">Loading climbs&hellip;</p>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          {!loading && !error && climbs.length === 0 && (
            <p className="py-12 text-center text-sm text-fg-muted">
              No climbs found for this route.
            </p>
          )}

          {!loading && !error && climbs.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {climbs.map((c) => {
                const isSelected = selected.has(c.key);
                const isAtMax = selected.size >= MAX_SELECT && !isSelected;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => toggleClimb(c.key)}
                    disabled={isAtMax}
                    className={cn(
                      "group relative cursor-pointer rounded-xl border bg-card text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      isSelected
                        ? "border-accent bg-accent/5 ring-2 ring-accent/40"
                        : isAtMax
                        ? "cursor-not-allowed border-edge opacity-40"
                        : "border-edge hover:border-edge-hover",
                    )}
                  >
                    {/* Thumbnail */}
                    <div className="relative aspect-square w-full overflow-hidden rounded-t-xl bg-inset">
                      {c.thumbnail ? (
                        <Image
                          src={c.thumbnail}
                          alt={`${c.route} climb`}
                          fill
                          unoptimized
                          className="object-cover transition-transform duration-200 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-fg-muted/30">
                          <svg className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                          </svg>
                        </div>
                      )}

                      {/* Checkmark badge — visible when selected */}
                      {isSelected && (
                        <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent shadow">
                          <svg className="h-3 w-3 text-surface" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        </div>
                      )}

                      {/* Origin badge */}
                      {c.key === originKey && (
                        <div className="absolute bottom-1.5 left-1.5 rounded bg-surface/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-fg backdrop-blur-sm">
                          This climb
                        </div>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="px-2 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                            c.runType === "send"
                              ? "bg-send-surface text-send"
                              : "bg-attempt-surface text-attempt",
                          )}
                        >
                          {c.runType}
                        </span>
                        {c.rating && (
                          <span className="rounded bg-accent/15 px-1 py-0.5 text-[9px] font-medium text-accent">
                            {c.rating}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] text-fg-muted">{c.timestamp}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer action bar */}
        <div className="flex items-center justify-between border-t border-edge bg-surface px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-edge px-4 py-2 text-sm text-fg-secondary transition hover:border-edge-hover hover:text-fg"
          >
            Cancel
          </button>

          <div className="flex items-center gap-3">
            {selCount < MIN_SELECT && !loading && climbs.length > 0 && (
              <p className="text-xs text-fg-muted hidden sm:block">
                Select at least {MIN_SELECT} climbs
              </p>
            )}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-surface shadow shadow-accent/20 transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {canConfirm ? `Compare ${selCount} climbs` : "Compare"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
