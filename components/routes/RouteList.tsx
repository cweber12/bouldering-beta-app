"use client";

import { useEffect, useRef } from "react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import RouteRow from "@/components/routes/RouteRow";
import type { RouteSummary } from "@/utils/routeSummary";

interface RouteListProps {
  routes: RouteSummary[];
  loading: boolean;
  error: string | null;
  /** lastClimbKey of the currently selected route, or null. */
  selectedKey: string | null;
  onOpen: (route: RouteSummary) => void;
  onFocusMap: (route: RouteSummary) => void;
  emptyHint?: string;
}

// ---------------------------------------------------------------------------
// RouteList — single-column list of route rows. Scrolls the selected row into
// view when the selection changes from the map.
// ---------------------------------------------------------------------------

export default function RouteList({
  routes,
  loading,
  error,
  selectedKey,
  onOpen,
  onFocusMap,
  emptyHint = "No routes yet.",
}: RouteListProps) {
  const selectedRef = useRef<HTMLDivElement>(null);

  // When a route is selected (e.g. via a map pin), bring its row into view.
  useEffect(() => {
    if (selectedKey && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedKey]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-10">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <p className="m-3 rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger">
        {error}
      </p>
    );
  }

  if (routes.length === 0) {
    return <p className="px-3 py-8 text-center text-xs text-fg-muted">{emptyHint}</p>;
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {routes.map((r) => {
        const isSelected = r.lastClimbKey === selectedKey;
        return (
          <div key={`${r.state}/${r.area}/${r.route}`} ref={isSelected ? selectedRef : undefined}>
            <RouteRow
              route={r}
              selected={isSelected}
              onOpen={() => onOpen(r)}
              onFocusMap={() => onFocusMap(r)}
            />
          </div>
        );
      })}
    </div>
  );
}
