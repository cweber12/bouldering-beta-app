"use client";

/**
 * Dev-only detection-diagnostics panel.
 *
 * Renders the live {@link ScanDiagnostics} (on StepViewLandmarks) or
 * {@link MatchDiagnostics} (on StepMatchRoutePhoto) record for the current scan
 * / match, with quality-tag buttons whose value rides into a re-shipped JSONL
 * line. Collapsed by default and rendered only in development — it returns null
 * otherwise, so it is inert in production builds.
 */

import { useState } from "react";
import { cn } from "@/utils/cn";
import { shipDiagnostics } from "@/utils/shipDiagnostics";
import type {
  ScanDiagnostics,
  MatchDiagnostics,
  OverlayQuality,
  MatchQuality,
  MinAvgMax,
  ConditionFlags,
} from "@/pipeline/diagnostics";

type DiagnosticsRecord = ScanDiagnostics | MatchDiagnostics;

export interface DiagnosticsPanelProps {
  /** The assembled diagnostics record, or null before one is ready. */
  record: DiagnosticsRecord | null;
}

const IS_DEV = process.env.NODE_ENV === "development";

/** Tag → semantic token class for the active state. */
const TAG_TONE: Record<string, string> = {
  good: "bg-send-surface text-send border-send/40",
  drift: "bg-caution-surface text-caution border-caution-border",
  weak: "bg-caution-surface text-caution border-caution-border",
  fail: "bg-danger-surface text-danger border-danger-border",
};

const SCAN_TAGS: OverlayQuality[] = ["good", "drift", "fail"];
const MATCH_TAGS: MatchQuality[] = ["good", "weak", "fail"];

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

function pct(n: number): string {
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-fg-muted">{label}</span>
      <span className="font-mono text-fg tabular-nums">{value}</span>
    </div>
  );
}

function Flags({ flags }: { flags: ConditionFlags }) {
  const active = Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/^is/, ""));
  return (
    <div className="flex flex-wrap gap-1">
      {active.length === 0 ? (
        <span className="text-fg-muted">none</span>
      ) : (
        active.map((f) => (
          <span key={f} className="rounded bg-caution-surface px-1.5 py-0.5 text-[10px] text-caution">
            {f}
          </span>
        ))
      )}
    </div>
  );
}

