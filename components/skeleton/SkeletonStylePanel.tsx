"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SkeletonStyle } from "@/pipeline/overlay/skeletonOverlay";
import { type HoldStyle } from "@/pipeline/holds/holdsOverlay";
import { cn } from "@/utils/cn";
import PreviewSidebar from "@/components/scan/controls/PreviewSidebar";

// ---------------------------------------------------------------------------
// Defaults — mirror the built-in defaults in pipeline/skeletonOverlay.ts.
// All thickness/size values are unitless multipliers of body scale; the sliders
// expose them without a numeric readout (pixels are meaningless once sizes
// scale with the climber).
// ---------------------------------------------------------------------------

/** Anatomical palette base (torso/head). */
const DEFAULT_SILHOUETTE_COLOR = "#d6fb61";
/** Kept in sync with pipeline defaults; anatomical mode computes per-limb gradients. */
const DEFAULT_LINE_COLOR = "#d6fb61";
/** Kept in sync with pipeline defaults; anatomical mode computes per-joint colours. */
const DEFAULT_JOINT_COLOR = "#d6fb61";
const DEFAULT_SILHOUETTE_OPACITY = 0.25;
const DEFAULT_LIMB_THICKNESS = 0.18;
const DEFAULT_LINE_THICKNESS = 0.015;
const DEFAULT_JOINT_RADIUS = 0.09;

/** Holds legend — kind is shown by ring colour (cyan hand / orange foot), so the
 *  legend echoes the wall marker with a small colour ring (ADR 0012). */
const HOLD_LEGEND: { kind: "hand" | "foot"; label: string; ring: string }[] = [
  { kind: "hand", label: "Hands", ring: "border-hand-hold" },
  { kind: "foot", label: "Feet", ring: "border-foot-hold" },
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
  /** Whether the drawer is open (controlled by the parent step). */
  open: boolean;
  /** Close the drawer. */
  onClose: () => void;
  /** Called whenever any style setting changes. */
  onChange: (style: SkeletonStyle) => void;
  /**
   * Called whenever any Holds setting changes. When supplied, the panel shows a
   * fourth **Holds** row (visibility + Hand/Foot colours); when omitted, the
   * Holds row is hidden (e.g. surfaces with no Route Overlay).
   */
  onHoldsChange?: (style: HoldStyle) => void;
  /**
   * Contrast-boost control (opt-in, off by default). When a backdrop is
   * available (`contrastAvailable`) the panel shows a "Boost contrast" toggle;
   * when the wall is detected to give the palette poor contrast
   * (`contrastPoor`) it surfaces a one-click prompt to switch it on. The parent
   * owns the state and only threads a `contrastAdjust` into the styles while
   * `contrastEnabled` is true.
   */
  contrastEnabled?: boolean;
  onContrastToggle?: (on: boolean) => void;
  contrastPoor?: boolean;
  contrastAvailable?: boolean;
  /** Drawer heading. Defaults to "Climber". */
  label?: string;
  /** Optional content rendered at the bottom of the open panel, under a divider.
   *  Kept generic (the panel itself stays decoupled from app-level concerns) —
   *  the scan flow passes its Developer-view toggle here. */
  footer?: ReactNode;
}

/**
 * Right-edge drawer exposing the **Climber** overlay controls in three rows:
 *
 * 1. **Silhouette** — visibility, colour, thickness, opacity.
 * 2. **Lines** — visibility, colour, thickness (the thin Skeleton lines).
 * 3. **Joints** — visibility, colour, size (the joint points).
 *
 * The three colours default to a graded accent green — silhouette base, brighter
 * lines, lighter joints; sliders are unitless multipliers of body scale (the
 * overlay sizes itself to the climber, so pixels would be meaningless).
 *
 * The component stays mounted while its parent step is, so the slider state
 * survives a close even though the drawer markup only renders while `open`.
 */
export default function SkeletonStylePanel({
  open,
  onClose,
  onChange,
  onHoldsChange,
  contrastEnabled = false,
  onContrastToggle,
  contrastPoor = false,
  contrastAvailable = false,
  label = "Climber",
  footer,
}: SkeletonStylePanelProps) {
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

  // Emit the Holds style whenever any Holds setting changes. The marker look is
  // fixed (colour-coded rings, see HOLD_RING_COLOR), so only visibility is
  // user-controlled here.
  useEffect(() => {
    onHoldsChangeRef.current?.({ holdsVisible });
  }, [holdsVisible]);

  return (
    <PreviewSidebar open={open} onClose={onClose} title={label}>
          {/* ── Contrast boost — opt-in (off by default). When the wall gives the
              palette poor contrast, a one-click prompt is surfaced; otherwise a
              plain toggle. Gates backdrop adaptation for the whole overlay. ── */}
          {contrastAvailable && (
            <div className="flex flex-col gap-1.5">
              {contrastPoor && !contrastEnabled ? (
                <button
                  type="button"
                  onClick={() => onContrastToggle?.(true)}
                  className="flex items-center gap-2 rounded-md border border-caution-border bg-caution-surface px-2.5 py-1.5 text-xs font-medium text-caution transition hover:brightness-110 text-left"
                >
                  <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  Low contrast on this wall — boost it
                </button>
              ) : (
                <label className="flex items-center gap-2 text-xs font-medium text-fg-secondary cursor-pointer select-none">
                  <input type="checkbox" checked={contrastEnabled}
                    onChange={e => onContrastToggle?.(e.target.checked)}
                    className="accent-accent rounded" />
                  Boost contrast for the wall
                </label>
              )}
            </div>
          )}

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
                {HOLD_LEGEND.map(({ label, ring }) => (
                  <span key={label} className="flex items-center gap-1.5 text-xs text-fg-muted select-none">
                    <span className={cn("h-3.5 w-3.5 shrink-0 rounded-full border-2", ring)} aria-hidden="true" />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {footer && (
            <div className="border-t border-edge/60 pt-3">{footer}</div>
          )}
    </PreviewSidebar>
  );
}
