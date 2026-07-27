"use client";

/**
 * Dev-only run reviewer — what the detector saw, frame by frame.
 *
 * A scoring number says N frames were `wrong`; this is where a human finds out
 * *why*. Three causes have to be distinguishable by eye, and they are only
 * distinguishable together:
 *
 *  - **the detector failed** — the attempt's evidence says so (nothing found,
 *    everything gated out, a pose discarded by the flip or quality gate);
 *  - **the frame was hostile** — the attempt's pixel conditions say so (shadow,
 *    backlight, blur), which is the evidence this whole surface exists for;
 *  - **the Ground Truth is wrong** — visible only by drawing the reference and
 *    the run's pose over the same frame, and reading the frame's truth
 *    provenance. Truth seeded from ViTPose and accepted by flag-only review can
 *    carry a wrong-person or distorted reference nobody ever objected to.
 *
 * Read-only over posted evidence: nothing here re-runs detection, re-scores a
 * run, or edits truth. Seeing a bad reference sends the operator to that
 * Bundle's Ground Truth review; it is not corrected from here.
 *
 * The run comes off disk (`utils/harnessRuns`), so a batch-posted run and a
 * manual one review identically and both survive a reload. See docs/adr/0017
 * and 0018.
 */

import { useCallback, useMemo, useState } from "react";
import DetectionFrameStepper, {
  type DetectionFrame,
  type DetectionFrameStatus,
} from "@/components/dev/DetectionFrameStepper";
import DiagnosticsPanel from "@/components/dev/DiagnosticsPanel";
import FrameStage, { type FrameStagePainter } from "@/components/dev/FrameStage";
import ScoringSummary from "@/components/dev/ScoringSummary";
import { useDetectionThumbnails } from "@/hooks/useDetectionThumbnails";
import { useRunReview } from "@/hooks/useRunReview";
import { cn } from "@/utils/cn";
import { dark } from "@/utils/theme";
import { getTopology } from "@/utils/poseConstants";
import { buildDetectionGrid, isOnDetectionGrid } from "@/utils/harnessDetectionGrid";
import { findScoredRow, type DetectionErrorKind, type DetectionErrorRow } from "@/utils/harnessScoring";
import type { CorpusItem } from "@/utils/harnessCorpus";
import type { GroundTruthFrame } from "@/utils/harnessGroundTruth";
import type { HarnessRunSummary } from "@/utils/harnessRuns";
import type { DetectorAttempt, DetectorAttemptRegion } from "@/utils/harnessPayloads";
import type { FrameConditions } from "@/pipeline/analysis/diagnostics";
import type { Keypoint } from "@/pipeline/pose/poseDetection";

const { keypointNames, skeletonEdges } = getTopology("mediapipe");

/**
 * Slack (seconds) for pairing a Detection Frame with the run's evidence. Grid
 * timestamps, probe times and Ground Truth timestamps all come from the same
 * `i x 100 ms` arithmetic, so a genuine pair is exact up to float noise and this
 * never reaches a neighbouring frame. Mirrors the scoring pass's 1 ms rule.
 */
const PAIR_TOLERANCE_SEC = 0.0015;

function atTimestamp<T extends { timestamp: number }>(
  items: readonly T[] | undefined,
  t: number,
): T | null {
  if (!items) return null;
  for (const item of items) {
    if (Math.abs(item.timestamp - t) <= PAIR_TOLERANCE_SEC) return item;
  }
  return null;
}

/**
 * Verdict to film-strip tint. The strip's vocabulary is the detector's
 * (detected / weak / missing), so the verdict ladder collapses onto it: `good`
 * reads healthy, `drift` reads as the warning band, and every worse verdict
 * reads as a fault. The collapse is deliberate — the exact verdict is one glance
 * away in the evidence panel, and grouping every non-good frame is what the
 * strip's jump-to-next-fault control walks. An `unscored` frame, or one with no
 * scored row at all, gets no status: it is outside the scoring domain, and
 * tinting it either way would assert a verdict that was never computed.
 *
 * On an *absent* Ground Truth frame the tint still reads as the verdict rather
 * than as presence: correctly holding no pose is `good` and shows healthy.
 */
const VERDICT_STATUS: Record<DetectionErrorKind, DetectionFrameStatus | undefined> = {
  good: "detected",
  drift: "weak",
  wrong: "missing",
  extreme: "missing",
  missing: "missing",
  unscored: undefined,
};

/** Verdict chip tone, matching ScoringSummary's vocabulary. */
const KIND_TONE: Record<DetectionErrorKind, string> = {
  good: "bg-send-surface text-send",
  drift: "bg-caution-surface text-caution",
  wrong: "bg-danger-surface text-danger",
  extreme: "bg-danger-surface text-danger",
  missing: "bg-danger-surface text-danger",
  unscored: "bg-surface-alt text-fg-muted",
};

