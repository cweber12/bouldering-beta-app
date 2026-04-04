"use client";

import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lightweight metadata extracted from a downloaded run JSON. */
export interface RunMeta {
  rating?: string;
  duration?: number;
  notes?: string;
  runType: string;
  /** Timestamp parsed from filename for analysis graph. */
  timestamp: number;
  /** Scaled-down PNG data URL with ORB keypoints drawn. */
  thumbnail?: string;
}

type AnalysisTab = "day" | "week" | "month" | "all";

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const ANALYSIS_TABS: AnalysisTab[] = ["day", "week", "month", "all"];
const TAB_MS: Record<AnalysisTab, number> = {
  day:   24 * 60 * 60 * 1000,
  week:  7  * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  all:   Infinity,
};

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RouteAnalysisGraph({
  runMeta,
}: {
  runMeta: Map<string, RunMeta>;
}) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [activeTab, setActiveTab] = useState<AnalysisTab>("all");
  const [cutoff, setCutoff] = useState(0);

  const handleTabChange = useCallback((tab: AnalysisTab) => {
    setActiveTab(tab);
    setCutoff(TAB_MS[tab] === Infinity ? 0 : Date.now() - TAB_MS[tab]);
  }, []);

  const points = useMemo(() => {
    const pts: Array<{ ts: number; duration: number; isSend: boolean }> = [];
    for (const m of runMeta.values()) {
      if (m.timestamp > 0 && m.duration != null && m.timestamp >= cutoff) {
        pts.push({ ts: m.timestamp, duration: m.duration, isSend: m.runType === "send" });
      }
    }
    pts.sort((a, b) => a.ts - b.ts);
    return pts;
  }, [runMeta, cutoff]);

  if (runMeta.size === 0) return null;

  const W = 400;
  const H = 180;
  const PAD = { top: 16, right: 16, bottom: 32, left: 48 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const minTs = points.length ? points[0].ts : 0;
  const maxTs = points.length ? points[points.length - 1].ts : 1;
  const maxDur = points.length ? Math.max(...points.map(p => p.duration), 1) : 1;
  const rangeTs = maxTs - minTs || 1;

  function x(ts: number) { return PAD.left + ((ts - minTs) / rangeTs) * plotW; }
  function y(dur: number) { return PAD.top + plotH - (dur / maxDur) * plotH; }

  const xTicks = points.length <= 4
    ? points.map(p => p.ts)
    : Array.from({ length: 4 }, (_, i) => minTs + (rangeTs * i) / 3);

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setShowAnalysis(!showAnalysis)}
        className="flex items-center gap-1.5 self-start rounded-lg border border-edge px-3 py-1.5 text-xs text-fg-secondary transition hover:border-edge-hover hover:text-fg"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
        Analysis
        <svg className={`h-3 w-3 transition ${showAnalysis ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {showAnalysis && (
        <div className="rounded-lg border border-edge bg-card p-3 flex flex-col gap-2">
          {/* Tabs */}
          <div className="flex gap-1">
            {ANALYSIS_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={[
                  "rounded px-2.5 py-1 text-xs font-medium capitalize transition",
                  activeTab === tab
                    ? "bg-inset text-fg"
                    : "text-fg-muted hover:text-fg",
                ].join(" ")}
              >
                {tab}
              </button>
            ))}
          </div>

          {points.length === 0 ? (
            <p className="text-xs text-fg-muted py-4 text-center">No runs with duration data in this range.</p>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map(f => {
                const yPos = PAD.top + plotH - f * plotH;
                return (
                  <g key={`grid-${f}`}>
                    <line x1={PAD.left} y1={yPos} x2={PAD.left + plotW} y2={yPos} stroke="var(--color-edge)" strokeWidth="0.5" />
                    <text x={PAD.left - 6} y={yPos + 3} textAnchor="end" className="fill-fg-muted" fontSize="9">
                      {formatDuration(maxDur * f)}
                    </text>
                  </g>
                );
              })}

              {/* X-axis ticks */}
              {xTicks.map((ts, i) => {
                const xPos = x(ts);
                return (
                  <text key={`xt-${i}`} x={xPos} y={H - 6} textAnchor="middle" className="fill-fg-muted" fontSize="8">
                    {new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </text>
                );
              })}

              {/* Connecting line */}
              {points.length > 1 && (
                <polyline
                  fill="none"
                  stroke="var(--color-fg-secondary)"
                  strokeWidth="1"
                  strokeLinejoin="round"
                  points={points.map(p => `${x(p.ts)},${y(p.duration)}`).join(" ")}
                />
              )}

              {/* Data points */}
              {points.map((p, i) => (
                <circle
                  key={i}
                  cx={x(p.ts)}
                  cy={y(p.duration)}
                  r="4"
                  style={{ fill: p.isSend ? "var(--color-send)" : "var(--color-attempt)" }}
                >
                  <title>{new Date(p.ts).toLocaleString()} — {formatDuration(p.duration)}</title>
                </circle>
              ))}

              {/* Y-axis label */}
              <text x="10" y={PAD.top + plotH / 2} textAnchor="middle" transform={`rotate(-90, 10, ${PAD.top + plotH / 2})`} className="fill-fg-muted" fontSize="9">
                Elapsed
              </text>
            </svg>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 justify-center">
            <span className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span className="inline-block h-2 w-2 rounded-full bg-attempt" /> Attempt
            </span>
            <span className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span className="inline-block h-2 w-2 rounded-full bg-send" /> Send
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
