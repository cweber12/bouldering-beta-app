"use client";

import { cn } from "@/utils/cn";
import PreviewSidebar from "@/components/scan/controls/PreviewSidebar";
import type { HoldEntry } from "@/hooks/useScanHolds";

/** Ring-swatch class echoing the wall marker colour for a limb kind (ADR 0012). */
const KIND_RING: Record<"hand" | "foot", string> = {
  hand: "border-hand-hold",
  foot: "border-foot-hold",
};

export interface HoldsEditorProps {
  /** Whether the drawer is open (controlled by the parent step). */
  open: boolean;
  /** Close the drawer. */
  onClose: () => void;
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
 * Scan-stage **Holds** editor (Fixed Capture only, ADR 0009). A right-edge
 * drawer for the Detection Preview: the User scrubs to the frame where a limb is
 * on the hold, picks the extremity to snap a new Hold to that limb's contact
 * point, and removes Holds from the numbered list. Numbering is always re-derived
 * from first-use order, so adding or removing renumbers the rest automatically.
 */
export default function HoldsEditor({ open, onClose, entries, onAdd, onRemove }: HoldsEditorProps) {
  return (
    <PreviewSidebar open={open} onClose={onClose} title="Holds">
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
              <span className={cn("h-4 w-4 shrink-0 rounded-full border-2", KIND_RING[kind])} aria-hidden="true" />
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
          <ul className="mt-1.5 flex flex-col gap-1">
            {entries.map((entry) => (
              <li
                key={`${entry.hold.kind}-${entry.hold.firstUseTime}-${entry.hold.x}-${entry.hold.y}`}
                className="flex items-center gap-2 text-xs text-fg-secondary"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-inset text-[10px] font-bold text-fg-secondary">
                  {entry.order}
                </span>
                <span
                  className={cn("h-4 w-4 shrink-0 rounded-full border-2", KIND_RING[entry.hold.kind])}
                  aria-hidden="true"
                />
                <span className="flex-1 capitalize">
                  {entry.hold.side ? `${entry.hold.side} ` : ""}
                  {entry.hold.kind}
                </span>
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
    </PreviewSidebar>
  );
}
