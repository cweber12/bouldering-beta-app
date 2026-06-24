"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";
import { type HoldStyle } from "@/pipeline/holdsOverlay";
import HoldGlyphIcon from "@/components/skeleton/HoldGlyphIcon";
import { cn } from "@/utils/cn";
import { useClickOutside } from "@/hooks/useClickOutside";
import ToolbarButton from "@/components/scan/controls/ToolbarButton";

// ---------------------------------------------------------------------------
// Defaults — mirror the built-in defaults in pipeline/skeletonOverlay.ts.
// All thickness/size values are unitless multipliers of body scale; the sliders
// expose them without a numeric readout (pixels are meaningless once sizes
// scale with the climber).
// ---------------------------------------------------------------------------

/** Silhouette base — the theme accent green. */
const DEFAULT_SILHOUETTE_COLOR = "#b3e609";
/** Skeleton lines — a brighter variation of the accent (accent +0.14 lightness). */
const DEFAULT_LINE_COLOR = "#cdf73f";
/** Joint points — lighter still than the lines (accent +0.26 lightness). */
const DEFAULT_JOINT_COLOR = "#dcfa7a";
const DEFAULT_SILHOUETTE_OPACITY = 0.25;
const DEFAULT_LIMB_THICKNESS = 0.18;
const DEFAULT_LINE_THICKNESS = 0.015;
const DEFAULT_JOINT_RADIUS = 0.09;

/** Holds legend — glyphs are a single colour, differentiated by shape (hand vs
 *  foot) and orientation (mirror = side), so the legend shows the shapes. */
const HOLD_LEGEND: { kind: "hand" | "foot"; label: string }[] = [
  { kind: "hand", label: "Hands" },
  { kind: "foot", label: "Feet" },
];

/** Best-effort hex extraction from a CSS color string (rgba / hex). */
function cssToHex(css: string): string {
  const hex = css.trim();
  if (hex.startsWith("#")) return hex.slice(0, 7);
  const m = hex.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return `#${Number(m[1]).toString(16).padStart(2, "0")}${Number(m[2]).toString(16).padStart(2, "0")}${Number(m[3]).toString(16).padStart(2, "0")}`;
  }
  return "#ffffff";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SkeletonStylePanelProps {
  /** Called whenever any style setting changes. */
  onChange: (style: SkeletonStyle) => void;
  /**
   * Called whenever any Holds setting changes. When supplied, the panel shows a
   * fourth **Holds** row (visibility + Hand/Foot colours); when omitted, the
   * Holds row is hidden (e.g. surfaces with no Route Overlay).
   */
  onHoldsChange?: (style: HoldStyle) => void;
  /** Label for the trigger button. Defaults to "Overlay". */
  label?: string;
  className?: string;
  /** "sm" renders a compact toolbar-height button (px-3 py-1.5 text-xs). Default is "md". */
  size?: "sm" | "md";
  /** Opens the panel above the trigger — use in sticky footers where a downward
   *  panel would be clipped off-screen. */
  openUpward?: boolean;
  /** "icon" renders a plateless icon-only trigger (`.ui-icon-btn`) for the top
   *  toolbar; "default" keeps the bordered chip trigger. */
  variant?: "default" | "icon";
  /** Optional content rendered at the bottom of the open panel, under a divider.
   *  Kept generic (the panel itself stays decoupled from app-level concerns) —
   *  the scan flow passes its Developer-view toggle here. */
  footer?: ReactNode;
}

/**
 * Dropdown panel exposing the two-pass overlay controls in three rows:
 *
 * 1. **Silhouette** — visibility, colour, thickness, opacity.
 * 2. **Lines** — visibility, colour, thickness (the thin Skeleton lines).
 * 3. **Joints** — visibility, colour, size (the joint points).
 *
 * The three colours default to a graded accent green — silhouette base, brighter
 * lines, lighter joints; sliders are unitless multipliers of body scale (the
 * overlay sizes itself to the climber, so pixels would be meaningless).
 */
