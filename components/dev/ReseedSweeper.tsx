"use client";

/**
 * Dev-only shared ViTPose sweeper — drives both the Re-seed stale sweep (batch
 * re-seed PRD issue 03) and the Batch Calibrate sweep (harness-setup-calibrate-
 * split issue 04). The two draw from different populations (stale-truth vs.
 * setup-but-truthless bundles) but run identically, so they share one sweeper
 * parametrized only by its {@link SweeperCopy}.
 *
 * Works the ViTPose backlog off the corpus page without opening bundles
 * individually: for each queued bundle, fetch the Test Video through the dev
 * proxy, probe its duration in-browser, build the uniform 100 ms Detection
 * Frame grid (legacy sparse-grid bundles densify), POST the job through the
 * existing relay — which deletes the prior artifact, so the freshness gates
 * apply identically to batch and manual seeding — and poll the existing GET
 * until {@link decideReseedStep} resolves it. Jobs run strictly one at a time
 * (the downloader owns one GPU); failures skip and summarize, never retry. The
 * sweep only lands scaffolds — it never writes Ground Truth, so every bundle
 * waits for a human to review and accept from the calibrator.
 *
 * Stop halts after the in-flight job: the downloader is already running it, so
 * abandoning the poll would only lose the outcome, not the work.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  decideReseedStep,
  type ReseedCandidate,
  type SweepPlan,
} from "@/utils/harnessReseed";
import {
  requestViTPoseScaffold,
  loadViTPose,
  VITPOSE_POLL_TIMEOUT_MS,
} from "@/utils/harnessViTPose";
import { buildDetectionGrid } from "@/utils/harnessDetectionGrid";
import { probeVideoMeta } from "@/utils/probeVideoMeta";
import { deriveSeedRegion } from "@/utils/cropContainment";
import type { CropFraction } from "@/utils/cropFraction";

/** The wording that distinguishes one sweep's population from the other's. */
export interface SweeperCopy {
  /** Header title, e.g. "Re-seed stale" / "Batch Calibrate". */
  title: string;
  /** The intro sentence for a queue of `queued` bundles. */
  intro: (queued: number) => string;
  /** The note for `n` seed-ready bundles skipped as review-only. */
  seedReadyNote: (n: number) => string;
  /** The note for `n` bundles skipped for lack of a Scan Setup. */
  noSetupNote: (n: number) => string;
  /** The note for `n` Untrackable bundles held out — a re-seed posed nothing. */
  untrackableNote: (n: number) => string;
  /** The empty-queue line. */
  empty: string;
}

const plural = (n: number) => (n === 1 ? "" : "s");

/** Re-seed stale wording — the default population is stale-truth bundles. */
export const RESEED_COPY: SweeperCopy = {
  title: "Re-seed stale",
  intro: (n) =>
    `Re-running ViTPose for the ${n} stale-truth bundle${plural(n)} without a usable ` +
    `scaffold, one job at a time. Nothing is auto-accepted — landed seeds wait for review ` +
    `in the calibrator.`,
  seedReadyNote: (n) =>
    `${n} stale bundle${plural(n)} skipped — seed already ready, open the calibrator to review.`,
  noSetupNote: (n) => `${n} skipped — stale truth without a Scan Setup.`,
  untrackableNote: (n) =>
    `${n} skipped — no landmarks with the current seed; re-seed the bundle to retry.`,
  empty: "Nothing to re-seed — no stale-truth bundle needs a ViTPose job.",
};

/** Batch Calibrate wording — the population is setup-but-truthless bundles. */
export const BATCH_CALIBRATE_COPY: SweeperCopy = {
  title: "Batch Calibrate",
  intro: (n) =>
    `Running ViTPose for the ${n} setup-but-truthless bundle${plural(n)} without a usable ` +
    `scaffold, one job at a time. Nothing is auto-accepted — landed seeds wait for review ` +
    `in the calibrator.`,
  seedReadyNote: (n) =>
    `${n} truthless bundle${plural(n)} skipped — seed already ready, open the calibrator to review.`,
  noSetupNote: (n) =>
    `${n} skipped — no Scan Setup yet, run Setup before calibrating.`,
  untrackableNote: (n) =>
    `${n} skipped — no landmarks with the current seed; re-seed the bundle to retry.`,
  empty: "Nothing to calibrate — no setup-but-truthless bundle needs a ViTPose job.",
};

/** What the sweep needs to know about one queued bundle. */
export interface ReseedRunItem extends ReseedCandidate {
  key: string;
  routeFolder: string;
  videoKey: string;
  /** External-API relative path — forwarded to the downloader in the job POST. */
  videoPath: string;
}

