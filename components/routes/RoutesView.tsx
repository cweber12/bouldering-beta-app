"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { cn } from "@/utils/cn";
import RouteList from "@/components/routes/RouteList";
import RouteToolbar from "@/components/routes/RouteToolbar";
import ClimbGrid from "@/components/routes/ClimbGrid";
import { buildRouteUrl } from "@/utils/routeUrl";
import type { ClimbPin } from "@/components/map/ClimbsMap";
import type { RouteSummary, RouteListResponse, RouteSort } from "@/utils/routeSummary";

const ClimbsMap = dynamic(() => import("@/components/map/ClimbsMap"), { ssr: false });

type PaneMode = "routes" | "climbs";
type ViewMode = "list" | "map";

interface RoutesViewProps {
  /** Owner of the collection — scopes routes/climbs/photo to this user. */
  userId: string;
}

// ---------------------------------------------------------------------------
// RoutesView — the route-grouped collection presented as one inset panel.
// Desktop: route list (left) + map (right) inside a single rounded card, with
// all controls living in the list header so the map stays clean. Mobile: a
// List | Map toggle swaps the single visible pane (defaults to Map).
// ---------------------------------------------------------------------------

export default function RoutesView({ userId }: RoutesViewProps) {
  const router = useRouter();

  // Filters / sort.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterState, setFilterState] = useState("");
  const [filterArea, setFilterArea] = useState("");
  const [sort, setSort] = useState<RouteSort>("recent");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Layout state.
  const [paneMode, setPaneMode] = useState<PaneMode>("routes");
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Route data (drives both the list and the map pins).
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search box.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  // Fetch route-grouped summaries.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ sort });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (filterState) params.set("state", filterState);
    if (filterArea) params.set("area", filterArea);

    (async () => {
      try {
        const res = await fetch(`/api/profile/${userId}/routes?${params}`);
        if (!res.ok) throw new Error("Failed to load routes.");
        const data = (await res.json()) as RouteListResponse;
        if (!cancelled) setRoutes(data.items);
      } catch {
        if (!cancelled) setError("Could not load your routes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, debouncedSearch, filterState, filterArea, sort]);

  // Map pins — one per GPS-tagged route.
  const pins: ClimbPin[] = useMemo(
    () =>
      routes
        .filter((r) => r.hasGps && r.coordinates)
        .map((r) => ({
          lat: r.coordinates!.lat,
          lng: r.coordinates!.lng,
          label: r.route,
          runType: r.runType,
          timestamp: r.lastClimbedLabel,
          key: r.lastClimbKey,
        })),
    [routes],
  );

  const openRoute = (r: RouteSummary) => {
    router.push(
      buildRouteUrl(userId, { state: r.state, area: r.area, route: r.route }, { keys: [r.lastClimbKey] }),
    );
  };

  // Pin button on a row — highlight + reveal the route on the map.
  const focusMap = (r: RouteSummary) => {
    setSelectedKey(r.lastClimbKey);
    setViewMode("map");
  };

  // Map pin click — highlight the route and scroll its row into view.
  const onPinClick = (key: string) => {
    setSelectedKey(key);
    setViewMode("list");
  };

  // ── Reusable segmented toggles (shared between mobile bar + desktop header) ──

  const paneToggle = (
    <div className="ui-segmented text-xs" role="group" aria-label="Grouping">
      <button
        type="button"
        onClick={() => setPaneMode("routes")}
        className="ui-segmented-button px-3 py-1.5"
        aria-pressed={paneMode === "routes"}
      >
        Routes
      </button>
      <button
        type="button"
        onClick={() => setPaneMode("climbs")}
        className="ui-segmented-button px-3 py-1.5"
        aria-pressed={paneMode === "climbs"}
      >
        Climbs
      </button>
    </div>
  );

  const viewToggle = (
    <div className="ui-segmented text-xs" role="group" aria-label="View mode">
      <button
        type="button"
        onClick={() => setViewMode("list")}
        className="ui-segmented-button px-3 py-1.5"
        aria-pressed={viewMode === "list"}
      >
        List
      </button>
      <button
        type="button"
        onClick={() => setViewMode("map")}
        className="ui-segmented-button px-3 py-1.5"
        aria-pressed={viewMode === "map"}
      >
        Map
      </button>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-5">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden rounded-xl border border-edge/60 bg-surface-alt/20 shadow-sm">
        {/* Mobile-only toggle bar — always visible so you can switch panes. */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge/40 px-3 py-2 sm:hidden">
          {paneToggle}
          {viewToggle}
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* List column — owns all the controls. */}
          <div
            className={cn(
              "flex min-h-0 flex-col sm:w-[42%] sm:min-w-82.5 sm:max-w-120 sm:flex-none sm:border-r sm:border-edge/40",
              viewMode === "map" ? "hidden sm:flex" : "flex",
            )}
          >
            <div className="flex shrink-0 flex-col gap-2.5 border-b border-edge/40 px-3 py-2.5">
              {/* Desktop header row: title + grouping toggle. */}
              <div className="hidden items-center justify-between sm:flex">
                <h2 className="text-sm font-semibold text-fg">
                  {paneMode === "routes" ? "Routes" : "Climbs"}
                </h2>
                {paneToggle}
              </div>
              <RouteToolbar
                search={search}
                onSearch={setSearch}
                state={filterState}
                onState={setFilterState}
                area={filterArea}
                onArea={setFilterArea}
                sort={sort}
                onSort={setSort}
                showSort={paneMode === "routes"}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {paneMode === "routes" ? (
                <RouteList
                  routes={routes}
                  loading={loading}
                  error={error}
                  selectedKey={selectedKey}
                  onOpen={openRoute}
                  onFocusMap={focusMap}
                  emptyHint="No routes recorded yet."
                />
              ) : (
                <ClimbGrid
                  userId={userId}
                  search={debouncedSearch}
                  state={filterState}
                  area={filterArea}
                  sort={sort}
                />
              )}
            </div>
          </div>

          {/* Map column — clean, no controls. */}
          <div
            className={cn(
              "min-h-0 flex-1 p-3",
              viewMode === "list" ? "hidden sm:block" : "block",
            )}
          >
            <ClimbsMap pins={pins} fill onPinClick={onPinClick} />
          </div>
        </div>
      </div>
    </div>
  );
}
