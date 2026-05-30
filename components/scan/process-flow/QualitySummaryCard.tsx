"use client";

import { cn } from "@/utils/cn";

export interface QualitySummaryCardProps {
  score: number;
  status: "pass" | "warn";
  summary: string;
  poseFrames: number;
  orbPoints: number;
  frameStep: number;
  showDetails: boolean;
  onToggleDetails: () => void;
}

export default function QualitySummaryCard({
  score,
  status,
  summary,
  poseFrames,
  orbPoints,
  frameStep,
  showDetails,
  onToggleDetails,
}: QualitySummaryCardProps) {
  const isPass = status === "pass";

  return (
    <section
      className={cn(
        "rounded-2xl border px-4 py-3",
        isPass
          ? "border-send/35 bg-send-surface/70"
          : "border-caution-border bg-caution-surface",
      )}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-edge/40 bg-surface-alt/70">
          <span className="text-sm font-semibold text-fg">{score}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("text-xs font-semibold uppercase tracking-wide", isPass ? "text-send" : "text-caution")}>
            {isPass ? "Quality Check: Good" : "Quality Check: Needs Attention"}
          </p>
          <p className="mt-1 text-sm text-fg-secondary">{summary}</p>
        </div>
      </div>

      <div className="mt-3 border-t border-edge/35 pt-2.5">
        <button
          type="button"
          onClick={onToggleDetails}
          className="flex w-full items-center justify-start rounded-lg px-1.5 py-1 text-xs font-medium text-fg-secondary transition hover:text-fg"
          aria-expanded={showDetails}
        >
          {showDetails ? "Hide advanced metrics" : "Show advanced metrics"}
        </button>

        {showDetails && (
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-edge/35 bg-surface-alt/60 px-2 py-2">
              <p className="text-sm font-semibold text-fg">{poseFrames}</p>
              <p className="text-[11px] text-fg-muted">pose frames</p>
            </div>
            <div className="rounded-lg border border-edge/35 bg-surface-alt/60 px-2 py-2">
              <p className="text-sm font-semibold text-fg">{orbPoints}</p>
              <p className="text-[11px] text-fg-muted">ORB points</p>
            </div>
            <div className="rounded-lg border border-edge/35 bg-surface-alt/60 px-2 py-2">
              <p className="text-sm font-semibold text-fg">{frameStep}</p>
              <p className="text-[11px] text-fg-muted">frame step</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}