/** Ground Truth provenance tone — a frame nobody objected to reads as neutral. */
const REVIEW_TONE: Record<string, string> = {
  auto: "bg-surface-alt text-fg-muted",
  human: "bg-send-surface text-send",
  "human-flagged-wrong": "bg-danger-surface text-danger",
  "human-flagged-absent": "bg-caution-surface text-caution",
};

function formatTime(seconds: number): string {
  const total = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** A run's picker label: when it ran, and whether it is evidence. */
function runLabel(run: HarnessRunSummary, currentTruthHash: string | null): string {
  const parts = [run.runTs];
  if (run.malformed) parts.push("unreadable");
  else if (!run.pairsWithTruth) parts.push("unpaired");
  else if (run.groundTruthHash && currentTruthHash && run.groundTruthHash !== currentTruthHash) {
    parts.push("re-score");
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Overlay painting
// ---------------------------------------------------------------------------

function strokeRegion(
  ctx: CanvasRenderingContext2D,
  region: DetectorAttemptRegion,
  width: number,
  height: number,
  color: string,
  lineWidth: number,
  dashed = false,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  if (dashed) ctx.setLineDash([lineWidth * 3, lineWidth * 2]);
  ctx.strokeRect(region.x * width, region.y * height, region.w * width, region.h * height);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Evidence panel
// ---------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-fg-muted">{label}</span>
      <span className="text-right font-mono tabular-nums text-fg">{value}</span>
    </div>
  );
}

function Conditions({ label, conditions }: { label: string; conditions: FrameConditions | null }) {
  if (!conditions) return null;
  const flags = Object.entries(conditions.flags)
    .filter(([, on]) => on)
    .map(([name]) => name);
  return (
    <div className="flex flex-col gap-1">
      <div className="font-medium text-fg-secondary">{label}</div>
      <Row label="brightness" value={conditions.overall.mean.toFixed(1)} />
      <Row label="contrast" value={conditions.overall.stdDev.toFixed(1)} />
      <Row label="sharpness" value={conditions.overall.sharpness.toFixed(1)} />
      {conditions.climber && (
        <Row label="climber brightness" value={conditions.climber.mean.toFixed(1)} />
      )}
      <div className="flex flex-wrap gap-1">
        {flags.length === 0 ? (
          <span className="text-fg-muted">no adverse flags</span>
        ) : (
          flags.map((f) => (
            <span key={f} className="rounded bg-caution-surface px-1.5 py-0.5 text-caution">
              {f}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-edge/30 pt-2 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
      <div className="flex flex-col gap-1 text-xs">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------

export default function RunReviewer({ item, onBack }: { item: CorpusItem; onBack: () => void }) {
  const {
    loading,
    loadError,
    videoUrl,
    videoMeta,
    groundTruth,
    runs,
    selected,
    selectRun,
    payload,
    runLoading,
    runError,
  } = useRunReview(item.key);

  const [frameIndex, setFrameIndex] = useState(0);
  const [showTruth, setShowTruth] = useState(true);
  const [showRun, setShowRun] = useState(true);
  const [showRegions, setShowRegions] = useState(true);
  const [runLayer, setRunLayer] = useState<"accepted" | "raw">("accepted");

  // The Detection Frame grid — the domain Ground Truth is authored on and the
  // one the reviewer walks, independent of what any run happened to probe.
  const gridFrames = useMemo(
    () => (videoMeta ? buildDetectionGrid(videoMeta.duration) : []),
    [videoMeta],
  );
  const thumbnails = useDetectionThumbnails(videoUrl, gridFrames, !loading);

  const scoring = payload?.scoring ?? null;
  const currentTime = gridFrames[frameIndex]?.timestamp ?? 0;

  const strip = useMemo<DetectionFrame[]>(
    () =>
      gridFrames.map((f) => {
        const row = scoring ? findScoredRow(scoring.rows, f.timestamp) : null;
        const status = row ? VERDICT_STATUS[row.kind] : undefined;
        return status ? { timestamp: f.timestamp, status } : { timestamp: f.timestamp };
      }),
    [gridFrames, scoring],
  );

  const currentRow: DetectionErrorRow | null = useMemo(
    () => (scoring ? findScoredRow(scoring.rows, currentTime) : null),
    [scoring, currentTime],
  );
  const truthFrame: GroundTruthFrame | null = useMemo(
    () => atTimestamp(groundTruth?.frames, currentTime),
    [groundTruth, currentTime],
  );
  const attempt: DetectorAttempt | null = useMemo(
    () => atTimestamp(payload?.detectorAttempts, currentTime),
    [payload, currentTime],
  );
  /** What the scanner kept at this timestamp — the pose scoring measured. */
  const acceptedKeypoints: Keypoint[] = useMemo(
    () => atTimestamp(payload?.frames, currentTime)?.keypoints ?? [],
    [payload, currentTime],
  );
  /** The detector's selection before the scanner's gates; only attempts carry it. */
  const rawKeypoints = attempt?.rawKeypoints ?? null;
  // Memoised so the painter below keeps a stable identity — the stage repaints
  // on painter change, and an inline conditional here would repaint every render.
  const runKeypoints = useMemo(
    () => (runLayer === "raw" ? (rawKeypoints ?? []) : acceptedKeypoints),
    [runLayer, rawKeypoints, acceptedKeypoints],
  );

  const paint = useMemo<FrameStagePainter>(
    () => (ctx, { width, height, unit, px }) => {
      const line = Math.max(1.5, unit * 0.0035);

      if (showRegions && attempt) {
        // The initial search region reads as the miss colour when the attempt
        // selected nothing there — where the detector looked, and came back empty.
        if (attempt.initialSearchRegion) {
          strokeRegion(
            ctx,
            attempt.initialSearchRegion,
            width,
            height,
            attempt.status === "missing" ? dark.cropMiss : dark.cropRegion,
            line,
          );
        }
        for (const step of attempt.reacquireSteps ?? []) {
          strokeRegion(
            ctx,
            step.region,
            width,
            height,
            step.found ? dark.cropRegion : dark.cropMiss,
            line,
            true,
          );
        }
        if (attempt.detectionRegion) {
          strokeRegion(ctx, attempt.detectionRegion, width, height, dark.cropLandmark, line);
        }
      }

      // Ground Truth: the authored core joints only — the domain the verdict was
      // computed over. Occluded joints are hollow, as in the truth reviewer.
      if (showTruth && truthFrame) {
        const joints = truthFrame.joints;
        ctx.save();
        ctx.strokeStyle = dark.truthPose;
        ctx.lineWidth = line;
        for (const [a, b] of skeletonEdges) {
          const pa = joints[keypointNames[a]];
          const pb = joints[keypointNames[b]];
          if (!pa || !pb) continue;
          const A = px(pa);
          const B = px(pb);
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
          ctx.stroke();
        }
        const r = Math.max(4, unit * 0.009);
        for (const joint of Object.values(joints)) {
          const p = px(joint);
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = dark.truthPose;
          ctx.fillStyle = dark.truthPose;
          if (!joint.occluded) ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      // The run's pose. Raw keypoints are drawn dashed — they are what the
      // detector proposed, not what the scanner kept.
      if (showRun && runKeypoints.length > 0) {
        const byName = new Map(runKeypoints.map((kp) => [kp.name, kp]));
        const truthNames = truthFrame ? new Set(Object.keys(truthFrame.joints)) : null;
        ctx.save();
        ctx.strokeStyle = dark.runPose;
        ctx.lineWidth = line;
        if (runLayer === "raw") ctx.setLineDash([line * 3, line * 2]);
        for (const [a, b] of skeletonEdges) {
          const pa = byName.get(keypointNames[a]);
          const pb = byName.get(keypointNames[b]);
          if (!pa || !pb) continue;
          const A = px(pa);
          const B = px(pb);
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.fillStyle = dark.runPose;
        for (const kp of runKeypoints) {
          // Joints outside the authored core set are context, not comparison.
          const core = !truthNames || truthNames.has(kp.name);
          const p = px(kp);
          ctx.beginPath();
          ctx.arc(p.x, p.y, core ? Math.max(4, unit * 0.009) : Math.max(1.5, unit * 0.004), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    },
    [showRegions, showTruth, showRun, attempt, truthFrame, runKeypoints, runLayer],
  );

  const handleSeek = useCallback((index: number) => setFrameIndex(index), []);

  const currentTruthHash = groundTruth?.groundTruthHash ?? null;
  const supersededTruth =
    !!selected?.groundTruthHash &&
    !!currentTruthHash &&
    selected.groundTruthHash !== currentTruthHash;

  const header = (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-edge/30 bg-surface px-4 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-fg">{item.title ?? item.routeFolder}</div>
        <div className="truncate font-mono text-xs text-fg-muted">{item.videoKey}</div>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          Run
          <select
            aria-label="Detection run"
            value={selected?.runTs ?? ""}
            onChange={(e) => selectRun(e.target.value)}
            disabled={runs.length === 0}
            className="rounded-md border border-edge bg-surface-alt px-2 py-1 font-mono text-xs text-fg disabled:opacity-50"
          >
            {runs.length === 0 && <option value="">no runs</option>}
            {runs.map((run) => (
              <option key={run.runTs} value={run.runTs}>
                {runLabel(run, currentTruthHash)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg"
        >
          Back to corpus
        </button>
      </div>
    </div>
  );

  if (loadError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-danger">{loadError}</p>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md bg-surface-alt px-3 py-1.5 text-sm text-fg"
        >
          Back to corpus
        </button>
      </main>
    );
  }

  if (loading || !videoUrl || !videoMeta) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-fg-muted">Loading {item.videoKey}…</p>
      </main>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-var(--nav-h))] min-h-0 flex-col">
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-surface p-3">
        <DetectionFrameStepper
          frames={strip}
          thumbnails={thumbnails}
          currentIndex={frameIndex}
          onSeek={handleSeek}
          className="shrink-0"
        />

        {runs.length === 0 ? (
          <p className="shrink-0 rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-xs text-caution">
            This Bundle has no posted detection run. Analyze it first.
          </p>
        ) : runError ? (
          <p className="shrink-0 rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger">
            {runError}
          </p>
        ) : runLoading ? (
          <p className="shrink-0 text-xs text-fg-muted">Loading run {selected?.runTs}…</p>
        ) : scoring ? (
          <ScoringSummary scoring={scoring} currentRow={currentRow} />
        ) : (
          <p className="shrink-0 text-xs text-fg-muted">
            This run posted unscored — it pairs with no accepted Ground Truth, so there are no
            verdicts to trace.
          </p>
        )}

        {supersededTruth && (
          <p
            role="status"
            className="shrink-0 rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-xs text-caution"
          >
            This run was scored against a superseded Ground Truth version — the truth has been
            edited since. Its verdicts are evidence about that older reference; re-run Analyze for
            fresh ones.
          </p>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          <FrameStage
            videoSrc={videoUrl}
            videoWidth={videoMeta.width}
            videoHeight={videoMeta.height}
            timestamp={currentTime}
            paint={paint}
            canvasLabel="Run pose and Ground Truth over the video frame"
            className="min-w-0 flex-1"
            controls={
              <div className="flex flex-wrap items-center gap-2">
                {/* Each toggle is tinted with the colour its skeleton is drawn
                    in, so the legend is the control itself. */}
                <label className="flex items-center gap-1.5 text-xs text-truth-pose">
                  <input
                    type="checkbox"
                    checked={showTruth}
                    onChange={(e) => setShowTruth(e.target.checked)}
                    className="accent-accent"
                  />
                  Ground Truth
                </label>
                <label className="flex items-center gap-1.5 text-xs text-run-pose">
                  <input
                    type="checkbox"
                    checked={showRun}
                    onChange={(e) => setShowRun(e.target.checked)}
                    className="accent-accent"
                  />
                  Run pose
                </label>
                <div
                  role="group"
                  aria-label="Run pose layer"
                  className="flex items-center gap-0.5 rounded-md bg-surface-alt p-0.5"
                >
                  {(["accepted", "raw"] as const).map((layer) => (
                    <button
                      key={layer}
                      type="button"
                      aria-pressed={runLayer === layer}
                      disabled={layer === "raw" && rawKeypoints === null}
                      title={
                        layer === "raw"
                          ? rawKeypoints === null
                            ? "This run carries no detector attempts, so the raw selection was never recorded"
                            : "What MediaPipe selected, before the scanner's flip and quality gates"
                          : "The pose the scanner kept — what scoring measured"
                      }
                      onClick={() => setRunLayer(layer)}
                      className={cn(
                        "rounded px-2 py-1 text-xs font-medium transition disabled:opacity-40",
                        runLayer === layer ? "bg-accent text-fg-inverse" : "text-fg-muted hover:text-fg",
                      )}
                    >
                      {layer}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={showRegions}
                    onChange={(e) => setShowRegions(e.target.checked)}
                    className="accent-accent"
                  />
                  Search regions
                </label>
              </div>
            }
            status={<span>{formatTime(currentTime)}</span>}
            caption={
              !isOnDetectionGrid(currentTime) ? (
                <span className="text-caution">
                  This frame is off the 100 ms Detection Frame grid — no Ground Truth was authored
                  here.
                </span>
              ) : !truthFrame ? (
                <span className="text-fg-muted">
                  No Ground Truth frame here — outside the authored truth.
                </span>
              ) : !currentRow ? (
                <span className="text-fg-muted">
                  This frame was not probed by the run, so it carries no verdict.
                </span>
              ) : (
                "Ground Truth and the run's pose are drawn over the frame; displacement is the gap between them."
              )
            }
          />

          <aside
            aria-label="Frame evidence"
            className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border border-edge/30 bg-surface p-3 lg:w-80"
          >
            <Section title="Verdict">
              {currentRow ? (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      data-testid="verdict-chip"
                      className={cn("rounded px-1.5 py-0.5 font-medium", KIND_TONE[currentRow.kind])}
                    >
                      {currentRow.kind}
                    </span>
                    <span className="text-fg-muted">{currentRow.state} frame</span>
                    {currentRow.unscoredReason && (
                      <span className="text-fg-muted">({currentRow.unscoredReason})</span>
                    )}
                  </div>
                  {currentRow.driftMax !== null && (
                    <Row label="drift max" value={currentRow.driftMax.toFixed(3)} />
                  )}
                  {currentRow.driftAvg !== null && (
                    <Row label="drift avg" value={currentRow.driftAvg.toFixed(3)} />
                  )}
                  {currentRow.worstJoint && <Row label="worst joint" value={currentRow.worstJoint} />}
                  {currentRow.bodyScale !== null && (
                    <Row label="body scale" value={currentRow.bodyScale.toFixed(4)} />
                  )}
                  {Object.entries(currentRow.jointDrift).length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-fg-muted">per-joint drift</summary>
                      <div className="mt-1 flex flex-col gap-0.5">
                        {Object.entries(currentRow.jointDrift)
                          .sort((a, b) => b[1] - a[1])
                          .map(([name, d]) => (
                            <Row key={name} label={name} value={d.toFixed(3)} />
                          ))}
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <p className="text-fg-muted">No scored row for this frame.</p>
              )}
            </Section>

            <Section title="Ground Truth">
              {truthFrame ? (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      data-testid="truth-review"
                      className={cn(
                        "rounded px-1.5 py-0.5 font-medium",
                        REVIEW_TONE[truthFrame.review] ?? "bg-surface-alt text-fg-muted",
                      )}
                    >
                      {truthFrame.review}
                    </span>
                    <span className="text-fg-muted">{truthFrame.state}</span>
                  </div>
                  {truthFrame.review === "auto" && currentRow && currentRow.kind !== "good" && (
                    <p className="text-fg-secondary">
                      Nobody ever objected to this reference. If the run&apos;s pose looks right on
                      the frame, the Ground Truth is the suspect — open this Bundle&apos;s Ground
                      Truth review.
                    </p>
                  )}
                  <Row label="joints authored" value={Object.keys(truthFrame.joints).length} />
                </>
              ) : (
                <p className="text-fg-muted">No Ground Truth frame at this timestamp.</p>
              )}
            </Section>

            <Section title="Detector attempt">
              {attempt ? (
                <>
                  <Row label="status" value={attempt.status} />
                  {attempt.status === "missing" && attempt.missReason && (
                    <Row label="miss reason" value={attempt.missReason} />
                  )}
                  {attempt.selectionMethod && (
                    <Row label="selection" value={attempt.selectionMethod} />
                  )}
                  <Row label="candidates" value={attempt.candidateCount} />
                  <Row label="rejected" value={attempt.rejectedCandidateCount} />
                  {attempt.bestUnselectedCandidateScore != null && (
                    <Row
                      label="best unselected"
                      value={attempt.bestUnselectedCandidateScore.toFixed(3)}
                    />
                  )}
                  <Row
                    label="re-acquire"
                    value={
                      attempt.reacquireAttempted
                        ? `${attempt.reacquired ? "found" : "failed"} · ${attempt.reacquireSteps?.length ?? 0} steps`
                        : "not attempted"
                    }
                  />
                  {attempt.inferenceMs !== undefined && (
                    <Row label="inference" value={`${attempt.inferenceMs.toFixed(1)} ms`} />
                  )}
                </>
              ) : payload?.detectorAttempts ? (
                <p className="text-fg-muted">No attempt recorded at this timestamp.</p>
              ) : (
                <p className="text-fg-muted">
                  This run predates the detector-attempt stream — scoring evidence only.
                </p>
              )}
            </Section>

            {attempt && (attempt.searchConditions || attempt.reacquireConditions) && (
              <Section title="Frame conditions">
                <Conditions label="search region" conditions={attempt.searchConditions} />
                <Conditions label="re-acquire region" conditions={attempt.reacquireConditions} />
              </Section>
            )}
          </aside>
        </div>

        <DiagnosticsPanel record={payload?.diagnostics ?? null} />
      </div>
    </div>
  );
}
