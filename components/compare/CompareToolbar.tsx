"use client";

import { cn } from "@/utils/cn";
import BodyPartHighlighter from "@/components/compare/BodyPartHighlighter";
import type { HighlightSelection } from "@/utils/bodyRegions";

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
}: CompareToolbarProps) {
  return (
    <div className="shrink-0 flex items-center gap-2 flex-wrap border-b border-edge/30 px-3 py-2">
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

      {/* Play all — side-by-side only (overlay shares one synced player) */}
      {viewMode === "sidebyside" && (
        <button
          type="button"
          onClick={onTogglePlayAll}
          className="ui-control flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
          aria-label={masterPlaying ? "Pause all" : "Play all"}
        >
          {masterPlaying ? (
            <><svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>Pause all</>
          ) : (
            <><svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>Play all</>
          )}
        </button>
      )}

      {/* Body-part highlighter — focus the comparison on specific parts */}
      <BodyPartHighlighter selection={highlight} onChange={onHighlightChange} size="sm" />

      {/* Refine disclosure */}
      <button
        type="button"
        onClick={onToggleRefine}
        aria-expanded={refineOpen}
        className={cn(
          "ui-control flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
          refineOpen ? "border-accent/60 bg-accent/10 text-accent" : "",
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
