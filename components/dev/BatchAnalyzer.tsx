"use client";

/**
 * Dev-only batch Analyze sweep (calibration-analyze-split issue 05).
 *
 * Runs the full Analyze action — production scan, probed-frame scoring,
 * append-only post — over every corpus Test Video with accepted Ground Truth,
 * one at a time, and reports per-video outcomes plus the skip counts from the
 * plan so an under-calibrated corpus is visible. Each entry drives the same
 * {@link useAnalyzeRun} lifecycle the manual Analyze view uses, so a batch run
 * and a manual run post identical stamped records.
 *
 * The active entry runs inside a keyed child component: mounting starts its
 * load, un-mounting (advance or stop) aborts its seek loop via the processor's
 * cleanup. One video runs at a time — the pipeline saturates the main thread.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnalyzeRun, type AnalyzeRunItem } from "@/hooks/useAnalyzeRun";
import type { BatchAnalyzeCandidate, BatchAnalyzePlan } from "@/utils/harnessBatch";

/** What became of one batch entry. */
type EntryStatus = "pending" | "running" | "posted" | "failed";

/**
 * How long one entry may show no sign of progress before the sweep gives up on
 * it. The pipeline's own waits are bounded (see `utils/videoSeek`), so this is a
 * backstop rather than the mechanism: any *future* unbounded await would
 * otherwise stall the whole sweep on a single video, which is how a 45-minute
 * batch used to be lost to one stuck bundle. Generous, because ORB extraction
 * runs between the last frame and the diagnostics that end the run, and reports
 * no progress of its own.
 */
const ENTRY_STALL_TIMEOUT_MS = 10 * 60_000;

interface EntryOutcome {
  status: "posted" | "failed";
  message: string;
  /** False when the run posted unscored (truth vanished mid-sweep). */
  scored: boolean;
}

/**
 * Drive one queue entry through load → run → post and report the outcome once.
 * Headless beyond a progress row — the batch list is the presentation.
 */
