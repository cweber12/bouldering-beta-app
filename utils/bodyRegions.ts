/**
 * Body-region definitions for the compare highlighter.
 *
 * Groups the MediaPipe 33-keypoint topology into six climbing-meaningful
 * regions (head, arms, hands, torso, legs, feet) and builds a `SkeletonStyle`
 * that *emphasizes* the selected regions while *dimming* everything else to a
 * faint gray. Emphasized parts keep the caller's identity colour, so each
 * climb stays distinguishable while the focused limb pops.
 *
 * Framework-agnostic — no React imports.
 */

import { MP_KP } from "@/utils/poseConstants";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";

// ---------------------------------------------------------------------------
// Region keys + selection model
// ---------------------------------------------------------------------------

export type RegionKey = "head" | "arms" | "hands" | "torso" | "legs" | "feet";

export type HighlightSide = "both" | "left" | "right";

export interface HighlightSelection {
  /** Emphasized regions. Empty = no emphasis (full-colour skeleton). */
  regions: RegionKey[];
  /** Restrict emphasis to one side of the body. */
  side: HighlightSide;
}

export const EMPTY_HIGHLIGHT: HighlightSelection = { regions: [], side: "both" };

/** True when any region is selected (i.e. the dim-the-rest behaviour is on). */
export function isHighlightActive(sel: HighlightSelection): boolean {
  return sel.regions.length > 0;
}

// ---------------------------------------------------------------------------
// Region → keypoints + edges (partition of the MediaPipe topology)
// ---------------------------------------------------------------------------

interface RegionDef {
  key: RegionKey;
  label: string;
  joints: number[];
  edges: [number, number][];
}

const K = MP_KP;

const REGION_DEFS: RegionDef[] = [
  {
    key: "head",
    label: "Head",
    joints: [K.NOSE, K.LEFT_EYE_INNER, K.LEFT_EYE, K.LEFT_EYE_OUTER, K.RIGHT_EYE_INNER, K.RIGHT_EYE, K.RIGHT_EYE_OUTER, K.LEFT_EAR, K.RIGHT_EAR, K.MOUTH_LEFT, K.MOUTH_RIGHT],
    edges: [[K.LEFT_EAR, K.LEFT_EYE_OUTER], [K.LEFT_EYE_OUTER, K.LEFT_EYE], [K.LEFT_EYE, K.LEFT_EYE_INNER], [K.LEFT_EYE_INNER, K.NOSE], [K.NOSE, K.RIGHT_EYE_INNER], [K.RIGHT_EYE_INNER, K.RIGHT_EYE], [K.RIGHT_EYE, K.RIGHT_EYE_OUTER], [K.RIGHT_EYE_OUTER, K.RIGHT_EAR], [K.MOUTH_LEFT, K.MOUTH_RIGHT]],
  },
  {
    key: "arms",
    label: "Arms",
    joints: [K.LEFT_SHOULDER, K.RIGHT_SHOULDER, K.LEFT_ELBOW, K.RIGHT_ELBOW],
    edges: [[K.LEFT_SHOULDER, K.LEFT_ELBOW], [K.LEFT_ELBOW, K.LEFT_WRIST], [K.RIGHT_SHOULDER, K.RIGHT_ELBOW], [K.RIGHT_ELBOW, K.RIGHT_WRIST]],
  },
  {
    key: "hands",
    label: "Hands",
    joints: [K.LEFT_WRIST, K.RIGHT_WRIST, K.LEFT_PINKY, K.RIGHT_PINKY, K.LEFT_INDEX, K.RIGHT_INDEX, K.LEFT_THUMB, K.RIGHT_THUMB],
    edges: [[K.LEFT_WRIST, K.LEFT_PINKY], [K.LEFT_WRIST, K.LEFT_INDEX], [K.LEFT_WRIST, K.LEFT_THUMB], [K.LEFT_INDEX, K.LEFT_PINKY], [K.RIGHT_WRIST, K.RIGHT_PINKY], [K.RIGHT_WRIST, K.RIGHT_INDEX], [K.RIGHT_WRIST, K.RIGHT_THUMB], [K.RIGHT_INDEX, K.RIGHT_PINKY]],
  },
  {
    key: "torso",
    label: "Torso",
    joints: [K.LEFT_HIP, K.RIGHT_HIP],
    edges: [[K.LEFT_SHOULDER, K.RIGHT_SHOULDER], [K.LEFT_SHOULDER, K.LEFT_HIP], [K.RIGHT_SHOULDER, K.RIGHT_HIP], [K.LEFT_HIP, K.RIGHT_HIP]],
  },
  {
    key: "legs",
    label: "Legs",
    joints: [K.LEFT_KNEE, K.RIGHT_KNEE, K.LEFT_ANKLE, K.RIGHT_ANKLE],
    edges: [[K.LEFT_HIP, K.LEFT_KNEE], [K.LEFT_KNEE, K.LEFT_ANKLE], [K.RIGHT_HIP, K.RIGHT_KNEE], [K.RIGHT_KNEE, K.RIGHT_ANKLE]],
  },
  {
    key: "feet",
    label: "Feet",
    joints: [K.LEFT_HEEL, K.RIGHT_HEEL, K.LEFT_FOOT_INDEX, K.RIGHT_FOOT_INDEX],
    edges: [[K.LEFT_ANKLE, K.LEFT_HEEL], [K.LEFT_ANKLE, K.LEFT_FOOT_INDEX], [K.LEFT_HEEL, K.LEFT_FOOT_INDEX], [K.RIGHT_ANKLE, K.RIGHT_HEEL], [K.RIGHT_ANKLE, K.RIGHT_FOOT_INDEX], [K.RIGHT_HEEL, K.RIGHT_FOOT_INDEX]],
  },
];

