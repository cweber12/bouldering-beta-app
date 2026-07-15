/**
 * Ground Truth — the per-video reference pose the detection-eval harness scores
 * runs against (see docs/adr/0018 and the Ground Truth glossary entry in
 * CONTEXT.md). Authored once in the calibration pass by correcting a throwaway
 * detection scaffold, then frozen beside the Scan Setup as `ground-truth.json`.
 *
 * Only a **core body-joint set** (~13: shoulders, elbows, wrists, hips, knees,
 * ankles, a head anchor) is authored and scored — never the full 33 BlazePose
 * points. Each Detection Frame carries a state (present / absent / skip), the
 * core-joint positions (video-normalized), a per-joint `occluded` flag, and a
 * `verified` flag.
 *
 * Framework-agnostic — no React imports. Used by the calibration page (client),
 * the dev proxy (server), and the headless scoring pass, so it must produce a
 * stable `groundTruthHash` everywhere: the hash is what each score stamps to
 * prove which Ground Truth version it was measured against.
 */

import { MP_KP, MP_KP_NAMES, type MediaPipeKeypointIndex } from "@/utils/poseConstants";

/** Bumped only on a breaking change to the Ground Truth shape or joint set. */
export const GROUND_TRUTH_VERSION = 1;

/**
 * The core body-joint set that is authored and scored. A head anchor (nose) plus
 * the twelve limb joints — the joints that carry the pose signal (ADR 0018 §3).
 */
export const CORE_JOINT_INDICES: readonly MediaPipeKeypointIndex[] = [
  MP_KP.NOSE,
  MP_KP.LEFT_SHOULDER,
  MP_KP.RIGHT_SHOULDER,
  MP_KP.LEFT_ELBOW,
  MP_KP.RIGHT_ELBOW,
  MP_KP.LEFT_WRIST,
  MP_KP.RIGHT_WRIST,
  MP_KP.LEFT_HIP,
  MP_KP.RIGHT_HIP,
  MP_KP.LEFT_KNEE,
  MP_KP.RIGHT_KNEE,
  MP_KP.LEFT_ANKLE,
  MP_KP.RIGHT_ANKLE,
] as const;

/** Core-joint names, in index order — the persisted joint-set definition. */
export const CORE_JOINT_NAMES: readonly string[] = CORE_JOINT_INDICES.map((i) => MP_KP_NAMES[i]);

const CORE_JOINT_NAME_SET = new Set(CORE_JOINT_NAMES);

/** The GT state of a Detection Frame. */
export type GroundTruthState = "present" | "absent" | "skip";
const GT_STATES: readonly GroundTruthState[] = ["present", "absent", "skip"];

/** One core joint's ground-truth position, video-normalized, with occlusion. */
export interface GroundTruthJoint {
  /** X position normalized to [0, 1] relative to the frame width. */
  x: number;
  /** Y position normalized to [0, 1] relative to the frame height. */
  y: number;
  /** True when the joint is hidden (pre-seeded from the scaffold model's confidence). */
  occluded: boolean;
}

/** Ground Truth for one Detection Frame. */
export interface GroundTruthFrame {
  /** Detection Frame index (the Nth sampled frame). */
  frameIndex: number;
  /** Video timestamp in seconds. */
  timestamp: number;
  /** Whether a Climber pose is present / absent / excluded from scoring. */
  state: GroundTruthState;
  /**
   * Core-joint positions keyed by joint name. Meaningful only when
   * `state === "present"`; empty for absent / skip. Sparse-by-effort: a frame
   * may omit joints the author never touched.
   */
  joints: Record<string, GroundTruthJoint>;
  /** True once a human has corrected or accepted this frame. */
  verified: boolean;
}

/** The authored Ground Truth content — the pre-image for the hash. */
export interface GroundTruthInput {
  frames: GroundTruthFrame[];
}

/** A persisted Ground Truth: the content plus its joint set, hash, timestamp. */
export interface GroundTruth extends GroundTruthInput {
  version: number;
  /** The core-joint set definition this GT was authored against (index order). */
  jointSet: readonly string[];
  /** SHA-256 over the canonicalised content — stamped onto every score. */
  groundTruthHash: string;
  /** ISO timestamp, stamped server-side on write. */
  updatedAt: string;
}

/** Round to 6 decimals so float noise never changes the hash. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Canonical, order-independent form of one frame's joints. */
function canonJoints(joints: Record<string, GroundTruthJoint>) {
  return Object.keys(joints)
    .sort()
    .map((name) => {
      const j = joints[name];
      return { n: name, x: round6(j.x), y: round6(j.y), o: !!j.occluded };
    });
}

