/**
 * The **Landing Replay Item** contract (v1) — the checked-in, purely geometric
 * description of one curated replay clip.
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
 * Captured seconds and screen seconds are **not** the same quantity. An item
 * records how much climbing it captured ({@link LandingReplayItem.duration}) and
 * the hero decides how long to spend showing it ({@link REPLAY_ANIMATION_SECONDS});
 * the ratio is the playback rate. Detection runs at 2 Hz and the stored track is
 * bone-space interpolated from there, so replaying above 1× discards no motion
 * that was ever measured — it just buys a longer window of the ascent for the
 * same hero dwell time.
 *
 * This module is framework-agnostic — no React imports, no OpenCV. Keep it that
 * way: the landing renderer imports it.
 */

import { MP_KP_NAMES } from "@/utils/poseConstants";

/** Contract version stamped into the playlist wrapper. */
export const LANDING_REPLAY_VERSION = 1;

/**
 * How much video one clip captures, in seconds — the authoring window's fixed
 * width. Runs whose detected pose track is shorter than this cannot be authored.
 */
export const REPLAY_CAPTURE_SECONDS = 14;

/**
 * How long the hero spends playing one clip, in seconds. Shorter than the
 * capture window, so the figure moves at `duration / REPLAY_ANIMATION_SECONDS`
 * (~1.4×): more of the ascent for barely more dwell time. It also bounds the
 * phase windows — much past 10s and the phase-3 morph starts to drag.
 */
export const REPLAY_ANIMATION_SECONDS = 10;

/**
 * Minimum spacing between exported pose samples, in captured seconds.
 *
 * The stored Run track is 10 Hz, but it was bone-space interpolated up from 2 Hz
 * detections, so the motion above ~2 Hz is inferred rather than measured. The
 * renderer samples poses by time and interpolates between them, so exporting at
 * 5 Hz halves the payload and changes nothing anyone can see.
 */
export const REPLAY_POSE_INTERVAL_SECONDS = 0.2;

/**
 * How many items the hero will play. The playlist is a curated 1-5 clips; a file
 * carrying more is read up to this cap rather than rejected, because a playlist
 * that grew by one item past the cap is a curation slip, not a broken asset.
 */
export const REPLAY_PLAYLIST_MAX = 5;

/**
 * Where the checked-in playlist lives — one static JSON in `public/`, served
 * from the same origin as the page's own JavaScript. The maintainer authors it
 * on `/dev/landing-clip` and commits it here; rollback is reverting the file.
 * There is no fallback asset and no second load path: if this fetch fails, the
 * hero renders nothing and the landing page degrades to its text content.
 */
export const LANDING_REPLAY_ASSET_PATH = "/landing-replay.json";

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

/**
 * A pose landmark as `[index, x, y, score]`, where `index` is the BlazePose
 * landmark index ({@link MP_KP_NAMES}).
 *
 * Landmark names are the single biggest cost in a checked-in playlist — the
 * literal `"n":"left_foot_index"` outweighs the geometry it labels, 33 times per
 * pose per coordinate space. Indices carry the same information at less than half
 * the bytes, and carrying the index per entry (rather than 33 fixed slots) keeps
 * a filtered-out landmark simply absent, exactly as the named form did.
 */
export type ReplayKeypoint = [index: number, x: number, y: number, score: number];

/** One pose sample, in both coordinate spaces, at clip-relative time `t`. */
export interface ReplayPose {
  /** Clip-relative **captured** seconds (0 at the window's first frame). */
  t: number;
  /** Landmarks normalized against the source video dimensions. */
  source: ReplayKeypoint[];
  /** The same landmarks normalized against the Route Photo dimensions. */
  photo: ReplayKeypoint[];
}

/** The landmark name for an encoded keypoint, or null if the index is unknown. */
export function replayKeypointName(keypoint: ReplayKeypoint): string | null {
  return MP_KP_NAMES[keypoint[0] as keyof typeof MP_KP_NAMES] ?? null;
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
  /**
   * Captured seconds this clip spans — the span `poses[].t` and `holds[].t` are
   * measured in. The hero plays it over {@link REPLAY_ANIMATION_SECONDS}, so this
   * is what sets the item's playback rate.
   */
  duration: number;
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
  if (typeof v.duration !== "number" || !(v.duration > 0)) return false;

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

/**
 * Read the fetched playlist into the items the hero will cycle through, in file
 * order — the only ordering there is. Anything that fails {@link isReplayItem} is
 * dropped rather than crashing the hero, and the list is capped at
 * {@link REPLAY_PLAYLIST_MAX}; a file that is missing, is not an object, or has no
 * usable items reads as an empty playlist, which degrades the hero to the page's
 * text content.
 *
 * `version` is deliberately not gated on: producer and consumer are the same
 * commit of the same repo, so there is no negotiation to do (see the PRD).
 */
export function readReplayPlaylist(value: unknown): LandingReplayItem[] {
  const items = (value as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return [];
  return items.filter(isReplayItem).slice(0, REPLAY_PLAYLIST_MAX);
}

function isDims(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return typeof d.w === "number" && typeof d.h === "number";
}
