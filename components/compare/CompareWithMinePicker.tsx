"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import RunTypeBadge from "@/components/run/RunTypeBadge";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

// ---------------------------------------------------------------------------
// CompareWithMinePicker — the "bring mine to theirs" step of cross-user
// comparison. Given a guest Run (another user's climb), the signed-in user
// picks one of their OWN Runs to overlay against it. Defaults to the user's
// Runs of the same {state}/{area}/{route}; when none match (naming differs
// across users), the user can browse their whole collection. The caller
// receives the chosen key + route context and routes into the console hosted
// on the user's own route.
// ---------------------------------------------------------------------------

/** A summary of one of my saved Runs (subset of the climbs/page ClimbSummary). */
export interface MyRunSummary {
  key: string;
  state: string;
  area: string;
  route: string;
  runType: string;
  timestamp: string;
  rating?: string;
  thumbnail?: string;
}

interface GuestRoute {
  state: string;
  area: string;
  route: string;
}

interface CompareWithMinePickerProps {
  /** The signed-in user's Firebase UID (owner of the runs being listed). */
  myUserId: string;
  /** The guest Run's route context — used to pre-filter to matching runs. */
  guest: GuestRoute;
  onClose: () => void;
  onPick: (run: MyRunSummary) => void;
}

type Scope = "same-route" | "all";

export default function CompareWithMinePicker({
  myUserId,
  guest,
  onClose,
  onPick,
}: CompareWithMinePickerProps) {
  const [scope, setScope] = useState<Scope>("same-route");
  const [items, setItems] = useState<MyRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (which: Scope) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: "1", pageSize: "16", sort: "newest" });
        if (which === "same-route") {
          params.set("state", guest.state);
          params.set("area", guest.area);
          params.set("route", guest.route);
          params.set("exact", "1");
        }
        const res = await fetch(
          `/api/profile/${encodeURIComponent(myUserId)}/climbs/page?${params.toString()}`,
        );
        if (!res.ok) {
          const msg = ((await res.json()) as { error?: string }).error ?? "Could not load runs.";
          throw new Error(msg);
        }
        const data = (await res.json()) as { items: MyRunSummary[] };
        setItems(data.items ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [myUserId, guest.state, guest.area, guest.route],
  );

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  const showBrowseAll = scope === "same-route" && !loading && items.length === 0 && !error;

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="Choose one of your runs to compare"
      containerClassName="px-4 py-6"
      panelClassName="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-edge/50 bg-(--color-surface) shadow-xl"
      zClassName="z-1001"
    >
      <div className="flex items-center justify-between border-b border-edge/50 px-5 py-3">
        <div>
          <h2 className="text-base font-semibold text-fg">Compare with your run</h2>
          <p className="mt-0.5 text-xs text-fg-secondary">
            {scope === "same-route"
              ? `Your runs of ${guest.route}`
              : "All your runs — pick one to overlay"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ui-control flex h-9 w-9 items-center justify-center rounded-md text-fg-secondary"
          aria-label="Close"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
          </div>
        )}

        {!loading && error && (
          <div className="rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items.map((run) => (
              <li key={run.key}>
                <button
                  type="button"
                  onClick={() => onPick(run)}
                  className="ui-control group flex w-full flex-col overflow-hidden rounded-md border border-edge/50 text-left"
                >
                  <div className="relative aspect-square w-full bg-(--color-inset)">
                    {run.thumbnail ? (
                      <Image
                        src={run.thumbnail}
                        alt={`${run.route} run`}
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-fg-muted/30">
                        <svg
                          className="h-8 w-8"
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
                    <RunTypeBadge
                      runType={run.runType}
                      variant="overlay"
                      className="absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    />
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="truncate text-xs font-medium text-fg">{run.route}</p>
                    <p className="truncate text-[11px] text-fg-secondary">{run.timestamp}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {showBrowseAll && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-fg-secondary">
              You have no saved runs filed under {guest.route}.
            </p>
            <button
              type="button"
              onClick={() => setScope("all")}
              className="ui-control-primary rounded-md px-4 py-2 text-sm font-semibold"
            >
              Browse all my runs
            </button>
          </div>
        )}

        {!loading && !error && scope === "all" && items.length === 0 && (
          <p className="py-10 text-center text-sm text-fg-secondary">You have no saved runs yet.</p>
        )}
      </div>
    </Modal>
  );
}
