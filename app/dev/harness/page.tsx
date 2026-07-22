"use client";

/**
 * Dev-only detection eval harness — three-act corpus manager.
 *
 * Lists the external downloader's Test Video corpus (via /api/dev/corpus) and
 * routes each video into one of three explicit acts, kept separate:
 *
 *  - **Setup** (SetupEditor): author the Scan Setup — Climber Crop, Wall Crop,
 *    analysis tap, panning, Quality Tier — plus condition-label metadata, by
 *    reusing the production StepSetDetection UI. Saves setup.json and re-POSTs
 *    video-stats; it seeds nothing.
 *  - **Calibrate / Re-calibrate** (Calibrator): a seed-tap-only view (enabled
 *    once a Setup exists). Persists the off-hash Seed tap, requests the
 *    downloader's ViTPose job over the uniform Detection Frame grid, and opens
 *    the flag-only Ground Truth review on the seed once it lands. Because the
 *    Seed tap is off-hash, re-seeding never re-pairs prior runs (ADR 0020).
 *  - **Analyze** (Analyzer): run the production pipeline against the saved Scan
 *    Setup, render the skeleton + diagnostics, and post the run.
 *
 * Bulk actions batch Analyze over fresh-truth bundles and re-seed stale-truth
 * ones. Rendered only in development. See docs/adr/0017, 0018, 0019 and 0020.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Analyzer from "@/components/dev/Analyzer";
import BatchAnalyzer from "@/components/dev/BatchAnalyzer";
import ReseedSweeper from "@/components/dev/ReseedSweeper";
import SetupEditor from "@/components/dev/SetupEditor";
import Calibrator from "@/components/dev/Calibrator";
import { planBatchAnalyze, type BatchAnalyzePlan } from "@/utils/harnessBatch";
import { planReseedSweep, type ReseedPlan } from "@/utils/harnessReseed";
import { type CorpusItem, type HarnessMode } from "@/utils/harnessCorpus";

const IS_DEV = process.env.NODE_ENV === "development";

/** What the corpus list opened a video for — the three acts are kept separate. */
type Selection = { item: CorpusItem; mode: HarnessMode };

