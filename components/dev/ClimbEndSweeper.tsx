"use client";

/**
 * Dev-only Mark-ends sweep — authors `climbEnd` across the corpus in one sitting
 * (`harness-contract-adr0007-adoption` issue 02).
 *
 * Ninety Bundles need a marker before the harness's ~144-minute GPU re-seed is
 * worth running once, so the sweep — not the per-Bundle path — is the surface
 * that requirement lives in. It walks the marker backlog one Bundle at a time:
 * fetch the Test Video through the dev proxy, hand it to {@link ClimbEndEditor},
 * and on a set or clear persist off-hash through `saveClimbEnd` and advance.
 * Skip leaves a Bundle unmarked, which the harness reads as an open window —
 * exactly today's behavior — so skipping is a deferral, never a wrong answer.
 *
 * Unlike the ViTPose sweeps this submits no jobs and burns no GPU time: every
 * write is a merging PUT that leaves `setupHash` byte-identical, so no run goes
 * stale and no Ground Truth is orphaned by a sweep across the whole corpus.
 */

import { useCallback, useEffect, useState } from "react";
import ClimbEndEditor from "@/components/dev/ClimbEndEditor";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { saveClimbEnd } from "@/utils/harnessSetup";
import { formatClipTime, type ClimbEndPlan } from "@/utils/harnessClimbWindow";

/** What the sweep needs to know about one queued Bundle. */
export interface ClimbEndRunItem {
  key: string;
  routeFolder: string;
  videoKey: string;
  /** The setup tap's `t` — the climb start the marker is validated against. */
  climbStart?: number;
  /** The saved marker; queued entries start undefined by construction. */
  climbEnd?: number;
}

/** What became of one sweep entry. Pending until the operator resolves it. */
type EntryStatus = "pending" | "marked" | "cleared" | "skipped";

interface SweepEntry {
  item: ClimbEndRunItem;
  status: EntryStatus;
  /** The working marker, so revisiting an entry shows what was just written. */
  climbEnd?: number;
}

const STATUS_TONE: Record<EntryStatus, string> = {
  pending: "bg-surface-alt text-fg-muted",
  marked: "bg-send-surface text-send",
  cleared: "bg-surface-alt text-fg-muted",
  skipped: "bg-caution-surface text-caution",
};

