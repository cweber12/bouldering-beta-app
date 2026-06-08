"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import RunTypeBadge from "@/components/run/RunTypeBadge";
import { buildRouteUrl } from "@/utils/routeUrl";
import type { RouteSort } from "@/utils/routeSummary";

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

interface ClimbGridProps {
  userId: string;
  search: string;
  state: string;
  area: string;
  sort: RouteSort;
}

const PAGE_SIZE = 16;

/** Map the collection's RouteSort onto the climbs API's sort vocabulary. */
function climbSort(sort: RouteSort): string {
  return sort === "recent" ? "newest" : sort;
}

// ---------------------------------------------------------------------------
// ClimbGrid — the per-run secondary view. Each card opens the route console
// with that specific run selected (no intermediate modal).
// ---------------------------------------------------------------------------

export default function ClimbGrid({ userId, search, state, area, sort }: ClimbGridProps) {
  const router = useRouter();
  const [climbs, setClimbs] = useState<ClimbSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Reset to page 1 whenever the filters change.
  useEffect(() => {
    setPage(1);
  }, [search, state, area, sort]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set("search", search);
    if (state) params.set("state", state);
    if (area) params.set("area", area);
    params.set("sort", climbSort(sort));

    (async () => {
      try {
        const res = await fetch(`/api/profile/${userId}/climbs/page?${params}`);
        if (!res.ok) throw new Error("Failed to load climbs.");
        const data = (await res.json()) as ClimbPageResponse;
        if (!cancelled) {
          setClimbs(data.items);
          setTotal(data.total);
        }
      } catch {
        if (!cancelled) {
          setClimbs([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, page, search, state, area, sort]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const openClimb = (c: ClimbSummary) => {
    router.push(
      buildRouteUrl(userId, { state: c.state, area: c.area, route: c.route }, { keys: [c.key] }),
    );
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-10">
        <LoadingSpinner />
      </div>
    );
  }

  if (climbs.length === 0) {
    return <p className="px-3 py-8 text-center text-xs text-fg-muted">No climbs match the current filters.</p>;
  }

  return (
    <div className="p-3">
      <div className="grid grid-cols-2 gap-3">
        {climbs.map((c) => (
          <div
            key={c.key}
            role="button"
            tabIndex={0}
            onClick={() => openClimb(c)}
            onKeyDown={(e) => e.key === "Enter" && openClimb(c)}
            className="group cursor-pointer rounded-md border border-edge/60 bg-surface transition hover:border-edge-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-t-md bg-inset">
              {c.thumbnail ? (
                <Image
                  src={c.thumbnail}
                  alt={`${c.route} climb`}
                  fill
                  unoptimized
                  className="object-cover transition-transform duration-200 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-fg-muted/30">
                  <svg className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                </div>
              )}
            </div>
            <div className="px-2 py-2">
              <p className="truncate text-xs font-medium text-fg">{c.route}</p>
              <p className="truncate text-[10px] text-fg-muted">{c.area}&nbsp;&middot;&nbsp;{c.state}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <RunTypeBadge
                  runType={c.runType}
                  className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                />
                {c.rating && (
                  <span className="rounded bg-accent/15 px-1 py-0.5 text-[9px] font-medium text-accent">{c.rating}</span>
                )}
                <span className="text-[9px] text-fg-muted">{c.timestamp}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="ui-control px-3 py-1.5 text-xs disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-xs text-fg-muted">Page {page} of {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="ui-control px-3 py-1.5 text-xs disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
