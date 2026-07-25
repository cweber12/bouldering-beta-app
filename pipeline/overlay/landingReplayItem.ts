/**
 * The **Landing Replay Item** contract (v1) — the checked-in, purely geometric
 * description of one curated 8-second replay clip.
 *
 * The design invariant behind this shape: everything expensive (ORB matching,
 * homography, Hold projection, Skeleton transform) runs **once at authoring
 * time** on the hidden `/dev/landing-clip` route. The landing renderer only
 * lerps and crossfades — no OpenCV, no MediaPipe, no homography at runtime.
 * That is why every pose carries **both** coordinate spaces rather than one
 * space plus a matrix: "morph into Route space" is a plain interpolation
 * between two saved arrays.
 *
 * Every coordinate is normalized `[0,1]` — `source` points against the source
 * video dimensions, `photo` points against the Route Photo dimensions — so
 * nothing depends on render resolution. `poses[].t` and `holds[].t` are
 * **clip-relative seconds** (0 at the window's first frame).
 *
 * This module is framework-agnostic — no React imports, no OpenCV. Keep it that
 * way: the landing renderer imports it.
 */

/** Contract version stamped into the playlist wrapper. */
export const LANDING_REPLAY_VERSION = 1;

/** Fixed clip width in seconds. The playlist animation maps 1:1 onto it. */
export const REPLAY_CLIP_SECONDS = 8;

/** Public label for a clip. Deliberately the only Run metadata that ships. */
export interface ReplayLabel {
  area: string;
  route: string;
  /** Difficulty grade (e.g. "V4"). Empty string when the Run has none. */
  rating: string;
}

/** Pixel dimensions of a coordinate space. Carried for aspect ratio only. */
export interface ReplayDims {
  w: number;
  h: number;
}

/** The Route Photo: its pixel space plus the embedded WebP the hero draws. */
export interface ReplayPhoto extends ReplayDims {
  /** `data:image/webp;base64,…` — the compressed Route Photo. */
  webp: string;
}

/** A normalized `[0,1]` point. */
export interface ReplayPoint {
  x: number;
  y: number;
}

/** One matched wall feature, both spaces baked (source `s*`, photo `p*`). */
export interface ReplayMatch {
  sx: number;
  sy: number;
  px: number;
  py: number;
}

/** A pose landmark: name, normalized position, confidence score. */
export interface ReplayKeypoint {
  n: string;
  x: number;
  y: number;
  s: number;
}

/** One pose sample, in both coordinate spaces, at clip-relative time `t`. */
export interface ReplayPose {
  /** Clip-relative seconds (0 at the window's first frame). */
  t: number;
  /** Landmarks normalized against the source video dimensions. */
  source: ReplayKeypoint[];
  /** The same landmarks normalized against the Route Photo dimensions. */
  photo: ReplayKeypoint[];
}

/** A Hold in Route Photo space, revealed at clip-relative time `t`. */
export interface ReplayHold {
  x: number;
  y: number;
  kind: "hand" | "foot";
  side: "left" | "right";
  /** Clip-relative seconds of first use. */
  t: number;
}

/** One curated replay clip. */
export interface LandingReplayItem {
  id: string;
  label: ReplayLabel;
  /** Source video pixel dimensions — the space `starfield`/`matches.s*`/`poses[].source` normalize against. */
  source: ReplayDims;
  /** Route Photo pixel dimensions + the embedded WebP. */
  photo: ReplayPhoto;
  /** Wall ORB keypoints from the source reference frame, normalized. */
  starfield: ReplayPoint[];
  /** Paired wall features — the points that visibly migrate during the morph. */
  matches: ReplayMatch[];
  poses: ReplayPose[];
  holds: ReplayHold[];
}

/** The checked-in playlist asset. Items play in array order. */
export interface LandingReplayFile {
  version: typeof LANDING_REPLAY_VERSION;
  items: LandingReplayItem[];
}

/**
 * Narrow runtime guard: enough to stop a hand-edited playlist from crashing the
 * hero, and deliberately no more. Producer and consumer are the same commit of
 * the same repo, so this is not a strict parser — it checks that the fields the
 * renderer dereferences exist and have the right kind, without walking every
 * element of every array.
 */
export function isReplayItem(value: unknown): value is LandingReplayItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  if (typeof v.id !== "string") return false;

  const label = v.label as Record<string, unknown> | undefined;
  if (!label || typeof label.area !== "string" || typeof label.route !== "string") return false;

  if (!isDims(v.source)) return false;

  const photo = v.photo as Record<string, unknown> | undefined;
  if (!isDims(photo) || typeof (photo as Record<string, unknown>).webp !== "string") return false;

  if (!Array.isArray(v.starfield) || !Array.isArray(v.matches)) return false;
  if (!Array.isArray(v.holds)) return false;
  if (!Array.isArray(v.poses) || v.poses.length === 0) return false;

  // One representative pose is checked — the renderer reads `t` and both spaces
  // off every entry, and a file with a well-formed first pose and a malformed
  // tenth is not a failure mode a single maintainer's export produces.
  const pose = v.poses[0] as Record<string, unknown> | undefined;
  if (!pose || typeof pose.t !== "number") return false;
  if (!Array.isArray(pose.source) || !Array.isArray(pose.photo)) return false;

  return true;
}

function isDims(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return typeof d.w === "number" && typeof d.h === "number";
}