/** What became of one sweep entry. */
type EntryStatus = "pending" | "running" | "landed" | "failed";

interface EntryOutcome {
  status: "landed" | "failed";
  message: string;
}

/** The saved Scan Setup fields a ViTPose job request is built from. */
interface SetupForJob {
  climberCrop: CropFraction;
  wallCrop: CropFraction;
  /** The off-hash Seed tap, falling back to the analysis tap when unset. */
  seedTap?: { x: number; y: number; t?: number };
  /**
   * The **setup** tap, kept distinct from {@link seedTap} — its `t` is the climb
   * start (harness ADR 0007). Never substitute the seed tap here: conflating the
   * two is the defect ADR 0007 exists to remove.
   */
  climberPoint?: { x: number; y: number; t?: number };
  /** End-of-climb marker, when the Bundle has been marked. */
  climbEnd?: number;
  panning: boolean;
}

/** Load the bundle's saved Scan Setup, or throw when it cannot seed a job. */
async function loadSetupForJob(bundleKey: string): Promise<SetupForJob> {
  const res = await fetch(`/api/dev/corpus/setup?key=${encodeURIComponent(bundleKey)}`);
  if (!res.ok) throw new Error("Failed to load the Scan Setup.");
  const { setup } = await res.json();
  if (!setup?.climberCrop || !setup?.wallCrop) throw new Error("No saved Scan Setup.");
  return {
    climberCrop: setup.climberCrop,
    wallCrop: setup.wallCrop,
    // Prefer the dedicated Seed tap; fall back to the analysis tap (absent
    // seedTap means "use climberPoint" — harness-setup-calibrate-split issue 01).
    seedTap: setup.seedTap ?? setup.climberPoint ?? undefined,
    climberPoint: setup.climberPoint ?? undefined,
    climbEnd: typeof setup.climbEnd === "number" ? setup.climbEnd : undefined,
    panning: !!setup.panning,
  };
}