export default function HarnessPage() {
  const [items, setItems] = useState<CorpusItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  // A running batch sweep. The plan is frozen at click so a mid-sweep refresh
  // (run counts changing after each post) never reshuffles the queue.
  const [batchPlan, setBatchPlan] = useState<BatchAnalyzePlan<CorpusItem> | null>(null);
  const batchPreview = useMemo(() => (items ? planBatchAnalyze(items) : null), [items]);
  // A running re-seed sweep, frozen at click for the same reason — badges flip
  // to seed-ready as artifacts land, and that must never reshuffle the queue.
  const [reseedPlan, setReseedPlan] = useState<ReseedPlan<CorpusItem> | null>(null);
  const reseedPreview = useMemo(() => (items ? planReseedSweep(items) : null), [items]);

  const refreshList = useCallback(async () => {
    setListError(null);
    try {
      const res = await fetch("/api/dev/corpus");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load corpus.");
      setItems(body.items as CorpusItem[]);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (IS_DEV) void refreshList();
  }, [refreshList]);

  if (!IS_DEV) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-fg-muted">
          The detection eval harness is only available in development.
        </p>
      </main>
    );
  }

  if (batchPlan) {
    return (
      <BatchAnalyzer
        plan={batchPlan}
        onBack={() => {
          setBatchPlan(null);
          void refreshList();
        }}
        onPosted={refreshList}
      />
    );
  }

  if (reseedPlan) {
    return (
      <ReseedSweeper
        plan={reseedPlan}
        onBack={() => {
          setReseedPlan(null);
          void refreshList();
        }}
        onLanded={refreshList}
      />
    );
  }

  if (selected?.mode === "analyze") {
    return (
      <Analyzer
        item={selected.item}
        onBack={() => setSelected(null)}
        // A posted run changes the run count; keep the Analyze view open so the
        // rendered result stays on screen.
        onDone={refreshList}
      />
    );
  }

  if (selected?.mode === "setup") {
    return (
      <SetupEditor
        item={selected.item}
        onBack={() => setSelected(null)}
        onDone={async () => {
          await refreshList();
          setSelected(null);
        }}
      />
    );
  }

  if (selected) {
    return (
      <Calibrator
        item={selected.item}
        onBack={() => setSelected(null)}
        onDone={async () => {
          await refreshList();
          setSelected(null);
        }}
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-fg">Detection eval harness</h1>
          <p className="text-sm text-fg-muted">
            Set up each Test Video, calibrate its Ground Truth, then run detection.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshList()}
            className="rounded-md bg-surface-alt px-3 py-1.5 text-sm text-fg"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => reseedPreview && setReseedPlan(reseedPreview)}
            disabled={!reseedPreview || reseedPreview.queue.length === 0}
            title="Submit a ViTPose job for every stale-truth bundle without a usable scaffold, one after another — seed-ready bundles are skipped, nothing is auto-accepted"
            className="rounded-md bg-surface-alt px-3 py-1.5 text-sm font-medium text-fg disabled:opacity-50"
          >
            Re-seed stale{reseedPreview ? ` (${reseedPreview.queue.length})` : ""}
          </button>
          <button
            type="button"
            onClick={() => batchPreview && setBatchPlan(batchPreview)}
            disabled={!batchPreview || batchPreview.queue.length === 0}
            title="Run Analyze over every video with accepted Ground Truth, one after another"
            className="rounded-md bg-send px-3 py-1.5 text-sm font-medium text-fg-inverse disabled:opacity-50"
          >
            Batch Analyze{batchPreview ? ` (${batchPreview.queue.length})` : ""}
          </button>
        </div>
      </header>

      {listError && (
        <p className="rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
          {listError}
        </p>
      )}

      {items === null ? (
        <p className="text-sm text-fg-muted">Loading corpus…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No Test Videos found. Check that HARNESS_ANALYSIS_ROOT points at the downloader&apos;s
          analysis folder.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge/40 text-left text-fg-muted">
                <th className="py-2 pr-3 font-medium">route / video</th>
                <th className="py-2 pr-3 font-medium">title</th>
                <th className="py-2 pr-3 font-medium">setup</th>
                <th className="py-2 pr-3 font-medium">truth</th>
                <th className="py-2 pr-3 font-medium tabular-nums">runs</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key} className="border-b border-edge/20 align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-fg">{it.routeFolder}</div>
                    <div className="font-mono text-xs text-fg-muted">{it.videoKey}</div>
                  </td>
                  <td className="max-w-xs py-2 pr-3 text-fg-muted">{it.title ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {it.hasSetup ? (
                      <span className="rounded bg-send-surface px-1.5 py-0.5 text-xs text-send">
                        calibrated
                      </span>
                    ) : (
                      <span className="rounded bg-caution-surface px-1.5 py-0.5 text-xs text-caution">
                        pending
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {!it.hasGroundTruth ? (
                      <span className="rounded bg-caution-surface px-1.5 py-0.5 text-xs text-caution">
                        none
                      </span>
                    ) : it.truthStale && it.seedReady ? (
                      <span
                        className="rounded bg-caution-surface px-1.5 py-0.5 text-xs text-caution"
                        title="Annotations were accepted under an older calibration, but a fresh ViTPose scaffold is already on disk — open Re-calibrate to review and re-accept, no new job needed"
                      >
                        stale · seed ready
                      </span>
                    ) : it.truthStale ? (
                      <span
                        className="rounded bg-caution-surface px-1.5 py-0.5 text-xs text-caution"
                        title="Annotations were accepted under an older calibration — re-run ViTPose and re-accept"
                      >
                        stale
                      </span>
                    ) : (
                      <span className="rounded bg-send-surface px-1.5 py-0.5 text-xs text-send">
                        accepted
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-fg">
                    {it.runCount}
                    {it.unpairedRunCount > 0 && (
                      <span
                        className="ml-1 text-xs text-caution"
                        title="Runs whose stamped setupHash pairs with no Ground Truth — they produce no evaluation evidence"
                      >
                        · {it.unpairedRunCount} unpaired
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected({ item: it, mode: "setup" })}
                        title="Author the Scan Setup — crops, tap, wall, tier — without seeding"
                        className="rounded-md bg-surface-alt px-3 py-1.5 text-xs font-medium text-fg"
                      >
                        Setup
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelected({ item: it, mode: "calibrate" })}
                        disabled={!it.hasSetup}
                        title={
                          it.hasSetup
                            ? "Seed-tap-only: tap the climber in a clear frame, run ViTPose, and review Ground Truth"
                            : "Save a Scan Setup before calibrating"
                        }
                        className="rounded-md bg-send/80 px-3 py-1.5 text-xs font-medium text-fg-inverse disabled:opacity-50"
                      >
                        {it.hasGroundTruth ? "Re-calibrate" : "Calibrate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelected({ item: it, mode: "analyze" })}
                        disabled={!it.hasSetup}
                        title={
                          it.hasSetup
                            ? "Run the production detection pipeline with this video's Scan Setup"
                            : "Save a Scan Setup before analyzing"
                        }
                        className="rounded-md bg-surface-alt px-3 py-1.5 text-xs font-medium text-fg disabled:opacity-50"
                      >
                        Analyze
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