export default function SkeletonStylePanel({
  onChange,
  onHoldsChange,
  label = "Overlay",
  className = "",
  size = "md",
  openUpward = false,
  variant = "default",
  footer,
}: SkeletonStylePanelProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Silhouette pass ──
  const [silhouetteVisible, setSilhouetteVisible] = useState(true);
  const [silhouetteColor,   setSilhouetteColor]   = useState(DEFAULT_SILHOUETTE_COLOR);
  const [silhouetteOpacity, setSilhouetteOpacity] = useState(DEFAULT_SILHOUETTE_OPACITY);
  const [limbThickness,     setLimbThickness]     = useState(DEFAULT_LIMB_THICKNESS);

  // ── Skeleton lines ──
  const [linesVisible,  setLinesVisible]  = useState(true);
  const [lineColor,     setLineColor]     = useState(DEFAULT_LINE_COLOR);
  const [lineThickness, setLineThickness] = useState(DEFAULT_LINE_THICKNESS);

  // ── Joints ──
  const [jointsVisible, setJointsVisible] = useState(true);
  const [jointColor,    setJointColor]    = useState(DEFAULT_JOINT_COLOR);
  const [jointRadius,   setJointRadius]   = useState(DEFAULT_JOINT_RADIUS);

  // ── Holds pass (independent of the pose overlay) ──
  const [holdsVisible, setHoldsVisible] = useState(true);

  // Stable refs for the callbacks to avoid re-emitting on every parent render.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const onHoldsChangeRef = useRef(onHoldsChange);
  useEffect(() => { onHoldsChangeRef.current = onHoldsChange; });

  // Emit updated style whenever any setting changes.
  useEffect(() => {
    onChangeRef.current({
      silhouetteVisible, silhouetteColor, silhouetteOpacity, limbThickness,
      linesVisible, lineColor, lineThickness,
      jointsVisible, jointColor, jointRadius,
    });
  }, [
    silhouetteVisible, silhouetteColor, silhouetteOpacity, limbThickness,
    linesVisible, lineColor, lineThickness,
    jointsVisible, jointColor, jointRadius,
  ]);

  // Emit the Holds style whenever any Holds setting changes. The glyph look is
  // fixed (single-colour outline, see HOLD_GLYPH_COLOR), so only visibility is
  // user-controlled here.
  useEffect(() => {
    onHoldsChangeRef.current?.({ holdsVisible });
  }, [holdsVisible]);

  // Close when clicking outside.
  useClickOutside(panelRef, () => setOpen(false), open);

  return (
    <div ref={panelRef} className={cn("relative", className)}>
      {/* Trigger button. "icon" = plateless toolbar icon; "default" = bordered chip. */}
      {variant === "icon" ? (
        <ToolbarButton
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-haspopup="dialog"
          title={label || "Overlay"}
          label={label || "Overlay"}
          icon={
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
            </svg>
          }
        />
      ) : (
        <button
          onClick={() => setOpen(o => !o)}
          className={cn(
            "flex items-center gap-1.5 rounded-(--radius-control) border border-edge/50 bg-card/60 font-medium text-fg-muted transition-all duration-200 hover:border-edge-hover hover:text-fg",
            size === "sm"
              ? "px-3 py-1.5 text-xs"
              : "px-4 py-2 text-sm",
          )}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          {/* Adjustments icon */}
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
          {label}
          <svg
            className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Overlay options"
          className={cn(
            "absolute z-30 w-72 overflow-y-auto max-h-[80vh] rounded-(--radius-panel) border border-edge bg-card p-3 shadow-xl flex flex-col gap-3",
            openUpward ? "bottom-full mb-1" : "top-full mt-1",
            variant === "icon" ? "right-0" : "left-0",
          )}
        >
          {/* ── Silhouette ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label className="flex w-20 shrink-0 items-center gap-1.5 text-xs font-medium text-fg-secondary cursor-pointer select-none">
                <input type="checkbox" checked={silhouetteVisible}
                  onChange={e => setSilhouetteVisible(e.target.checked)}
                  className="accent-accent rounded" />
                Silhouette
              </label>
              <input type="color" value={cssToHex(silhouetteColor)}
                onChange={e => setSilhouetteColor(e.target.value)}
                className="h-6 w-8 shrink-0 cursor-pointer rounded border border-edge bg-inset p-0.5"
                title="Silhouette colour" />
              <input type="range" min="0.05" max="0.45" step="0.01" value={limbThickness}
                onChange={e => setLimbThickness(parseFloat(e.target.value))}
                className="flex-1 accent-accent" aria-label="Silhouette thickness"
                title="Silhouette thickness" />
            </div>
            <div className="flex items-center gap-2 pl-22">
              <span className="shrink-0 text-xs text-fg-muted">Opacity</span>
              <input type="range" min="0.1" max="1" step="0.05" value={silhouetteOpacity}
                onChange={e => setSilhouetteOpacity(parseFloat(e.target.value))}
                className="flex-1 accent-accent" aria-label="Silhouette opacity"
                title="Silhouette opacity" />
            </div>
          </div>

          {/* ── Lines ── */}
          <div className="flex items-center gap-2">
            <label className="flex w-20 shrink-0 items-center gap-1.5 text-xs font-medium text-fg-secondary cursor-pointer select-none">
              <input type="checkbox" checked={linesVisible}
                onChange={e => setLinesVisible(e.target.checked)}
                className="accent-accent rounded" />
              Lines
            </label>
            <input type="color" value={cssToHex(lineColor)}
              onChange={e => setLineColor(e.target.value)}
              className="h-6 w-8 shrink-0 cursor-pointer rounded border border-edge bg-inset p-0.5"
              title="Line colour" />
            <input type="range" min="0.005" max="0.06" step="0.005" value={lineThickness}
              onChange={e => setLineThickness(parseFloat(e.target.value))}
              className="flex-1 accent-accent" aria-label="Line thickness"
              title="Line thickness" />
          </div>

          {/* ── Joints ── */}
          <div className="flex items-center gap-2">
            <label className="flex w-20 shrink-0 items-center gap-1.5 text-xs font-medium text-fg-secondary cursor-pointer select-none">
              <input type="checkbox" checked={jointsVisible}
                onChange={e => setJointsVisible(e.target.checked)}
                className="accent-accent rounded" />
              Joints
            </label>
            <input type="color" value={cssToHex(jointColor)}
              onChange={e => setJointColor(e.target.value)}
              className="h-6 w-8 shrink-0 cursor-pointer rounded border border-edge bg-inset p-0.5"
              title="Joint colour" />
            <input type="range" min="0.02" max="0.25" step="0.01" value={jointRadius}
              onChange={e => setJointRadius(parseFloat(e.target.value))}
              className="flex-1 accent-accent" aria-label="Joint size"
              title="Joint size" />
          </div>

          {/* ── Holds (independent overlay pass) ── */}
          {onHoldsChange && (
            <div className="flex flex-col gap-2 border-t border-edge/60 pt-3">
              <label className="flex items-center gap-1.5 text-xs font-medium text-fg-secondary cursor-pointer select-none">
                <input type="checkbox" checked={holdsVisible}
                  onChange={e => setHoldsVisible(e.target.checked)}
                  className="accent-accent rounded" />
                Holds
              </label>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {HOLD_LEGEND.map(({ kind, label }) => (
                  <span key={label} className="flex items-center gap-1.5 text-xs text-fg-muted select-none">
                    <HoldGlyphIcon kind={kind} className="h-3.5 w-3.5 shrink-0 text-fg-secondary" />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {footer && (
            <div className="border-t border-edge/60 pt-3">{footer}</div>
          )}
        </div>
      )}
    </div>
  );
}