/** Ordered region list for the highlighter UI. */
export const REGIONS: { key: RegionKey; label: string }[] = REGION_DEFS.map(
  (r) => ({ key: r.key, label: r.label }),
);

const REGION_BY_KEY = new Map(REGION_DEFS.map((r) => [r.key, r]));

// ---------------------------------------------------------------------------
// Side helpers
// ---------------------------------------------------------------------------

// Reverse lookup index → side, built once from the MP_KP table.
const SIDE_BY_INDEX: Record<number, "left" | "right" | "center"> = (() => {
  const out: Record<number, "left" | "right" | "center"> = {};
  for (const [key, idx] of Object.entries(MP_KP)) {
    const lower = key.toLowerCase();
    out[idx as number] = lower.startsWith("left_") ? "left" : lower.startsWith("right_") ? "right" : "center";
  }
  return out;
})();

function indexSide(idx: number): "left" | "right" | "center" {
  return SIDE_BY_INDEX[idx] ?? "center";
}

function jointMatchesSide(idx: number, side: HighlightSide): boolean {
  if (side === "both") return true;
  return indexSide(idx) === side;
}

function edgeMatchesSide(a: number, b: number, side: HighlightSide): boolean {
  if (side === "both") return true;
  return indexSide(a) === side && indexSide(b) === side;
}

// ---------------------------------------------------------------------------
// Style builder
// ---------------------------------------------------------------------------

/** Faint neutral gray for de-emphasized parts (canvas literal). */
const DIM_COLOR = "rgba(118, 128, 142, 0.30)";

export interface HighlightStyleParams {
  selection: HighlightSelection;
  /** Identity colour for this climb's limbs (emphasized edges keep it). */
  limbColor: string;
  /** Joint colour for emphasized joints. */
  jointColor: string;
  lineWidth: number;
  pointRadius: number;
  skeletonEdges: [number, number][];
  keypointNames: Record<number, string>;
}

/**
 * Build a SkeletonStyle that emphasizes the selected regions and dims the rest.
 *
 * When no region is selected the result is a flat style (identity colours, no
 * overrides). When regions are selected, every keypoint/edge outside the
 * emphasized set is recoloured to a faint gray and thinned, so the focused
 * parts stand out while the body stays visible for context.
 */
export function buildHighlightStyle(params: HighlightStyleParams): SkeletonStyle {
  const { selection, limbColor, jointColor, lineWidth, pointRadius, skeletonEdges, keypointNames } = params;

  const base: SkeletonStyle = {
    limbColor,
    jointColor,
    lineWidth,
    pointRadius,
    skeletonEdges,
    keypointNames,
  };

  if (!isHighlightActive(selection)) return base;

  // Collect emphasized keypoint names + edge keys (filtered by side).
  const emphNames = new Set<string>();
  const emphEdges = new Set<string>();
  for (const key of selection.regions) {
    const def = REGION_BY_KEY.get(key);
    if (!def) continue;
    for (const j of def.joints) {
      if (jointMatchesSide(j, selection.side)) {
        const name = keypointNames[j];
        if (name) emphNames.add(name);
      }
    }
    for (const [a, b] of def.edges) {
      if (edgeMatchesSide(a, b, selection.side)) emphEdges.add(`${a}-${b}`);
    }
  }

  // Dim every keypoint/edge not in the emphasized set.
  const jointColorOverrides: Record<string, string> = {};
  const jointRadiusOverrides: Record<string, number> = {};
  for (const name of Object.values(keypointNames)) {
    if (!emphNames.has(name)) {
      jointColorOverrides[name] = DIM_COLOR;
      jointRadiusOverrides[name] = Math.max(1, pointRadius * 0.5);
    }
  }

  const edgeColorMap: Record<string, string> = {};
  const edgeWidthMap: Record<string, number> = {};
  for (const [f, t] of skeletonEdges) {
    const k = `${f}-${t}`;
    if (!emphEdges.has(k)) {
      edgeColorMap[k] = DIM_COLOR;
      edgeWidthMap[k] = Math.max(0.5, lineWidth * 0.6);
    }
  }

  return { ...base, jointColorOverrides, jointRadiusOverrides, edgeColorMap, edgeWidthMap };
}
