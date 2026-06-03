"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import type { RouteSort } from "@/utils/routeSummary";

interface RouteToolbarProps {
  search: string;
  onSearch: (v: string) => void;
  state: string;
  onState: (v: string) => void;
  area: string;
  onArea: (v: string) => void;
  sort: RouteSort;
  onSort: (v: RouteSort) => void;
  /** Hides the sort control (Climbs view uses its own ordering). */
  showSort?: boolean;
}

// ---------------------------------------------------------------------------
// RouteToolbar — list-header controls: a search field and sort menu inline,
// with State/Area filters tucked behind a popover so the header stays clean.
// ---------------------------------------------------------------------------

export default function RouteToolbar({
  search,
  onSearch,
  state,
  onState,
  area,
  onArea,
  sort,
  onSort,
  showSort = true,
}: RouteToolbarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const hasFilters = !!(state || area);

  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [filterOpen]);

  return (
    <div className="flex items-stretch gap-2">
      {/* Search — shares equal width with the sort control. */}
      <div className="relative min-w-0 flex-1">
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search&#8230;"
          className="ui-input h-9 pl-8 pr-3 text-sm"
        />
      </div>

      {/* Sort — equal width + height to the search field. */}
      {showSort && (
        <div className="min-w-0 flex-1">
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as RouteSort)}
            className="ui-input h-9 px-2.5 text-sm"
            aria-label="Sort routes"
          >
            <option value="recent">Last climbed</option>
            <option value="oldest">Oldest</option>
            <option value="route">Route A–Z</option>
          </select>
        </div>
      )}

      {/* Filter popover */}
      <div ref={filterRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setFilterOpen((o) => !o)}
          aria-expanded={filterOpen}
          aria-label="Filter by state and area"
          className={cn(
            "relative flex h-9 w-9 items-center justify-center rounded-md border transition",
            filterOpen || hasFilters
              ? "border-accent/60 text-accent"
              : "border-edge/60 text-fg-secondary hover:border-edge-hover hover:text-fg",
          )}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h18M6 12h12M10 19.5h4" />
          </svg>
          {hasFilters && (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />
          )}
        </button>

        {filterOpen && (
          <div className="ui-popover animate-fade-in absolute right-0 z-60 mt-2 w-56 p-3">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">State / Region</label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => onState(e.target.value)}
                  placeholder="Any"
                  className="ui-input px-2.5 py-1.5 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">Area</label>
                <input
                  type="text"
                  value={area}
                  onChange={(e) => onArea(e.target.value)}
                  placeholder="Any"
                  className="ui-input px-2.5 py-1.5 text-sm"
                />
              </div>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => {
                    onState("");
                    onArea("");
                  }}
                  className="self-start text-xs text-fg-muted transition hover:text-fg-secondary"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
