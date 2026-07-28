"use client";

/**
 * Dev-only detection eval harness — corpus manager.
 *
 * Lists the external downloader's Test Video corpus (via /api/dev/corpus) and
 * routes each video into one of three explicit authoring acts, kept separate:
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
 * Plus a read-only fourth, **Review** (RunReviewer): open a run already posted
 * to disk and step its frames against Ground Truth. It writes nothing, and
 * unlike the acts above it works on evidence from any session — a batch-posted
 * run reviews exactly like a manual one.
 *
 * Bulk actions batch Analyze over fresh-truth bundles and re-seed stale-truth
 * ones. Rendered only in development. See docs/adr/0017, 0018, 0019 and 0020.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Analyzer from "@/components/dev/Analyzer";
import BatchAnalyzer from "@/components/dev/BatchAnalyzer";
import ReseedSweeper, { BATCH_CALIBRATE_COPY } from "@/components/dev/ReseedSweeper";
import ClimbEndSweeper from "@/components/dev/ClimbEndSweeper";
import SetupEditor from "@/components/dev/SetupEditor";
import Calibrator from "@/components/dev/Calibrator";
import RunReviewer from "@/components/dev/RunReviewer";
import { planBatchAnalyze, type BatchAnalyzePlan } from "@/utils/harnessBatch";
import {
  planReseedSweep,
  planBatchCalibrate,
  type ReseedPlan,
  type BatchCalibratePlan,
} from "@/utils/harnessReseed";
import {
  planClimbEndSweep,
  formatClimbWindow,
  CLIMB_WINDOW_UNMARKED,
  type ClimbEndPlan,
} from "@/utils/harnessClimbWindow";
import { type CorpusItem, type HarnessMode } from "@/utils/harnessCorpus";

const IS_DEV = process.env.NODE_ENV === "development";

/** What the corpus list opened a video for — the three acts are kept separate. */
type Selection = { item: CorpusItem; mode: HarnessMode };

// One cohesive button system across the whole harness: a single neutral family
// (soft-filled + border + hover) with green (send) reserved for the one action
// the harness exists to perform — Analyze in a row, Batch Analyze in the header.
// All state signal lives in the row badges, never in button colour.
const BTN_BASE =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50";
const BTN_NEUTRAL = `${BTN_BASE} border border-edge bg-surface-alt text-fg hover:border-edge-hover hover:bg-surface disabled:hover:border-edge disabled:hover:bg-surface-alt`;
const BTN_ACCENT = `${BTN_BASE} border border-transparent bg-send text-fg-inverse hover:bg-send/90 disabled:hover:bg-send`;
// A fixed lane width so the per-row actions stack into aligned columns and the
// Calibrate ↔ Re-calibrate label change never jitters the layout.
const ROW_BTN = "w-32";

