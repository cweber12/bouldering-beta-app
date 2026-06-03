"use client";

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
  /** Hides the sort control (Climbs view uses its own ordering label). */
  showSort?: boolean;
}

// ---------------------------------------------------------------------------
// RouteToolbar — search + state/area filters + sort for the collection.
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
  const hasFilters = !!(search || state || area);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative min-w-0 flex-1 basis-48">
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
          placeholder="Search routes, areas&#8230;"
          className="ui-input py-1.5 pl-8 pr-3 text-sm"
        />
      </div>

      {/* State / area filters */}
      <input
        type="text"
        value={state}
        onChange={(e) => onState(e.target.value)}
        placeholder="State"
        className="ui-input w-24 py-1.5 px-2.5 text-sm"
        aria-label="Filter by state"
      />
      <input
        type="text"
        value={area}
        onChange={(e) => onArea(e.target.value)}
        placeholder="Area"
        className="ui-input w-28 py-1.5 px-2.5 text-sm"
        aria-label="Filter by area"
      />

      {/* Sort */}
      {showSort && (
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as RouteSort)}
          className="ui-input w-auto rounded-md px-2 py-1.5 text-xs"
          aria-label="Sort routes"
        >
          <option value="recent">Last climbed</option>
          <option value="oldest">Oldest</option>
          <option value="route">Route A–Z</option>
        </select>
      )}

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            onSearch("");
            onState("");
            onArea("");
          }}
          className={cn("rounded-md px-2 py-1.5 text-xs text-fg-muted transition hover:text-fg-secondary")}
        >
          Clear
        </button>
      )}
    </div>
  );
}