export default function ClimbEndSweeper({
  plan,
  onBack,
  onSaved,
}: {
  plan: ClimbEndPlan<ClimbEndRunItem>;
  onBack: () => void;
  /** Called after each write so the corpus listing's climb column refreshes. */
  onSaved: () => void | Promise<void>;
}) {
  const [entries, setEntries] = useState<SweepEntry[]>(() =>
    plan.queue.map((item) => ({ item, status: "pending", climbEnd: item.climbEnd })),
  );
  const [index, setIndex] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const active = index < entries.length ? entries[index] : null;
  const done = index >= entries.length;
  const resolved = entries.filter((e) => e.status !== "pending").length;
  const markedHere = entries.filter((e) => e.status === "marked").length;

  // Load the active Bundle's Test Video. One at a time: the operator can only
  // watch one, and holding ninety blob URLs open would be the memory cost of the
  // whole corpus for no gain.
  const activeKey = active?.item.key ?? null;
  useEffect(() => {
    if (!activeKey) {
      setVideoUrl(null);
      return;
    }
    let revoked = false;
    let url: string | null = null;
    setVideoUrl(null);
    setLoadError(null);
    setSaveError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/dev/corpus/video?key=${encodeURIComponent(activeKey)}`);
        if (!res.ok) throw new Error("Failed to load the video.");
        const blob = await res.blob();
        if (revoked) return;
        url = URL.createObjectURL(blob);
        setVideoUrl(url);
      } catch (err) {
        if (!revoked) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [activeKey]);

  const resolve = useCallback((at: number, status: EntryStatus, climbEnd?: number) => {
    setEntries((prev) => prev.map((e, i) => (i === at ? { ...e, status, climbEnd } : e)));
    setIndex((i) => i + 1);
  }, []);

  const handleCommit = useCallback(
    (climbEnd: number | null) => {
      if (!active) return;
      const at = index;
      setSaving(true);
      setSaveError(null);
      void (async () => {
        try {
          const saved = await saveClimbEnd(active.item.key, climbEnd);
          void onSaved();
          resolve(at, climbEnd === null ? "cleared" : "marked", saved ?? undefined);
        } catch (err) {
          setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
          setSaving(false);
        }
      })();
    },
    [active, index, onSaved, resolve],
  );

  return (
    <div className="flex h-[calc(100dvh-var(--nav-h))] min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge/30 bg-surface px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">Mark climb ends</div>
          <div className="truncate text-xs text-fg-muted">
            {done
              ? `Done — ${markedHere} marked, ${resolved - markedHere} cleared or skipped, ` +
                `${entries.length - resolved} left unmarked`
              : `Bundle ${index + 1} of ${entries.length} · ${markedHere} marked`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {active && (
            <div className="min-w-0 text-right">
              <div className="truncate text-xs font-medium text-fg">{active.item.routeFolder}</div>
              <div className="truncate font-mono text-[11px] text-fg-muted">
                {active.item.videoKey}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded-md bg-send px-3 py-1.5 text-xs font-medium text-fg-inverse"
          >
            Back to corpus
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          <p className="text-sm text-fg-muted">
            Every Bundle with a Scan Setup already carries an end-of-climb marker.
          </p>
        </div>
      ) : done ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-surface p-4">
          <p className="text-xs text-fg-muted">
            {markedHere} of {entries.length} Bundles marked. A Bundle left unmarked keeps an open
            window — the harness scores it exactly as it does today — so the sweep can be re-run to
            finish the rest.
          </p>
          <ul className="flex flex-col gap-1">
            {entries.map((entry) => (
              <li
                key={entry.item.key}
                className="flex items-center justify-between gap-3 rounded-md border border-edge/20 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-fg">{entry.item.routeFolder}</div>
                  <div className="truncate font-mono text-xs text-fg-muted">
                    {entry.item.videoKey}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {entry.climbEnd !== undefined && (
                    <span className="font-mono text-xs tabular-nums text-fg-muted">
                      {formatClipTime(entry.climbEnd)}
                    </span>
                  )}
                  <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_TONE[entry.status]}`}>
                    {entry.status === "pending" ? "not reached" : entry.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : loadError ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8">
          <p className="text-sm text-danger">{loadError}</p>
          <button
            type="button"
            onClick={() => resolve(index, "skipped", active?.climbEnd)}
            className="rounded-md bg-surface-alt px-3 py-1.5 text-sm text-fg"
          >
            Skip this Bundle
          </button>
        </div>
      ) : !videoUrl ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8">
          <LoadingSpinner />
          <p className="text-sm text-fg-secondary">Loading {active?.item.videoKey}…</p>
        </div>
      ) : (
        active && (
          <div className="min-h-0 flex-1">
            <ClimbEndEditor
              // Each Bundle is a fresh mount: scrub position, strip and opening
              // seek all belong to one video and must not carry over.
              key={videoUrl}
              videoSrc={videoUrl}
              climbStart={active.item.climbStart}
              climbEnd={active.climbEnd}
              onCommit={handleCommit}
              busy={saving}
              error={saveError}
              actions={
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIndex((i) => Math.max(0, i - 1))}
                    disabled={saving || index === 0}
                    title="Go back to the previous Bundle to revise what you just wrote"
                    className="rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg disabled:opacity-50"
                  >
                    ← Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => resolve(index, "skipped", active.climbEnd)}
                    disabled={saving}
                    title="Leave this Bundle unmarked — its window stays open, which is how the harness behaves today"
                    className="rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg disabled:opacity-50"
                  >
                    Skip →
                  </button>
                </div>
              }
            />
          </div>
        )
      )}
    </div>
  );
}