/** Fetch the Test Video through the dev proxy and probe its duration. */
async function probeBundleDuration(bundleKey: string): Promise<number> {
  const res = await fetch(`/api/dev/corpus/video?key=${encodeURIComponent(bundleKey)}`);
  if (!res.ok) throw new Error("Failed to load the video.");
  const url = URL.createObjectURL(await res.blob());
  try {
    return (await probeVideoMeta(url)).duration;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Drive one queue entry: video → duration → grid → job POST → poll to a
 * terminal step. Headless beyond a progress label — the sweep list is the
 * presentation. Reports exactly once, then the parent advances (unmounting it).
 */
function ReseedItemRunner({
  item,
  onLanded,
  onOutcome,
}: {
  item: ReseedRunItem;
  /** Bubbled when the artifact lands so the corpus listing's badges refresh. */
  onLanded: () => void | Promise<void>;
  onOutcome: (outcome: EntryOutcome) => void;
}) {
  const [stage, setStage] = useState("starting…");

  // The parent's callbacks change identity as entries update; the run itself
  // must not restart mid-job, so the effect reads them through refs and keys
  // only on the bundle.
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;
  const onOutcomeRef = useRef(onOutcome);
  onOutcomeRef.current = onOutcome;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reported = false;
    const report = (outcome: EntryOutcome) => {
      if (reported || cancelled) return;
      reported = true;
      if (outcome.status === "landed") void onLandedRef.current();
      onOutcomeRef.current(outcome);
    };

    void (async () => {
      try {
        setStage("probing video…");
        const duration = await probeBundleDuration(item.key);
        if (cancelled) return;
        const grid = buildDetectionGrid(duration);
        if (grid.length === 0) throw new Error("The video reports no usable duration.");

        const setup = await loadSetupForJob(item.key);
        if (cancelled) return;

        setStage("submitting job…");
        await requestViTPoseScaffold(item.key, {
          videoPath: item.videoPath,
          seedTap: setup.seedTap,
          seedRegion: deriveSeedRegion(setup.seedTap ?? null),
          climberCrop: setup.climberCrop,
          wallCrop: setup.wallCrop,
          panning: setup.panning,
          // Climb window, when the Bundle carries one. Each bound is omitted
          // independently so the harness can fall back to setup.json for it.
          // The start is the *setup* tap's time, never the seed tap's.
          ...(setup.climberPoint?.t !== undefined ? { climbStart: setup.climberPoint.t } : {}),
          ...(setup.climbEnd !== undefined ? { climbEnd: setup.climbEnd } : {}),
          frames: grid.map((f) => ({ timestamp: f.timestamp })),
        });
        if (cancelled) return;

        setStage("waiting for ViTPose…");
        const deadline = Date.now() + VITPOSE_POLL_TIMEOUT_MS;
        const poll = async () => {
          try {
            const result = await loadViTPose(item.key);
            if (cancelled) return;
            const step = decideReseedStep(result, Date.now() >= deadline);
            if (step.kind === "landed") {
              report({ status: "landed", message: "Scaffold landed — review from the calibrator." });
            } else if (step.kind === "failed") {
              report({ status: "failed", message: step.message });
            } else {
              timer = setTimeout(() => void poll(), 2000);
            }
          } catch (err) {
            if (!cancelled) {
              report({
                status: "failed",
                message: err instanceof Error ? err.message : String(err),
              });
            }
          }
        };
        await poll();
      } catch (err) {
        report({ status: "failed", message: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [item.key, item.videoPath]);

  return <span className="font-mono text-xs tabular-nums text-fg-muted">{stage}</span>;
}

const STATUS_TONE: Record<EntryStatus, string> = {
  pending: "bg-surface-alt text-fg-muted",
  running: "bg-caution-surface text-caution",
  landed: "bg-send-surface text-send",
  failed: "bg-danger-surface text-danger",
};

interface SweepEntry {
  item: ReseedRunItem;
  status: EntryStatus;
  message: string;
}

export default function ReseedSweeper({
  plan,
  onBack,
  onLanded,
  copy = RESEED_COPY,
}: {
  plan: SweepPlan<ReseedRunItem>;
  onBack: () => void;
  /** Called after each landed artifact so the corpus badges refresh mid-sweep. */
  onLanded: () => void | Promise<void>;
  /** Which sweep's wording to render — defaults to Re-seed stale. */
  copy?: SweeperCopy;
}) {
  const [entries, setEntries] = useState<SweepEntry[]>(() =>
    plan.queue.map((item) => ({ item, status: "pending", message: "" })),
  );
  const [index, setIndex] = useState(0);
  // Stop abandons the remaining queue but lets the in-flight job finish: the
  // runner stays mounted until its own outcome advances the index past it.
  const [haltAt, setHaltAt] = useState<number | null>(null);

  const limit = haltAt === null ? entries.length : Math.min(haltAt, entries.length);
  const active = index < limit ? entries[index] : null;
  const done = index >= limit;
  const stopped = haltAt !== null && limit < entries.length;

  const counts = useMemo(() => {
    let landed = 0;
    let failed = 0;
    for (const e of entries) {
      if (e.status === "landed") landed += 1;
      else if (e.status === "failed") failed += 1;
    }
    return { landed, failed };
  }, [entries]);

  const handleOutcome = (outcome: EntryOutcome) => {
    setEntries((prev) =>
      prev.map((e, i) =>
        i === index ? { ...e, status: outcome.status, message: outcome.message } : e,
      ),
    );
    setIndex((i) => i + 1);
  };

  return (
    <div className="flex h-[calc(100dvh-var(--nav-h))] min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge/30 bg-surface px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{copy.title}</div>
          <div className="truncate text-xs text-fg-muted">
            {done
              ? stopped
                ? `Stopped — ${counts.landed} landed, ${counts.failed} failed, ${
                    entries.length - index
                  } not run`
                : `Done — ${counts.landed} landed, ${counts.failed} failed`
              : `Running ${Math.min(index + 1, limit)} of ${entries.length}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!done && (
            <button
              type="button"
              onClick={() => setHaltAt(index + 1)}
              title="Finishes the in-flight ViTPose job (it is already running on the downloader), then abandons the rest of the queue"
              className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg"
            >
              Stop sweep
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
          {copy.intro(entries.length)}{" "}
          {plan.seedReady > 0 && <span>{copy.seedReadyNote(plan.seedReady)} </span>}
          {plan.skippedUntrackable > 0 && (
            <span className="text-fg-muted">{copy.untrackableNote(plan.skippedUntrackable)} </span>
          )}
          {plan.skippedNoSetup > 0 && (
            <span className="text-caution">{copy.noSetupNote(plan.skippedNoSetup)}</span>
          )}
        </p>

        {entries.length === 0 ? (
          <p className="text-sm text-fg-muted">{copy.empty}</p>
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
                  {active && i === index && (
                    <ReseedItemRunner
                      item={entry.item}
                      onLanded={onLanded}
                      onOutcome={handleOutcome}
                    />
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      STATUS_TONE[active && i === index ? "running" : entry.status]
                    }`}
                  >
                    {active && i === index
                      ? "running"
                      : entry.status === "pending"
                        ? done
                          ? "not run"
                          : "pending"
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
