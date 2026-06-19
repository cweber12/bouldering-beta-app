"use client";

import { useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { useClickOutside } from "@/hooks/useClickOutside";
import ToolbarButton from "@/components/scan/controls/ToolbarButton";
import type { HoldEntry } from "@/hooks/useScanHolds";

/** Hand / Foot Hold marker colours — mirror the tokens in holdsOverlay.ts. */
const HAND_COLOR = "#22d3ee";
const FOOT_COLOR = "#fb923c";

export interface HoldsEditorProps {
  /** Current Holds with their re-derived numbers, sorted by first use. */
  entries: HoldEntry[];
  /** Snap a new Hold to the chosen extremity at the player's current time. */
  onAdd: (kind: "hand" | "foot", side: "left" | "right") => void;
  /** Remove a Hold; the rest renumber automatically. */
  onRemove: (entry: HoldEntry) => void;
}

const ADD_LIMBS: { kind: "hand" | "foot"; side: "left" | "right"; label: string }[] = [
  { kind: "hand", side: "left", label: "L hand" },
  { kind: "hand", side: "right", label: "R hand" },
  { kind: "foot", side: "left", label: "L foot" },
  { kind: "foot", side: "right", label: "R foot" },
];

/**
 * Scan-stage **Holds** editor (Fixed Capture only, ADR 0009). A toolbar popover
 * for the Detection Preview: the User scrubs to the frame where a limb is on the
 * hold, picks the extremity to snap a new Hold to that limb's contact point, and
 * removes Holds from the numbered list. Numbering is always re-derived from
 * first-use order, so adding or removing renumbers the rest automatically.
 */
export default function HoldsEditor({ entries, onAdd, onRemove }: HoldsEditorProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useClickOutside(panelRef, () => setOpen(false), open);

  return (
    <div ref={panelRef} className="relative">
      <ToolbarButton
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Edit holds"
        label="Holds"
        icon={
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="7.5" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6M9 12h6" />
          </svg>
        }
      />

      {open && (
        <div
          role="dialog"
          aria-label="Edit holds"
          className="absolute right-0 top-full z-30 mt-1 flex w-64 flex-col gap-3 rounded-(--radius-panel) border border-edge bg-card p-3 shadow-xl"
        >
          <div>
            <p className="text-xs font-medium text-fg-secondary">Add a hold</p>
            <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">
              Scrub to where the limb is on the hold, then snap it to that limb.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {ADD_LIMBS.map(({ kind, side, label }) => (
                <button
                  key={`${side}-${kind}`}
                  type="button"
                  onClick={() => onAdd(kind, side)}
                  className="flex items-center justify-center gap-1.5 rounded-(--radius-control) border border-edge/60 bg-inset px-2 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-edge-hover hover:text-fg"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: kind === "hand" ? HAND_COLOR : FOOT_COLOR }}
                    aria-hidden="true"
                  />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-edge/60 pt-2">
            <p className="text-xs font-medium text-fg-secondary">
              Holds <span className="text-fg-muted">({entries.length})</span>
            </p>
            {entries.length === 0 ? (
              <p className="mt-1 text-[11px] text-fg-muted">No holds yet.</p>
            ) : (
              <ul className="mt-1.5 flex max-h-40 flex-col gap-1 overflow-y-auto">
                {entries.map((entry) => (
                  <li
                    key={`${entry.hold.kind}-${entry.hold.firstUseTime}-${entry.hold.x}-${entry.hold.y}`}
                    className="flex items-center gap-2 text-xs text-fg-secondary"
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-fg-inverse"
                      style={{ backgroundColor: entry.hold.kind === "hand" ? HAND_COLOR : FOOT_COLOR }}
                    >
                      {entry.order}
                    </span>
                    <span className="flex-1 capitalize">{entry.hold.kind}</span>
                    <button
                      type="button"
                      onClick={() => onRemove(entry)}
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded text-fg-muted transition",
                        "hover:bg-danger-surface hover:text-danger",
                      )}
                      aria-label={`Remove hold ${entry.order}`}
                      title="Remove"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