function BatchItemRunner({
  item,
  onOutcome,
  onPosted,
}: {
  item: AnalyzeRunItem;
  onOutcome: (outcome: EntryOutcome) => void;
  /** Bubbled after each successful post so the corpus run counts refresh. */
  onPosted: () => void | Promise<void>;
}) {
  const {
    loading,
    loadError,
    setup,
    ready,
    phase,
    phaseError,
    post,
    scoring,
    currentFrame,
    totalFrames,
    run,
  } = useAnalyzeRun(item, onPosted);

  // Each entry reports exactly once; state keeps moving after the terminal
  // status (posted → onPosted refresh, error re-renders), so a ref gates it.
  const reportedRef = useRef(false);
  const report = useCallback(
    (outcome: EntryOutcome) => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      onOutcome(outcome);
    },
    [onOutcome],
  );

  // Start as soon as the trio + models are in hand. The ref guards the restart
  // `run` would otherwise get after a failure re-renders `phase` to "error".
  const startedRef = useRef(false);
  useEffect(() => {
    if (!ready || startedRef.current) return;
    startedRef.current = true;
    void run();
  }, [ready, run]);

  // Stall backstop. The effect re-arms whenever any progress signal changes, so
  // the timer only reaches zero if the entry has genuinely stopped moving.
  // `report` is idempotent, so a late fire after a real outcome is harmless.
  const progress = `${loading}|${phase}|${currentFrame}|${post.status}`;
  useEffect(() => {
    const timer = setTimeout(() => {
      report({
        status: "failed",
        message: `No progress for ${ENTRY_STALL_TIMEOUT_MS / 60_000} min — skipped.`,
        scored: false,
      });
    }, ENTRY_STALL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [progress, report]);

  useEffect(() => {
    if (loadError) {
      report({ status: "failed", message: loadError, scored: false });
    } else if (!loading && !setup) {
      report({ status: "failed", message: "No saved Scan Setup.", scored: false });
    } else if (phase === "error") {
      report({ status: "failed", message: phaseError ?? "Detection failed.", scored: false });
    } else if (post.status === "failed") {
      report({ status: "failed", message: post.message, scored: false });
    } else if (post.status === "posted") {
      report({ status: "posted", message: "Run posted.", scored: scoring !== null });
    }
  }, [loadError, loading, setup, phase, phaseError, post, scoring, report]);

  const pct = totalFrames > 0 ? Math.min(100, Math.round((currentFrame / totalFrames) * 100)) : 0;
  return (
    <span className="font-mono text-xs tabular-nums text-fg-muted">
      {loading
        ? "loading…"
        : phase === "running"
          ? `detecting ${pct}%`
          : phase === "result"
            ? post.status === "posting"
              ? "posting…"
              : "finishing…"
            : "starting…"}
    </span>
  );
}

const STATUS_TONE: Record<EntryStatus, string> = {
  pending: "bg-surface-alt text-fg-muted",
  running: "bg-caution-surface text-caution",
  posted: "bg-send-surface text-send",
  failed: "bg-danger-surface text-danger",
};

interface BatchEntry {
  item: AnalyzeRunItem;
  status: EntryStatus;
  message: string;
  scored: boolean;
}

export default function BatchAnalyzer({
  plan,
  onBack,
  onPosted,
}: {
  plan: BatchAnalyzePlan<AnalyzeRunItem & BatchAnalyzeCandidate>;
  onBack: () => void;
  /** Called after each posted run so the corpus list's run counts refresh. */
  onPosted: () => void | Promise<void>;
}) {
  const [entries, setEntries] = useState<BatchEntry[]>(() =>
    plan.queue.map((item) => ({ item, status: "pending", message: "", scored: false })),
  );
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);

  const active = !stopped && index < entries.length ? entries[index] : null;
  const done = stopped || index >= entries.length;

  const counts = useMemo(() => {
    let posted = 0;
    let failed = 0;
    let unscored = 0;
    for (const e of entries) {
      if (e.status === "posted") {
        posted += 1;
        if (!e.scored) unscored += 1;
      } else if (e.status === "failed") {
        failed += 1;
      }
    }
    return { posted, failed, unscored };
  }, [entries]);

  const handleOutcome = useCallback(
    (outcome: EntryOutcome) => {
      setEntries((prev) =>
        prev.map((e, i) =>
          i === index
            ? { ...e, status: outcome.status, message: outcome.message, scored: outcome.scored }
            : e,
        ),
      );
      setIndex((i) => i + 1);
    },
    [index],
  );

  return (
    <div className="flex h-[calc(100dvh-var(--nav-h))] min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge/30 bg-surface px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">Batch Analyze</div>
          <div className="truncate text-xs text-fg-muted">
            {done
              ? stopped
                ? `Stopped — ${counts.posted} posted, ${counts.failed} failed, ${
                    entries.length - index
                  } not run`
                : `Done — ${counts.posted} posted, ${counts.failed} failed`
              : `Running ${Math.min(index + 1, entries.length)} of ${entries.length}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!done && (
            <button
              type="button"
              onClick={() => setStopped(true)}
              title="Aborts the in-flight run; already-posted runs stand (posting is append-only)"
              className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg"
            >
              Stop batch
            </button>
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

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-surface p-4">
        <p className="text-xs text-fg-muted">
          Sweeping the {entries.length} corpus video{entries.length === 1 ? "" : "s"} with
          accepted Ground Truth.{" "}
          {plan.skippedNoTruth > 0 && (
            <span className="text-caution">
              {plan.skippedNoTruth} skipped — no accepted Ground Truth.{" "}
            </span>
          )}
          {plan.skippedStaleTruth > 0 && (
            <span className="text-caution">
              {plan.skippedStaleTruth} skipped — truth from an older calibration (re-seed
              and re-accept first).{" "}
            </span>
          )}
          {plan.skippedNoSetup > 0 && (
            <span className="text-caution">
              {plan.skippedNoSetup} skipped — truth without a Scan Setup.
            </span>
          )}
          {counts.unscored > 0 && (
            <span className="text-caution"> {counts.unscored} posted unscored.</span>
          )}
        </p>

        {entries.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Nothing to run — no corpus video has accepted Ground Truth yet. Calibrate and
            accept truth first.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {entries.map((entry, i) => (
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
                  {entry.status === "failed" && entry.message && (
                    <span className="max-w-xs truncate text-xs text-danger">{entry.message}</span>
                  )}
                  {entry.status === "posted" && !entry.scored && (
                    <span className="text-xs text-caution">unscored</span>
                  )}
                  {active && i === index && (
                    <BatchItemRunner
                      item={entry.item}
                      onOutcome={handleOutcome}
                      onPosted={onPosted}
                    />
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      STATUS_TONE[active && i === index ? "running" : entry.status]
                    }`}
                  >
                    {active && i === index
                      ? "running"
                      : stopped && entry.status === "pending"
                        ? "not run"
                        : entry.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