export default function DiagnosticsPanel({ record }: DiagnosticsPanelProps) {
  const [open, setOpen] = useState(false);
  // The manual tag override is keyed to its record so a new record drops back to
  // that record's own tag without an effect (avoids set-state-in-effect).
  const [override, setOverride] = useState<{ record: DiagnosticsRecord; tag: string } | null>(null);

  if (!IS_DEV || !record) return null;

  const baseTag =
    record.recordType === "scan" ? record.result.overlayQuality : record.result.matchQuality;
  const tag = override?.record === record ? override.tag : baseTag;

  // Apply a quality tag and re-ship the record so the JSONL line carries it.
  function applyTag(value: string) {
    if (!record) return;
    setOverride({ record, tag: value });
    const tagged: DiagnosticsRecord =
      record.recordType === "scan"
        ? { ...record, result: { ...record.result, overlayQuality: value as OverlayQuality } }
        : { ...record, result: { ...record.result, matchQuality: value as MatchQuality } };
    shipDiagnostics(tagged);
  }

  const tags = record.recordType === "scan" ? SCAN_TAGS : MATCH_TAGS;
  const title = record.recordType === "scan" ? "Scan Diagnostics" : "Match Diagnostics";

  return (
    <div className="fixed bottom-3 right-3 z-50 w-72 max-w-[calc(100vw-1.5rem)] text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-t-md border border-edge bg-surface-alt px-3 py-2 font-medium text-fg-secondary"
      >
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
          {title}
        </span>
        <span className="text-fg-muted">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="max-h-[60vh] overflow-y-auto rounded-b-md border border-t-0 border-edge bg-surface px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between text-[10px] text-fg-muted">
            <span className="font-mono">{record.appVersion}</span>
            <span>{new Date(record.createdAt).toLocaleTimeString()}</span>
          </div>

          {record.recordType === "scan" ? (
            <ScanBody record={record} />
          ) : (
            <MatchBody record={record} />
          )}

          {/* Quality tag buttons — the chosen value rides into the JSONL write. */}
          <div className="mt-3 border-t border-edge/60 pt-2">
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-fg-muted">
              {record.recordType === "scan" ? "Overlay quality" : "Match quality"}
            </p>
            <div className="flex gap-1.5">
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => applyTag(t)}
                  className={cn(
                    "flex-1 rounded border px-2 py-1 font-medium capitalize transition",
                    tag === t
                      ? TAG_TONE[t]
                      : "border-edge bg-surface-alt text-fg-secondary hover:text-fg",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScanBody({ record }: { record: ScanDiagnostics }) {
  const { input, result } = record;
  const conf: MinAvgMax = result.pose.confidence;
  return (
    <div className="space-y-2">
      <Section title="Input">
        <Stat label="resolution" value={`${input.video.width}×${input.video.height}`} />
        <Stat label="source / mode" value={`${input.video.source} · ${input.captureMode}`} />
        <Stat label="coverage avg" value={pct(input.climberFrameCoverage.avg)} />
        <Stat label="motion" value={fmt(input.motionMagnitude, 4)} />
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-fg-muted">flags</span>
          <Flags flags={input.referenceFrame.flags} />
        </div>
      </Section>
      <Section title="Pose">
        <Stat label="detect rate" value={`${pct(result.pose.detectionRate)} (${result.pose.detectedFrames}/${result.pose.sampledFrames})`} />
        <Stat label="kept / good" value={`${result.pose.keptFrames} / ${result.pose.goodFrames}`} />
        <Stat label="flipped" value={String(result.pose.flippedFrames)} />
        <Stat label="confidence" value={`${fmt(conf.min)}–${fmt(conf.max)} (avg ${fmt(conf.avg)})`} />
        <Stat label="refinement" value={`${result.pose.refinement.gapsRefined} gaps · ${result.pose.refinement.recoveryFramesUsed} frames`} />
      </Section>
      <Section title="ORB">
        <Stat label="ref keypoints" value={String(result.orb.refKeypointCount)} />
        {result.orb.keyframeCount > 0 && (
          <Stat label="keyframes" value={`${result.orb.keyframeCount} (kp avg ${fmt(result.orb.keyframeKeypoints.avg)})`} />
        )}
      </Section>
      {result.badStretches.length > 0 && (
        <Section title={`Bad stretches (${result.badStretches.length})`}>
          {result.badStretches.map((s, i) => (
            <Stat key={i} label={`${fmt(s.startTs)}s–${fmt(s.endTs)}s`} value={`${s.frames.length} frames`} />
          ))}
        </Section>
      )}
    </div>
  );
}

function MatchBody({ record }: { record: MatchDiagnostics }) {
  const { input, result } = record;
  const ratio =
    typeof result.inlierRatio === "number"
      ? pct(result.inlierRatio)
      : `${pct(result.inlierRatio.min)}–${pct(result.inlierRatio.max)} (avg ${pct(result.inlierRatio.avg)})`;
  return (
    <div className="space-y-2">
      <Section title="Result">
        <Stat label="capture mode" value={result.captureMode} />
        <Stat label="homography" value={result.homographyFound ? "found" : `none · ${result.failureReason}`} />
        <Stat label="matches / inliers" value={`${result.matchCount} / ${result.inlierCount}`} />
        <Stat label="inlier ratio" value={ratio} />
        {result.keyframesMatched != null && (
          <Stat label="keyframes matched" value={String(result.keyframesMatched)} />
        )}
      </Section>
      <Section title="Query">
        <Stat label="resolution" value={`${input.query.width}×${input.query.height}`} />
        <Stat label="keypoints" value={String(input.query.queryKeypointCount)} />
        <Stat label="downscale" value={fmt(input.query.downscaleApplied, 3)} />
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-fg-muted">flags</span>
          <Flags flags={input.query.flags} />
        </div>
      </Section>
      <Section title="Reference">
        {input.reference ? (
          <>
            <Stat label="resolution" value={`${input.reference.width}×${input.reference.height}`} />
            <Stat label="keypoints" value={String(input.reference.refKeypointCount)} />
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-fg-muted">flags</span>
              <Flags flags={input.reference.flags} />
            </div>
          </>
        ) : (
          <p className="text-fg-muted">no reference metadata (legacy run)</p>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-secondary">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
