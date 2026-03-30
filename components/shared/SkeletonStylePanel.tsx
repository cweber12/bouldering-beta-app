"use client";

import { useEffect, useRef, useState } from "react";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";

// ---------------------------------------------------------------------------
// Joint / limb group definitions (MediaPipe 33-keypoint topology)
// ---------------------------------------------------------------------------

/** Keypoints that belong to the head group (no bilateral pairing). */
const HEAD_KPS = [
  "nose", "left_eye_inner", "left_eye", "left_eye_outer",
  "right_eye_inner", "right_eye", "right_eye_outer",
  "left_ear", "right_ear", "mouth_left", "mouth_right",
];

interface BilateralGroup {
  key: string;
  label: string;
  left: string[];
  right: string[];
}

const BILATERAL_GROUPS: BilateralGroup[] = [
  { key: "shoulders", label: "Shoulders", left: ["left_shoulder"], right: ["right_shoulder"] },
  { key: "elbows",    label: "Elbows",    left: ["left_elbow"],    right: ["right_elbow"] },
  { key: "hands",     label: "Hands",     left: ["left_wrist","left_pinky","left_index","left_thumb"], right: ["right_wrist","right_pinky","right_index","right_thumb"] },
  { key: "hips",      label: "Hips",      left: ["left_hip"],      right: ["right_hip"] },
  { key: "knees",     label: "Knees",     left: ["left_knee"],     right: ["right_knee"] },
  { key: "ankles",    label: "Ankles",    left: ["left_ankle"],    right: ["right_ankle"] },
  { key: "feet",      label: "Feet",      left: ["left_heel","left_foot_index"], right: ["right_heel","right_foot_index"] },
];

interface EdgeGroup {
  key: string;
  label: string;
  edges: [number, number][];
}

const EDGE_GROUPS: EdgeGroup[] = [
  { key: "arms",      label: "Arms",             edges: [[11,13],[13,15],[12,14],[14,16]] },
  { key: "handConns", label: "Hand connections",  edges: [[15,17],[15,19],[15,21],[17,19],[16,18],[16,20],[16,22],[18,20]] },
  { key: "torso",     label: "Torso",             edges: [[11,12],[11,23],[12,24],[23,24]] },
  { key: "legs",      label: "Legs",              edges: [[23,25],[25,27],[24,26],[26,28]] },
  { key: "footConns", label: "Foot connections",  edges: [[27,29],[27,31],[29,31],[28,30],[28,32],[30,32]] },
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Darken a #rrggbb hex color by `factor` (0–1). */
function darkenHex(hex: string, factor = 0.15): string {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length !== 6) return hex;
  const r = Math.round(parseInt(h.slice(0, 2), 16) * (1 - factor));
  const g = Math.round(parseInt(h.slice(2, 4), 16) * (1 - factor));
  const b = Math.round(parseInt(h.slice(4, 6), 16) * (1 - factor));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Best-effort hex extraction from a CSS color string (rgba / hex). */
function cssToHex(css: string): string {
  const hex = css.trim();
  if (hex.startsWith("#")) return hex.slice(0, 7);
  // Try rgba(r,g,b,a) → #rrggbb
  const m = hex.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return `#${Number(m[1]).toString(16).padStart(2, "0")}${Number(m[2]).toString(16).padStart(2, "0")}${Number(m[3]).toString(16).padStart(2, "0")}`;
  }
  return "#ffffff";
}

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

interface JointGroupCfg { color: string; radius: number; }
interface LimbGroupCfg  { color: string; width: number; }

const DEFAULT_JOINT_HEX = "#ffdc00";
const DEFAULT_LIMB_HEX  = "#00dc78";
const DEFAULT_RADIUS    = 5;
const DEFAULT_WIDTH     = 2.5;

// ---------------------------------------------------------------------------
// Style builder
// ---------------------------------------------------------------------------

