"use client";

import Image from "next/image";
import { cn } from "@/utils/cn";
import type { RouteSummary } from "@/utils/routeSummary";

interface RouteRowProps {
  route: RouteSummary;
  /** Highlighted when selected from the list or the map. */
  selected: boolean;
  /** Open the route console (most recent climb auto-selected). */
  onOpen: () => void;
  /** Center the map on this route (pin button). */
  onFocusMap: () => void;
}

// ---------------------------------------------------------------------------
// RouteRow — one route in the collection list: thumbnail · name + rating ·
// area · climb count + last-climbed · map-pin button (disabled without GPS).
// The row body opens the route; the pin button only re-centers the map.
// ---------------------------------------------------------------------------

export default function RouteRow({ route, selected, onOpen, onFocusMap }: RouteRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-pressed={selected}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-lg border bg-surface p-2 text-left transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        selected
          ? "border-accent bg-card"
          : "border-edge/60 hover:border-edge-hover hover:bg-card/70",
      )}
    >
      {/* Thumbnail (most recent climb) */}
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-inset">
        {route.thumbnail ? (
          <Image
            src={route.thumbnail}
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
      </div>

      {/* Route info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="truncate text-sm font-medium text-fg">{route.route}</p>
          {route.rating && (
            <span className="shrink-0 rounded bg-accent/15 px-1 py-0.5 text-[10px] font-medium text-accent">
              {route.rating}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-fg-muted">
          {route.area}&nbsp;&middot;&nbsp;{route.state}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-fg-muted">
          {route.climbCount} climb{route.climbCount !== 1 ? "s" : ""}
          &nbsp;&middot;&nbsp;{route.lastClimbedLabel}
        </p>
      </div>

      {/* Map-pin button — centers the map; disabled when the route has no GPS. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onFocusMap();
        }}
        disabled={!route.hasGps}
        title={route.hasGps ? "Show on map" : "No GPS location for this route"}
        aria-label={route.hasGps ? "Show route on map" : "No GPS location for this route"}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition",
          route.hasGps
            ? "text-fg-muted hover:bg-inset/80 hover:text-accent"
            : "cursor-not-allowed text-fg-muted/30",
        )}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
        </svg>
      </button>
    </div>
  );
}
