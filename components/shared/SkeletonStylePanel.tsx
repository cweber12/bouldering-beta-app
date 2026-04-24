"use client";

import { useEffect, useRef, useState } from "react";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";
import { MP_KP_NAMES } from "@/utils/poseConstants";
import { cn } from "@/utils/cn";

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
  { key: "arms",      label: "Arms",            edges: [[11,13],[13,15],[12,14],[14,16]] },
  { key: "handConns", label: "Hand conns",       edges: [[15,17],[15,19],[15,21],[17,19],[16,18],[16,20],[16,22],[18,20]] },
  { key: "torso",     label: "Torso",            edges: [[11,12],[11,23],[12,24],[23,24]] },
  { key: "legs",      label: "Legs",             edges: [[23,25],[25,27],[24,26],[26,28]] },
  { key: "footConns", label: "Foot conns",       edges: [[27,29],[27,31],[29,31],[28,30],[28,32],[30,32]] },
];

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

interface JointGroupCfg { leftColor: string; rightColor: string; radius: number; }
interface LimbGroupCfg  { leftColor: string; rightColor: string; width: number; }

const DEFAULT_JOINT_HEX = "#ffdc00";
const DEFAULT_LIMB_HEX  = "#00dc78";
const DEFAULT_RADIUS    = 2;
const DEFAULT_WIDTH     = 2.5;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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
// Style builder
// ---------------------------------------------------------------------------

/**
 * Build a SkeletonStyle from the three-tier color hierarchy.
 *
 * Tier 1 (global)  — joint/limb color, point radius, line width.
 * Tier 2 (sides)   — explicit left / right colors (cascaded to per-group data).
 * Tier 3 (groups)  — per-group fine-tuning (bilateral joint groups + edge groups).
 *
 * When neither Tier 2 nor Tier 3 is active the output is a flat style that
 * uses only the global colors and sizes so the caller receives minimal JSON.
 * When either is active the full per-keypoint / per-edge override maps are built
 * from the (always up-to-date) per-group data.
 */
