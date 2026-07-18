"use client";

/**
 * Dev-only scoring summary for the Analyze step.
 *
 * Renders the probed-frame scoring block (utils/harnessScoring.ts) beside the
 * rendered run: verdict counts, the coverage / detection-rate stats, the drift
 * aggregate, and the verdict of the frame the player is currently on. Verified
 * and unverified evidence are shown as one merged count row with the split
 * available in the stats — the posted rollup keeps them fully separate.
 */

import type {
  DetectionErrorKind,
  DetectionErrorRow,
  DetectionScoring,
  VerdictCounts,
} from "@/utils/harnessScoring";

/** Verdict → semantic-token chip classes. */
const KIND_TONE: Record<DetectionErrorKind | "absentOk" | "absentViolation", string> = {
  good: "bg-send-surface text-send",
  drift: "bg-caution-surface text-caution",
  wrong: "bg-danger-surface text-danger",
  extreme: "bg-danger-surface text-danger",
  missing: "bg-danger-surface text-danger",
  unscored: "bg-surface-alt text-fg-muted",
  absentOk: "bg-send-surface text-send",
  absentViolation: "bg-danger-surface text-danger",
};

const COUNT_KEYS: readonly (keyof VerdictCounts)[] = [
  "good",
  "drift",
  "wrong",
  "extreme",
  "missing",
  "unscored",
  "absentOk",
  "absentViolation",
];

function mergedCounts(scoring: DetectionScoring): VerdictCounts {
  const out = {} as VerdictCounts;
  for (const key of COUNT_KEYS) {
    out[key] = scoring.rollup.verified.counts[key] + scoring.rollup.unverified.counts[key];
  }
  return out;
}

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

/** The chip label for a row: absent frames read as their rollup bucket. */
function rowLabel(row: DetectionErrorRow): keyof typeof KIND_TONE {
  if (row.state === "absent") return row.kind === "wrong" ? "absentViolation" : "absentOk";
  return row.kind;
}

export default function ScoringSummary({
  scoring,
  currentRow,
}: {
  scoring: DetectionScoring;
  /** The scored row for the frame the player is on, when one paired. */
  currentRow: DetectionErrorRow | null;
}) {
  const counts = mergedCounts(scoring);
  const drift = scoring.rollup.verified.drift ?? scoring.rollup.unverified.drift;

  return (
    <section
      aria-label="Scoring vs Ground Truth"
      className="shrink-0 rounded-md border border-edge/30 bg-surface px-3 py-2 text-xs"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="font-medium text-fg">Ground Truth verdicts</span>
        <div className="flex flex-wrap items-center gap-1">
          {COUNT_KEYS.filter((key) => counts[key] > 0).map((key) => (
            <span
              key={key}
              className={`rounded px-1.5 py-0.5 tabular-nums ${KIND_TONE[key]}`}
            >
              {key} {counts[key]}
            </span>
          ))}
          {scoring.rows.length === 0 && (
            <span className="text-fg-muted">no probed Ground Truth frames</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums text-fg-muted">
          <span>probe coverage {pct(scoring.rollup.probeCoverage)}</span>
          <span>detection vs GT {pct(scoring.rollup.detectionRateVsGT)}</span>
          <span>verified {pct(scoring.rollup.verifiedCoverage)}</span>
          {drift && <span>drift avg {drift.avg.toFixed(3)}</span>}
          {scoring.rollup.offGridRunFrames > 0 && (
            <span className="text-caution">
              {scoring.rollup.offGridRunFrames} probes off the truth grid
            </span>
          )}
          <span title={scoring.groundTruthHash}>gt {scoring.groundTruthHash.slice(0, 12)}</span>
        </div>
        {currentRow && (
          <span className="flex items-center gap-1.5">
            <span className="text-fg-muted">this frame:</span>
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${KIND_TONE[rowLabel(currentRow)]}`}
            >
              {rowLabel(currentRow)}
            </span>
            {currentRow.driftMax !== null && (
              <span className="font-mono tabular-nums text-fg-muted">
                max {currentRow.driftMax.toFixed(3)}
                {currentRow.worstJoint ? ` (${currentRow.worstJoint})` : ""}
              </span>
            )}
          </span>
        )}
      </div>
    </section>
  );
}
