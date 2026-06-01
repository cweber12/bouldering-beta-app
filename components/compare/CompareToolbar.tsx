"use client";

import { cn } from "@/utils/cn";
import BodyPartHighlighter from "@/components/compare/BodyPartHighlighter";
import type { HighlightSelection } from "@/utils/bodyRegions";
import type { ConsoleMode } from "@/utils/compareUrl";

export type ViewMode = "overlay" | "sidebyside";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CompareToolbarProps {
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
  masterPlaying: boolean;
  onTogglePlayAll: () => void;
  highlight: HighlightSelection;
  onHighlightChange: (next: HighlightSelection) => void;
  refineOpen: boolean;
  onToggleRefine: () => void;
  /**
   * Console mode. Multi-climb stage controls (view-mode, Play all) render only
   * in `multiple`; single mode leaves just the focus tools (highlight, refine).
   * The single/multiple switch itself lives in the climb rail, not here.
   */
  consoleMode?: ConsoleMode;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function OverlayIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l9 5-9 5-9-5 9-5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16l9 5 9-5" />
    </svg>
  );
}

function SideBySideIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5.5A1.5 1.5 0 015.5 4h2A1.5 1.5 0 019 5.5v13A1.5 1.5 0 017.5 20h-2A1.5 1.5 0 014 18.5v-13z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 5.5A1.5 1.5 0 0116.5 4h2A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5h-2a1.5 1.5 0 01-1.5-1.5v-13z" />
    </svg>
  );
}

const VIEW_MODES: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: "overlay", label: "Overlay", icon: <OverlayIcon /> },
  { id: "sidebyside", label: "Side by side", icon: <SideBySideIcon /> },
];

// ---------------------------------------------------------------------------
// CompareToolbar — cohesive control bar for the comparison stage.
// ---------------------------------------------------------------------------

export default function CompareToolbar({
  viewMode,
  onViewMode,
  masterPlaying,
  onTogglePlayAll,
  highlight,
  onHighlightChange,
  refineOpen,
  onToggleRefine,
  consoleMode = "multiple",
}: CompareToolbarProps) {
  const isMultiple = consoleMode === "multiple";
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Multi-climb stage controls — only meaningful when comparing 2+ climbs.
          Hidden in single mode, where there is just one climb in one player. */}
      {isMultiple && (
        <>
          {/* View-mode segmented control */}
          <div className="inline-flex items-center rounded-lg bg-inset p-0.5" role="group" aria-label="View mode">
            {VIEW_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onViewMode(m.id)}
                aria-pressed={viewMode === m.id}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  viewMode === m.id
                    ? "bg-surface-alt text-fg shadow-sm"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {m.icon}
                <span>{m.label}</span>
              </button>
            ))}
          </div>

          {/* Master play — side-by-side only (overlay shares one synced player).
              Runs every climb from its set start in sync. */}
          {viewMode === "sidebyside" && (
            <button
              type="button"
              onClick={onTogglePlayAll}
              className="flex items-center gap-1.5 rounded-lg border border-edge/50 bg-card/60 px-3 py-1.5 text-xs font-medium text-fg transition hover:border-edge-hover"
              aria-label={masterPlaying ? "Pause all climbs" : "Play all climbs"}
            >
              {masterPlaying ? (
                <><svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>Pause</>
              ) : (
                <><svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>Play all</>
              )}
            </button>
          )}

          {/* Divider between stage controls and focus tools */}
          <span className="mx-0.5 hidden h-5 w-px bg-edge/40 sm:block" aria-hidden="true" />
        </>
      )}

      {/* Body-part highlighter — focus the comparison on specific parts */}
      <BodyPartHighlighter selection={highlight} onChange={onHighlightChange} size="sm" />

      {/* Refine — secondary disclosure */}
      <button
        type="button"
        onClick={onToggleRefine}
        aria-expanded={refineOpen}
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
          refineOpen
            ? "border border-accent/60 bg-accent/10 text-accent"
            : "border border-transparent text-fg-muted hover:bg-inset/60 hover:text-fg",
        )}
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 3v12m0 0a2.25 2.25 0 100 4.5A2.25 2.25 0 006 15zm12-3V3m0 9a2.25 2.25 0 110 4.5A2.25 2.25 0 0118 12zm0 0V9" />
        </svg>
        Refine
        <svg className={cn("h-3 w-3 transition-transform", refineOpen && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  );
}