/**
 * Deterministic string form of the Ground Truth (frames sorted by index, joints
 * sorted by name, numbers rounded, joint-set definition folded in) — the
 * pre-image for {@link hashGroundTruthInput}.
 */
export function canonicalGroundTruthInput(input: GroundTruthInput): string {
  const frames = [...input.frames]
    .sort((a, b) => a.frameIndex - b.frameIndex)
    .map((f) => ({
      i: f.frameIndex,
      t: round6(f.timestamp),
      s: f.state,
      v: !!f.verified,
      j: canonJoints(f.joints),
    }));
  return JSON.stringify({
    v: GROUND_TRUTH_VERSION,
    jointSet: CORE_JOINT_NAMES,
    frames,
  });
}

/** SHA-256 hex digest of the canonical Ground Truth content. */
export async function hashGroundTruthInput(input: GroundTruthInput): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalGroundTruthInput(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Validation — the PUT proxy trusts nothing from the client.
// ---------------------------------------------------------------------------

/** Hard cap on Detection Frames per video, to bound proxy payload size. */
const MAX_FRAMES = 100_000;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseJoint(v: unknown): GroundTruthJoint | null {
  if (typeof v !== "object" || v === null) return null;
  const j = v as Record<string, unknown>;
  if (!isFiniteNumber(j.x) || !isFiniteNumber(j.y)) return null;
  if (typeof j.occluded !== "boolean") return null;
  return { x: j.x, y: j.y, occluded: j.occluded };
}

function parseJoints(v: unknown): Record<string, GroundTruthJoint> | null {
  if (typeof v !== "object" || v === null) return null;
  const src = v as Record<string, unknown>;
  const out: Record<string, GroundTruthJoint> = {};
  for (const name of Object.keys(src)) {
    if (!CORE_JOINT_NAME_SET.has(name)) return null; // reject non-core joints
    const joint = parseJoint(src[name]);
    if (!joint) return null;
    out[name] = joint;
  }
  return out;
}

function parseFrame(v: unknown): GroundTruthFrame | null {
  if (typeof v !== "object" || v === null) return null;
  const f = v as Record<string, unknown>;

  if (!Number.isInteger(f.frameIndex) || (f.frameIndex as number) < 0) return null;
  if (!isFiniteNumber(f.timestamp) || f.timestamp < 0) return null;
  if (typeof f.state !== "string" || !GT_STATES.includes(f.state as GroundTruthState)) return null;
  if (typeof f.verified !== "boolean") return null;

  const joints = parseJoints(f.joints ?? {});
  if (!joints) return null;

  return {
    frameIndex: f.frameIndex as number,
    timestamp: f.timestamp,
    state: f.state as GroundTruthState,
    joints,
    verified: f.verified,
  };
}

/**
 * Validate an untrusted request body into a {@link GroundTruthInput}, or null
 * when malformed. A missing/undefined `joints` on a frame is accepted as empty.
 */
export function parseGroundTruthInput(body: unknown): GroundTruthInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.frames) || b.frames.length > MAX_FRAMES) return null;

  const frames: GroundTruthFrame[] = [];
  const seen = new Set<number>();
  for (const raw of b.frames) {
    const frame = parseFrame(raw);
    if (!frame) return null;
    if (seen.has(frame.frameIndex)) return null; // one record per Detection Frame
    seen.add(frame.frameIndex);
    frames.push(frame);
  }

  return { frames };
}

// ---------------------------------------------------------------------------
// Harness client — the minimal load/save seam over the dev proxy. The authoring
// UI (issue 04) builds on these; here they let a GT round-trip programmatically.
// ---------------------------------------------------------------------------

/** Load the persisted Ground Truth for a bundle, or null when none exists. */
export async function loadGroundTruth(bundleKey: string): Promise<GroundTruth | null> {
  const res = await fetch(`/api/dev/corpus/ground-truth?key=${encodeURIComponent(bundleKey)}`);
  if (!res.ok) throw new Error("Failed to load Ground Truth.");
  const body = await res.json();
  return (body.groundTruth as GroundTruth | null) ?? null;
}

/** Persist Ground Truth for a bundle; returns the authoritative saved record. */
export async function saveGroundTruth(
  bundleKey: string,
  input: GroundTruthInput,
): Promise<GroundTruth> {
  const res = await fetch(`/api/dev/corpus/ground-truth?key=${encodeURIComponent(bundleKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Failed to save Ground Truth.");
  return body.groundTruth as GroundTruth;
}