function buildStyle(
  lineWidth:        number,
  pointRadius:      number,
  globalPointColor: string,
  globalLineColor:  string,
  useSideColors:    boolean,
  useGroups:        boolean,
  headCfg:          { color: string; radius: number },
  jointGroups:      Record<string, JointGroupCfg>,
  limbGroups:       Record<string, LimbGroupCfg>,
): SkeletonStyle {
  if (!useSideColors && !useGroups) {
    return { lineWidth, pointRadius, jointColor: globalPointColor, limbColor: globalLineColor };
  }

  const jointColorOverrides: Record<string, string> = {};
  const jointRadiusOverrides: Record<string, number> = {};
  const edgeColorMap:  Record<string, string> = {};
  const edgeWidthMap:  Record<string, number> = {};

  // Head (center — no bilateral split)
  for (const kp of HEAD_KPS) {
    jointColorOverrides[kp]  = headCfg.color;
    jointRadiusOverrides[kp] = headCfg.radius;
  }

  // Bilateral joint groups
  for (const grp of BILATERAL_GROUPS) {
    const cfg = jointGroups[grp.key];
    if (!cfg) continue;
    for (const kp of grp.left)  { jointColorOverrides[kp] = cfg.leftColor;  jointRadiusOverrides[kp] = cfg.radius; }
    for (const kp of grp.right) { jointColorOverrides[kp] = cfg.rightColor; jointRadiusOverrides[kp] = cfg.radius; }
  }

  // Edge groups — an edge is "right" only when both endpoints are right-side joints
  for (const grp of EDGE_GROUPS) {
    const cfg = limbGroups[grp.key];
    if (!cfg) continue;
    for (const [f, t] of grp.edges) {
      const fromName = (MP_KP_NAMES as Record<number, string>)[f] ?? "";
      const toName   = (MP_KP_NAMES as Record<number, string>)[t] ?? "";
      const isRight = fromName.startsWith("right_") && toName.startsWith("right_");
      edgeColorMap[`${f}-${t}`] = isRight ? cfg.rightColor : cfg.leftColor;
      edgeWidthMap[`${f}-${t}`] = cfg.width;
    }
  }

  return { lineWidth, pointRadius, jointColorOverrides, jointRadiusOverrides, edgeColorMap, edgeWidthMap };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SkeletonStylePanelProps {
  /** Called whenever any style setting changes. */
  onChange: (style: SkeletonStyle) => void;
  /** Label for the trigger button. Defaults to "Style". */
  label?: string;
  className?: string;
  /** "sm" renders a compact toolbar-height button (px-3 py-1.5 text-xs). Default is "md". */
  size?: "sm" | "md";
}

/**
 * Dropdown panel that exposes skeleton color and size controls in three tiers:
 *
 * 1. **Global** — point color + radius, line color + width (always visible).
 * 2. **Left / right colors** — a quick way to colour all left-side and
 *    right-side joints/limbs differently. Cascade-overwrites per-group data.
 * 3. **Per-group fine-tuning** — individual bilateral joint groups and limb
 *    edge groups with explicit left/right color swatches.
 *
 * Changing a higher-tier color cascades down: global overwrites both sides,
 * each side overwrites all matching per-group entries.
 */
export default function SkeletonStylePanel({
  onChange,
  label = "Style",
  className = "",
  size = "md",
}: SkeletonStylePanelProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Tier 1: global size + color ──────────────────────────────────────────
  const [lineWidth,        setLineWidth]        = useState(DEFAULT_WIDTH);
  const [pointRadius,      setPointRadius]      = useState(DEFAULT_RADIUS);
  const [globalPointColor, setGlobalPointColor] = useState(DEFAULT_JOINT_HEX);
  const [globalLineColor,  setGlobalLineColor]  = useState(DEFAULT_LIMB_HEX);

  // ── Tier 2: side colors ───────────────────────────────────────────────────
  const [useSideColors,   setUseSideColors]   = useState(false);
  const [leftPointColor,  setLeftPointColor]  = useState(DEFAULT_JOINT_HEX);
  const [rightPointColor, setRightPointColor] = useState(DEFAULT_JOINT_HEX);
  const [leftLineColor,   setLeftLineColor]   = useState(DEFAULT_LIMB_HEX);
  const [rightLineColor,  setRightLineColor]  = useState(DEFAULT_LIMB_HEX);

  // ── Tier 3: per-group fine-tuning ─────────────────────────────────────────
  const [useGroups, setUseGroups] = useState(false);
  const [headCfg,   setHeadCfg]   = useState({ color: DEFAULT_JOINT_HEX, radius: DEFAULT_RADIUS });
  const [jointGroups, setJointGroups] = useState<Record<string, JointGroupCfg>>(() =>
    Object.fromEntries(BILATERAL_GROUPS.map(g => [g.key, { leftColor: DEFAULT_JOINT_HEX, rightColor: DEFAULT_JOINT_HEX, radius: DEFAULT_RADIUS }])),
  );
  const [limbGroups, setLimbGroups] = useState<Record<string, LimbGroupCfg>>(() =>
    Object.fromEntries(EDGE_GROUPS.map(g => [g.key, { leftColor: DEFAULT_LIMB_HEX, rightColor: DEFAULT_LIMB_HEX, width: DEFAULT_WIDTH }])),
  );

  // Stable ref for onChange to avoid re-emitting on every parent render.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  // Emit updated style whenever any setting changes.
  useEffect(() => {
    onChangeRef.current(buildStyle(
      lineWidth, pointRadius, globalPointColor, globalLineColor,
      useSideColors, useGroups, headCfg, jointGroups, limbGroups,
    ));
  }, [lineWidth, pointRadius, globalPointColor, globalLineColor, useSideColors, useGroups, headCfg, jointGroups, limbGroups]);

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

  // ── Cascade handlers ─────────────────────────────────────────────────────

  /** Global point color → propagates to both side colors + all joint groups. */
  function handleGlobalPointColor(color: string) {
    setGlobalPointColor(color);
    setLeftPointColor(color);
    setRightPointColor(color);
    setHeadCfg(c => ({ ...c, color }));
    setJointGroups(prev =>
      Object.fromEntries(BILATERAL_GROUPS.map(g => [g.key, { ...prev[g.key], leftColor: color, rightColor: color }])),
    );
  }

  /** Global line color → propagates to both side colors + all limb groups. */
  function handleGlobalLineColor(color: string) {
    setGlobalLineColor(color);
    setLeftLineColor(color);
    setRightLineColor(color);
    setLimbGroups(prev =>
      Object.fromEntries(EDGE_GROUPS.map(g => [g.key, { ...prev[g.key], leftColor: color, rightColor: color }])),
    );
  }

  /** Left point color → propagates to head + all left-side joint entries. */
  function handleLeftPointColor(color: string) {
    setLeftPointColor(color);
    setHeadCfg(c => ({ ...c, color })); // center head follows left
    setJointGroups(prev =>
      Object.fromEntries(BILATERAL_GROUPS.map(g => [g.key, { ...prev[g.key], leftColor: color }])),
    );
  }

  /** Right point color → propagates to all right-side joint entries. */
  function handleRightPointColor(color: string) {
    setRightPointColor(color);
    setJointGroups(prev =>
      Object.fromEntries(BILATERAL_GROUPS.map(g => [g.key, { ...prev[g.key], rightColor: color }])),
    );
  }

  /** Left line color → propagates to all left-side limb entries. */
  function handleLeftLineColor(color: string) {
    setLeftLineColor(color);
    setLimbGroups(prev =>
      Object.fromEntries(EDGE_GROUPS.map(g => [g.key, { ...prev[g.key], leftColor: color }])),
    );
  }

  /** Right line color → propagates to all right-side limb entries. */
  function handleRightLineColor(color: string) {
    setRightLineColor(color);
    setLimbGroups(prev =>
      Object.fromEntries(EDGE_GROUPS.map(g => [g.key, { ...prev[g.key], rightColor: color }])),
    );
  }

  function updateJointGroup(key: string, patch: Partial<JointGroupCfg>) {
    setJointGroups(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function updateLimbGroup(key: string, patch: Partial<LimbGroupCfg>) {
    setLimbGroups(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={panelRef} className={cn("relative", className)}>
      {/* Trigger button — height matches other sm-toolbar buttons */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-edge/50 bg-card/60 font-medium text-fg-muted transition-all duration-200 hover:border-edge-hover hover:text-fg",
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

      {open && (
        <div
          role="dialog"
          aria-label="Skeleton style options"
          className="absolute left-0 top-full z-30 mt-1 w-80 overflow-y-auto max-h-[80vh] rounded-lg border border-edge bg-card p-3 shadow-xl flex flex-col gap-3"
        >
          {/* ── Tier 1: Global colors + sizes ── */}
          <div className="flex flex-col gap-2">
            {/* Points row */}
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-xs font-medium text-fg-secondary">Points</span>
              <input
                type="color"
                value={cssToHex(globalPointColor)}
                onChange={e => handleGlobalPointColor(e.target.value)}
                className="h-6 w-8 shrink-0 cursor-pointer rounded border border-edge bg-inset p-0.5"
                title="Point color — changes both sides"
              />
              <span className="w-14 shrink-0 text-xs text-fg-muted font-mono">{cssToHex(globalPointColor).toUpperCase()}</span>
              <div className="flex items-center gap-1.5 flex-1">
                <input
                  type="range" min="1" max="12" step="1" value={pointRadius}
                  onChange={e => setPointRadius(parseInt(e.target.value, 10))}
                  className="flex-1 accent-accent"
                  title={`Point radius: ${pointRadius}px`}
                />
                <span className="w-8 text-right tabular-nums text-xs text-fg-muted">{pointRadius}px</span>
              </div>
            </div>
            {/* Lines row */}
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-xs font-medium text-fg-secondary">Lines</span>
              <input
                type="color"
                value={cssToHex(globalLineColor)}
                onChange={e => handleGlobalLineColor(e.target.value)}
                className="h-6 w-8 shrink-0 cursor-pointer rounded border border-edge bg-inset p-0.5"
                title="Line color — changes both sides"
              />
              <span className="w-14 shrink-0 text-xs text-fg-muted font-mono">{cssToHex(globalLineColor).toUpperCase()}</span>
              <div className="flex items-center gap-1.5 flex-1">
                <input
                  type="range" min="0.5" max="8" step="0.5" value={lineWidth}
                  onChange={e => setLineWidth(parseFloat(e.target.value))}
                  className="flex-1 accent-accent"
                  title={`Line width: ${lineWidth}px`}
                />
                <span className="w-8 text-right tabular-nums text-xs text-fg-muted">{lineWidth}px</span>
              </div>
            </div>
          </div>

          {/* ── Tier 2: Left / right colors ── */}
          <label className="flex items-center gap-2 text-xs text-fg-secondary cursor-pointer select-none">
            <input type="checkbox" checked={useSideColors} onChange={e => setUseSideColors(e.target.checked)}
              className="accent-accent rounded" />
            Left / right colors
          </label>

          {useSideColors && (
            <div className="flex flex-col gap-2 pl-1 border-l-2 border-accent/20">
              {/* Column headers */}
              <div className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2">
                <span />
                <span className="text-center text-xs text-fg-muted">Points</span>
                <span className="text-center text-xs text-fg-muted">Lines</span>
              </div>
              {/* Left row */}
              <div className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2">
                <span className="text-xs text-fg-secondary">Left</span>
                <input type="color" value={cssToHex(leftPointColor)}
                  onChange={e => handleLeftPointColor(e.target.value)}
                  className="h-7 w-full cursor-pointer rounded border border-edge bg-inset p-0.5"
                  title="Left side point color" />
                <input type="color" value={cssToHex(leftLineColor)}
                  onChange={e => handleLeftLineColor(e.target.value)}
                  className="h-7 w-full cursor-pointer rounded border border-edge bg-inset p-0.5"
                  title="Left side line color" />
              </div>
              {/* Right row */}
              <div className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2">
                <span className="text-xs text-fg-secondary">Right</span>
                <input type="color" value={cssToHex(rightPointColor)}
                  onChange={e => handleRightPointColor(e.target.value)}
                  className="h-7 w-full cursor-pointer rounded border border-edge bg-inset p-0.5"
                  title="Right side point color" />
                <input type="color" value={cssToHex(rightLineColor)}
                  onChange={e => handleRightLineColor(e.target.value)}
                  className="h-7 w-full cursor-pointer rounded border border-edge bg-inset p-0.5"
                  title="Right side line color" />
              </div>
            </div>
          )}

          {/* ── Tier 3: Per-group fine-tuning ── */}
          <label className="flex items-center gap-2 text-xs text-fg-secondary cursor-pointer select-none">
            <input type="checkbox" checked={useGroups} onChange={e => setUseGroups(e.target.checked)}
              className="accent-accent rounded" />
            Per-group fine-tuning
          </label>

          {useGroups && (
            <>
              <hr className="border-edge" />

              {/* ── Joints ── */}
              <p className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">Joints</p>
              <p className="text-xs text-fg-muted -mt-2">L / R swatches are independent. Sliders set radius.</p>

              {/* Head (center — single color) */}
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-fg-secondary">Head</span>
                <input type="color" value={cssToHex(headCfg.color)}
                  onChange={e => setHeadCfg(c => ({ ...c, color: e.target.value }))}
                  className="h-6 w-8 cursor-pointer rounded border border-edge bg-inset p-0.5"
                  title="Head joints color" />
                <div className="flex items-center gap-1.5 flex-1">
                  <input type="range" min="1" max="12" step="1" value={headCfg.radius}
                    onChange={e => setHeadCfg(c => ({ ...c, radius: parseInt(e.target.value, 10) }))}
                    className="flex-1 accent-accent" />
                  <span className="w-6 text-right tabular-nums text-xs text-fg-muted">{headCfg.radius}</span>
                </div>
              </div>

              {BILATERAL_GROUPS.map(grp => {
                const cfg = jointGroups[grp.key];
                return (
                  <div key={grp.key} className="flex items-center gap-1.5">
                    <span className="w-20 shrink-0 text-xs text-fg-secondary">{grp.label}</span>
                    <input type="color" value={cssToHex(cfg.leftColor)}
                      onChange={e => updateJointGroup(grp.key, { leftColor: e.target.value })}
                      className="h-6 w-7 cursor-pointer rounded border border-edge bg-inset p-0.5"
                      title={`${grp.label} — left color`} />
                    <input type="color" value={cssToHex(cfg.rightColor)}
                      onChange={e => updateJointGroup(grp.key, { rightColor: e.target.value })}
                      className="h-6 w-7 cursor-pointer rounded border border-edge bg-inset p-0.5"
                      title={`${grp.label} — right color`} />
                    <div className="flex items-center gap-1.5 flex-1">
                      <input type="range" min="1" max="12" step="1" value={cfg.radius}
                        onChange={e => updateJointGroup(grp.key, { radius: parseInt(e.target.value, 10) })}
                        className="flex-1 accent-accent" />
                      <span className="w-6 text-right tabular-nums text-xs text-fg-muted">{cfg.radius}</span>
                    </div>
                  </div>
                );
              })}

              <hr className="border-edge" />

              {/* ── Limbs ── */}
              <p className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">Limbs</p>
              <p className="text-xs text-fg-muted -mt-2">L / R swatches; slider sets width.</p>

              {EDGE_GROUPS.map(grp => {
                const cfg = limbGroups[grp.key];
                return (
                  <div key={grp.key} className="flex items-center gap-1.5">
                    <span className="w-20 shrink-0 text-xs text-fg-secondary">{grp.label}</span>
                    <input type="color" value={cssToHex(cfg.leftColor)}
                      onChange={e => updateLimbGroup(grp.key, { leftColor: e.target.value })}
                      className="h-6 w-7 cursor-pointer rounded border border-edge bg-inset p-0.5"
                      title={`${grp.label} — left color`} />
                    <input type="color" value={cssToHex(cfg.rightColor)}
                      onChange={e => updateLimbGroup(grp.key, { rightColor: e.target.value })}
                      className="h-6 w-7 cursor-pointer rounded border border-edge bg-inset p-0.5"
                      title={`${grp.label} — right color`} />
                    <div className="flex items-center gap-1.5 flex-1">
                      <input type="range" min="0.5" max="8" step="0.5" value={cfg.width}
                        onChange={e => updateLimbGroup(grp.key, { width: parseFloat(e.target.value) })}
                        className="flex-1 accent-accent" />
                      <span className="w-6 text-right tabular-nums text-xs text-fg-muted">{cfg.width}</span>
                    </div>
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