function buildStyle(
  lineWidth:        number,
  pointRadius:      number,
  useGroups:        boolean,
  headCfg:          JointGroupCfg,
  jointGroups:      Record<string, JointGroupCfg>,
  limbGroups:       Record<string, LimbGroupCfg>,
): SkeletonStyle {
  if (!useGroups) {
    return { lineWidth, pointRadius };
  }

  const jointColorOverrides: Record<string, string> = {};
  const jointRadiusOverrides: Record<string, number> = {};
  const edgeColorMap:  Record<string, string> = {};
  const edgeWidthMap:  Record<string, number> = {};

  // Head (no bilateral split)
  for (const kp of HEAD_KPS) {
    jointColorOverrides[kp]  = headCfg.color;
    jointRadiusOverrides[kp] = headCfg.radius;
  }

  // Bilateral groups
  for (const grp of BILATERAL_GROUPS) {
    const cfg = jointGroups[grp.key];
    if (!cfg) continue;
    const rightColor = darkenHex(cfg.color);
    for (const kp of grp.left)  { jointColorOverrides[kp] = cfg.color;   jointRadiusOverrides[kp] = cfg.radius; }
    for (const kp of grp.right) { jointColorOverrides[kp] = rightColor;  jointRadiusOverrides[kp] = cfg.radius; }
  }

  // Edge groups
  for (const grp of EDGE_GROUPS) {
    const cfg = limbGroups[grp.key];
    if (!cfg) continue;
    for (const [f, t] of grp.edges) {
      edgeColorMap[`${f}-${t}`] = cfg.color;
      edgeWidthMap[`${f}-${t}`] = cfg.width;
    }
  }

  return { lineWidth, pointRadius, jointColorOverrides, jointRadiusOverrides, edgeColorMap, edgeWidthMap };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SkeletonStylePanelProps {
  /** Called whenever any style setting changes. The returned SkeletonStyle does
   *  NOT include skeletonEdges / keypointNames — the caller must merge those. */
  onChange: (style: SkeletonStyle) => void;
  /** Label for the trigger button. Defaults to "Style ▾". */
  label?: string;
  className?: string;
}

/**
 * Compact "Style ▾" dropdown that exposes skeleton color / size controls.
 *
 * Global controls (line width, point radius) are always visible.
 * Optional per-group overrides are unlocked via a toggle.
 *
 * Right-side joints are automatically darkened 15 % relative to the chosen
 * group color to subtly distinguish left from right.
 */
export default function SkeletonStylePanel({
  onChange,
  label = "Style ▾",
  className = "",
}: SkeletonStylePanelProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Global
  const [lineWidth,    setLineWidth]    = useState(DEFAULT_WIDTH);
  const [pointRadius,  setPointRadius]  = useState(DEFAULT_RADIUS);
  const [useGroups,    setUseGroups]    = useState(false);

  // Head joint group
  const [headCfg, setHeadCfg] = useState<JointGroupCfg>({ color: DEFAULT_JOINT_HEX, radius: DEFAULT_RADIUS });

  // Bilateral joint groups
  const [jointGroups, setJointGroups] = useState<Record<string, JointGroupCfg>>(() =>
    Object.fromEntries(BILATERAL_GROUPS.map(g => [g.key, { color: DEFAULT_JOINT_HEX, radius: DEFAULT_RADIUS }])),
  );

  // Limb edge groups
  const [limbGroups, setLimbGroups] = useState<Record<string, LimbGroupCfg>>(() =>
    Object.fromEntries(EDGE_GROUPS.map(g => [g.key, { color: DEFAULT_LIMB_HEX, width: DEFAULT_WIDTH }])),
  );

  // Stable ref for onChange to avoid re-emitting on every parent render.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  // Emit updated style whenever any setting changes.
  useEffect(() => {
    onChangeRef.current(buildStyle(lineWidth, pointRadius, useGroups, headCfg, jointGroups, limbGroups));
  }, [lineWidth, pointRadius, useGroups, headCfg, jointGroups, limbGroups]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function updateJointGroup(key: string, patch: Partial<JointGroupCfg>) {
    setJointGroups(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function updateLimbGroup(key: string, patch: Partial<LimbGroupCfg>) {
    setLimbGroups(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  return (
    <div ref={panelRef} className={`relative ${className}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="rounded-lg border border-edge bg-card px-4 py-2 text-sm font-medium text-fg-muted transition hover:border-edge-hover hover:text-fg-light"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Skeleton style options"
          className="absolute left-0 top-full z-30 mt-1 w-72 overflow-y-auto max-h-[80vh] rounded-lg border border-edge bg-card p-3 shadow-xl flex flex-col gap-3"
        >
          {/* Global controls */}
          <p className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">Global</p>
          <label className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs text-fg-secondary">
              <span>Line width</span>
              <span className="tabular-nums text-fg-light">{lineWidth.toFixed(1)} px</span>
            </div>
            <input type="range" min="0.5" max="8" step="0.5" value={lineWidth}
              onChange={e => setLineWidth(parseFloat(e.target.value))}
              className="w-full accent-accent" />
          </label>
          <label className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs text-fg-secondary">
              <span>Point radius</span>
              <span className="tabular-nums text-fg-light">{pointRadius} px</span>
            </div>
            <input type="range" min="1" max="12" step="1" value={pointRadius}
              onChange={e => setPointRadius(parseInt(e.target.value, 10))}
              className="w-full accent-accent" />
          </label>

          {/* Per-group toggle */}
          <label className="flex items-center gap-2 text-xs text-fg-secondary cursor-pointer select-none">
            <input type="checkbox" checked={useGroups} onChange={e => setUseGroups(e.target.checked)}
              className="accent-accent rounded" />
            Per-group colors &amp; sizes
          </label>

          {useGroups && (
            <>
              <hr className="border-edge" />
              {/* Joint groups */}
              <p className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">Joints</p>
              <p className="text-xs text-fg-muted -mt-2">Right side auto-darkens 15 %.</p>

              {/* Head (no sides) */}
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-fg-secondary">Head</span>
                <input type="color" value={cssToHex(headCfg.color)}
                  onChange={e => setHeadCfg(c => ({ ...c, color: e.target.value }))}
                  className="h-6 w-10 cursor-pointer rounded border border-edge bg-inset p-0.5" />
                <input type="range" min="1" max="12" step="1" value={headCfg.radius}
                  onChange={e => setHeadCfg(c => ({ ...c, radius: parseInt(e.target.value, 10) }))}
                  className="flex-1 accent-accent" title={`Radius: ${headCfg.radius}px`} />
                <span className="w-6 text-right tabular-nums text-xs text-fg-muted">{headCfg.radius}</span>
              </div>

              {BILATERAL_GROUPS.map(grp => {
                const cfg = jointGroups[grp.key];
                return (
                  <div key={grp.key} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs text-fg-secondary">{grp.label}</span>
                    <input type="color" value={cssToHex(cfg.color)}
                      onChange={e => updateJointGroup(grp.key, { color: e.target.value })}
                      className="h-6 w-10 cursor-pointer rounded border border-edge bg-inset p-0.5"
                      title={`Left: ${cssToHex(cfg.color)}  Right: ${darkenHex(cssToHex(cfg.color))}`} />
                    <input type="range" min="1" max="12" step="1" value={cfg.radius}
                      onChange={e => updateJointGroup(grp.key, { radius: parseInt(e.target.value, 10) })}
                      className="flex-1 accent-accent" title={`Radius: ${cfg.radius}px`} />
                    <span className="w-6 text-right tabular-nums text-xs text-fg-muted">{cfg.radius}</span>
                  </div>
                );
              })}

              <hr className="border-edge" />
              {/* Limb groups */}
              <p className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">Limbs</p>
              {EDGE_GROUPS.map(grp => {
                const cfg = limbGroups[grp.key];
                return (
                  <div key={grp.key} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-xs text-fg-secondary">{grp.label}</span>
                    <input type="color" value={cssToHex(cfg.color)}
                      onChange={e => updateLimbGroup(grp.key, { color: e.target.value })}
                      className="h-6 w-10 cursor-pointer rounded border border-edge bg-inset p-0.5" />
                    <input type="range" min="0.5" max="8" step="0.5" value={cfg.width}
                      onChange={e => updateLimbGroup(grp.key, { width: parseFloat(e.target.value) })}
                      className="flex-1 accent-accent" title={`Width: ${cfg.width}px`} />
                    <span className="w-6 text-right tabular-nums text-xs text-fg-muted">{cfg.width}</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