/** Consistent count badge shown inside batch buttons. */
function CountPill({ n, tone }: { n: number; tone: "neutral" | "accent" }) {
  return (
    <span
      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
        tone === "accent" ? "bg-fg-inverse/20 text-fg-inverse" : "bg-surface/70 text-fg-muted"
      }`}
    >
      {n}
    </span>
  );
}

export default function HarnessPage() {
  const [items, setItems] = useState<CorpusItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  // A running batch sweep. The plan is frozen at click so a mid-sweep refresh
  // (run counts changing after each post) never reshuffles the queue.
  const [batchPlan, setBatchPlan] = useState<BatchAnalyzePlan<CorpusItem> | null>(null);
  // Two scoped previews: "all" re-scores every fresh-truth bundle (a pipeline
  // re-run), "un-analyzed" fills in bundles with no paired run yet. Both counts
  // stay live in the segmented control; a click freezes the chosen plan.
  const batchPreviewAll = useMemo(() => (items ? planBatchAnalyze(items, "all") : null), [items]);
  const batchPreviewUnanalyzed = useMemo(
    () => (items ? planBatchAnalyze(items, "un-analyzed") : null),
    [items],
  );
  // A running re-seed sweep, frozen at click for the same reason — badges flip
  // to seed-ready as artifacts land, and that must never reshuffle the queue.
  const [reseedPlan, setReseedPlan] = useState<ReseedPlan<CorpusItem> | null>(null);
  const reseedPreview = useMemo(() => (items ? planReseedSweep(items) : null), [items]);
  // A running Batch Calibrate sweep — same freeze-at-click, drawn from the
  // truthless (never yet accepted) population instead of the stale one.
  const [calibratePlan, setCalibratePlan] = useState<BatchCalibratePlan<CorpusItem> | null>(null);
  const calibratePreview = useMemo(() => (items ? planBatchCalibrate(items) : null), [items]);
  // A running Mark-ends sweep. Frozen at click like the others, though this one
  // submits no jobs — every write is an off-hash merging PUT.
  const [climbEndPlan, setClimbEndPlan] = useState<ClimbEndPlan<CorpusItem> | null>(null);
  const climbEndPreview = useMemo(() => (items ? planClimbEndSweep(items) : null), [items]);

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

  if (calibratePlan) {
    return (
      <ReseedSweeper
        plan={calibratePlan}
        copy={BATCH_CALIBRATE_COPY}
        onBack={() => {
          setCalibratePlan(null);
          void refreshList();
        }}
        onLanded={refreshList}
      />
    );
  }

  if (climbEndPlan) {
    return (
      <ClimbEndSweeper
        plan={climbEndPlan}
        onBack={() => {
          setClimbEndPlan(null);
          void refreshList();
        }}
        onSaved={refreshList}
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

  if (selected?.mode === "review") {
    return <RunReviewer item={selected.item} onBack={() => setSelected(null)} />;
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
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-fg">Detection eval harness</h1>
            <p className="text-sm text-fg-muted">
              Set up each Test Video, calibrate its Ground Truth, then run detection.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshList()}
            title="Reload the corpus list"
            className="shrink-0 rounded-md border border-edge px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-edge-hover hover:text-fg"
          >
            Refresh
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-edge/40 pt-3">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
            Batch
          </span>
          <button
            type="button"
            onClick={() => climbEndPreview && setClimbEndPlan(climbEndPreview)}
            disabled={!climbEndPreview || climbEndPreview.queue.length === 0}
            title="Walk every set-up bundle that has no end-of-climb marker, one at a time — scrub to the topout and mark it. Off-hash: no run goes stale and no Ground Truth is orphaned."
            className={BTN_NEUTRAL}
          >
            Mark ends
            {climbEndPreview && <CountPill n={climbEndPreview.queue.length} tone="neutral" />}
          </button>
          <button
            type="button"
            onClick={() => calibratePreview && setCalibratePlan(calibratePreview)}
            disabled={!calibratePreview || calibratePreview.queue.length === 0}
            title="Submit a ViTPose job for every setup-but-truthless bundle without a usable scaffold, one after another — seed-ready bundles are skipped, nothing is auto-accepted"
            className={BTN_NEUTRAL}
          >
            Calibrate
            {calibratePreview && <CountPill n={calibratePreview.queue.length} tone="neutral" />}
          </button>
          <button
            type="button"
            onClick={() => reseedPreview && setReseedPlan(reseedPreview)}
            disabled={!reseedPreview || reseedPreview.queue.length === 0}
            title="Submit a ViTPose job for every stale-truth bundle without a usable scaffold, one after another — seed-ready bundles are skipped, nothing is auto-accepted"
            className={BTN_NEUTRAL}
          >
            Re-seed
            {reseedPreview && <CountPill n={reseedPreview.queue.length} tone="neutral" />}
          </button>
          <div className="flex items-stretch overflow-hidden rounded-md">
            <button
              type="button"
              onClick={() => batchPreviewAll && setBatchPlan(batchPreviewAll)}
              disabled={!batchPreviewAll || batchPreviewAll.queue.length === 0}
              title="Run Analyze over every video with fresh accepted Ground Truth, one after another — re-scores bundles already analyzed"
              className={`${BTN_ACCENT} rounded-none`}
            >
              Analyze all
              {batchPreviewAll && <CountPill n={batchPreviewAll.queue.length} tone="accent" />}
            </button>
            <button
              type="button"
              onClick={() => batchPreviewUnanalyzed && setBatchPlan(batchPreviewUnanalyzed)}
              disabled={!batchPreviewUnanalyzed || batchPreviewUnanalyzed.queue.length === 0}
              title="Run Analyze only over fresh-truth videos with no paired run yet — skips ones already analyzed"
              className={`${BTN_ACCENT} rounded-none border-l border-surface/30 bg-send/80 hover:bg-send/70 disabled:hover:bg-send/80`}
            >
              Un-analyzed
              {batchPreviewUnanalyzed && (
                <CountPill n={batchPreviewUnanalyzed.queue.length} tone="accent" />
              )}
            </button>
          </div>
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
                <th className="py-2 pr-3 font-medium">video</th>
                <th className="py-2 pr-3 font-medium">setup</th>
                <th className="py-2 pr-3 font-medium">truth</th>
                <th className="py-2 pr-3 font-medium">climb</th>
                <th className="py-2 pr-3 font-medium tabular-nums">runs</th>
                <th className="py-2 font-medium text-right">actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key} className="border-b border-edge/20 align-top">
                  <td className="max-w-xs py-2 pr-3">
                    <div className="truncate font-medium text-fg">
                      {it.title ?? it.routeFolder}
                    </div>
                    <div className="truncate font-mono text-xs text-fg-muted">{it.videoKey}</div>
                    {it.title && (
                      <div className="truncate text-xs text-fg-muted">{it.routeFolder}</div>
                    )}
                  </td>
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
                      it.seedReady ? (
                        <span
                          className="rounded bg-send-surface px-1.5 py-0.5 text-xs text-send"
                          title="A fresh ViTPose scaffold is on disk but Ground Truth was never accepted — open Calibrate and use Review seed to accept it, no new job needed"
                        >
                          seed ready
                        </span>
                      ) : it.untrackable ? (
                        <span
                          className="rounded bg-surface-alt px-1.5 py-0.5 text-xs text-fg-muted"
                          title="ViTPose tracked no Climber with the current seed — held out of the batch sweeps. Open Calibrate, re-tap the Climber, and re-seed to retry."
                        >
                          no landmarks
                        </span>
                      ) : (
                        <span className="rounded bg-caution-surface px-1.5 py-0.5 text-xs text-caution">
                          none
                        </span>
                      )
                    ) : it.truthStale && it.untrackable ? (
                      <span
                        className="rounded bg-surface-alt px-1.5 py-0.5 text-xs text-fg-muted"
                        title="Ground Truth is stale (an older calibration or an older ViTPose scaffold) and the last re-seed tracked no Climber with the current seed — held out of the batch sweeps. Open Re-calibrate, re-tap the Climber, and re-seed to retry."
                      >
                        stale · no landmarks
                      </span>
                    ) : it.truthStale && it.seedReady ? (
                      <span
                        className="rounded bg-caution-surface px-1.5 py-0.5 text-xs text-caution"
                        title="Annotations were accepted against an older calibration or an older ViTPose scaffold, but a fresh scaffold is already on disk — open Re-calibrate to review and re-accept, no new job needed"
                      >
                        stale · seed ready
                      </span>
                    ) : it.truthStale ? (
                      <span
                        className="rounded bg-caution-surface px-1.5 py-0.5 text-xs text-caution"
                        title="Annotations were accepted against an older calibration or an older ViTPose scaffold — re-run ViTPose and re-accept"
                      >
                        stale
                      </span>
                    ) : (
                      <span className="rounded bg-send-surface px-1.5 py-0.5 text-xs text-send">
                        accepted
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {it.climbEnd === undefined ? (
                      <span
                        className="rounded bg-surface-alt px-1.5 py-0.5 text-xs text-fg-muted"
                        title="No end-of-climb marker — the window is open on that side, so post-topout frames are scored in-scope. Not an error; use Mark ends to author one."
                      >
                        {CLIMB_WINDOW_UNMARKED}
                      </span>
                    ) : (
                      <span
                        className="font-mono text-xs tabular-nums text-fg-muted"
                        title="The climb window: setup tap to end-of-climb marker. Off-hash — marking it never changed this bundle's setupHash."
                      >
                        {formatClimbWindow(it.climbStart, it.climbEnd)}
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
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected({ item: it, mode: "setup" })}
                        title="Author the Scan Setup — crops, tap, wall, tier — without seeding"
                        className={`${BTN_NEUTRAL} ${ROW_BTN}`}
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
                        className={`${BTN_NEUTRAL} ${ROW_BTN}`}
                      >
                        {it.hasGroundTruth ? "Re-calibrate" : "Calibrate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelected({ item: it, mode: "review" })}
                        disabled={it.runCount === 0}
                        title={
                          it.runCount === 0
                            ? "No posted run to review — analyze this video first"
                            : "Look at what the detector saw frame by frame, against Ground Truth"
                        }
                        className={`${BTN_NEUTRAL} ${ROW_BTN}`}
                      >
                        Review
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
                        className={`${BTN_ACCENT} ${ROW_BTN}`}
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
