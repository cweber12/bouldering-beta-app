"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import {
  REGIONS,
  EMPTY_HIGHLIGHT,
  type HighlightSelection,
  type HighlightSide,
  type RegionKey,
} from "@/utils/bodyRegions";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BodyPartHighlighterProps {
  selection: HighlightSelection;
  onChange: (next: HighlightSelection) => void;
  /** "sm" matches the compact toolbar height. */
  size?: "sm" | "md";
}

const SIDES: { id: HighlightSide; label: string }[] = [
  { id: "both", label: "Both" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
];

// ---------------------------------------------------------------------------
// BodyPartHighlighter — focus a comparison on specific body parts.
//
// Selecting one or more regions emphasizes them (each climb keeps its identity
// colour) and dims the rest of every skeleton to gray. A side toggle narrows
// the emphasis to the left or right of the body. No colour pickers — this is a
// focus tool, not a style editor.
// ---------------------------------------------------------------------------

export default function BodyPartHighlighter({
  selection,
  onChange,
  size = "sm",
}: BodyPartHighlighterProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const active = selection.regions.length > 0;

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function toggleRegion(key: RegionKey) {
    const has = selection.regions.includes(key);
    const regions = has
      ? selection.regions.filter((r) => r !== key)
      : [...selection.regions, key];
    onChange({ ...selection, regions });
  }

  function setSide(side: HighlightSide) {
    onChange({ ...selection, side });
  }

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "flex items-center gap-1.5 rounded-lg border font-medium transition-all duration-200",
          size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
          active
            ? "border-accent/60 bg-accent/10 text-accent"
            : "border-edge/50 bg-card/60 text-fg-muted hover:border-edge-hover hover:text-fg",
        )}
      >
        {/* Target / focus icon */}
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" />
          <path strokeLinecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
        Highlight
        {active && (
          <span className="rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold text-accent">
            {selection.regions.length}
          </span>
        )}
        <svg className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Highlight body parts"
          className="ui-popover absolute left-0 top-full z-30 mt-1 w-64 p-3"
        >
          <p className="mb-2 text-xs text-fg-muted">
            Emphasize body parts to compare a move. The rest dims; each climb keeps its colour.
          </p>

          {/* Region toggles */}
          <div className="grid grid-cols-3 gap-1.5">
            {REGIONS.map((r) => {
              const on = selection.regions.includes(r.key);
              return (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleRegion(r.key)}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-xs font-medium transition",
                    on
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-edge/60 bg-inset/40 text-fg-secondary hover:border-edge-hover hover:text-fg",
                  )}
                >
                  {r.label}
                </button>
              );
            })}
          </div>

          {/* Side toggle — only meaningful with a selection */}
          <div className={cn("mt-3 transition-opacity", !active && "pointer-events-none opacity-40")}>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-muted">Side</p>
            <div className="inline-flex w-full items-center rounded-lg bg-inset p-0.5" role="group" aria-label="Body side">
              {SIDES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={selection.side === s.id}
                  onClick={() => setSide(s.id)}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1 text-xs font-medium transition",
                    selection.side === s.id ? "bg-surface-alt text-fg shadow-sm" : "text-fg-muted hover:text-fg",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Clear */}
          {active && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_HIGHLIGHT)}
              className="mt-3 w-full rounded-md border border-edge/60 px-2 py-1.5 text-xs text-fg-secondary transition hover:border-edge-hover hover:text-fg"
            >
              Clear highlight
            </button>
          )}
        </div>
      )}
    </div>
  );
}
