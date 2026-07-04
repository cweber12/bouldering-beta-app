// @ts-check
/**
 * Pure projection: a saved RouteAttempt (or its combined-JSON form) → the slim
 * `ReplayData` the landing-page x-ray replay renders.
 *
 * This module is the single source of truth for "attempt → renderer input". It
 * is imported by BOTH the browser runtime (the landing page projecting a
 * signed-in user's latest S3 attempt) and the Node CLI that bakes the bundled
 * default (`scripts/make-landing-demo.mjs`). It is plain ESM JavaScript so the
 * script can import it without a TypeScript build step; the TS side gets types
 * from the JSDoc below (tsconfig `allowJs`).
 *
 * No OpenCV, no MediaPipe, no React — plain JSON in, plain JSON out.
 */

/** @typedef {{ x: number, y: number }} ReplayPoint */
/** @typedef {{ name: string, x: number, y: number, score: number }} ReplayKeypoint */
/** @typedef {{ keypoints: ReplayKeypoint[] }} ReplayPose */
/**
 * @typedef {Object} ReplayData
 * @property {{ w: number, h: number }} aspect  Natural video pixel dimensions.
 * @property {ReplayPoint[]} starfield          Wall ORB keypoints, normalised [0,1].
 * @property {ReplayPose[]} poses               Ordered detected poses, normalised [0,1].
 */

/**
 * Target number of poses baked into the replay. The driver advances one pose
 * per glide (~300 ms), so ~28 poses yields a punchy ~8 s loop regardless of how
 * long the source climb actually was.
 */
export const DEFAULT_MAX_POSES = 28;

/**
 * Round a normalised coordinate to 4 dp to keep the baked JSON small.
 * @param {number} v
 * @returns {number}
 */
function r4(v) {
  return Math.round(v * 1e4) / 1e4;
}

/**
 * Evenly stride a list down to at most `maxPoses` items, always keeping the
 * first and last so the loop spans the whole climb.
 *
 * @template T
 * @param {T[]} items
 * @param {number} maxPoses
 * @returns {T[]}
 */
export function subsamplePoses(items, maxPoses) {
  if (maxPoses <= 0) return [];
  if (items.length <= maxPoses) return items.slice();
  if (maxPoses === 1) return [items[0]];
  const stride = (items.length - 1) / (maxPoses - 1);
  /** @type {T[]} */
  const out = [];
  for (let i = 0; i < maxPoses; i++) out.push(items[Math.round(i * stride)]);
  return out;
}

/**
 * Whether an attempt-shaped object carries the wall feature field the starfield
 * needs. Panning captures store `orbFeatures: null` (they use per-keyframe ORB),
 * so they cannot drive the x-ray and are skipped by callers.
 *
 * @param {any} attempt
 * @returns {boolean}
 */
export function hasStarfield(attempt) {
  const kps = attempt?.orbFeatures?.keypoints;
  return Array.isArray(kps) && kps.length > 0;
}

/**
 * Project an attempt into slim `ReplayData`.
 *
 * Accepts either a live `RouteAttempt` or its serialised combined-JSON form —
 * both expose `videoMeta`, `orbFeatures.keypoints[].pt.{x,y}` (full-frame
 * pixels) and `frames[].keypoints[].{name,x,y,score}` (already normalised).
 *
 * @param {any} attempt
 * @param {{ maxPoses?: number }} [opts]
 * @returns {ReplayData}
 */
export function toReplayData(attempt, opts = {}) {
  const maxPoses = opts.maxPoses ?? DEFAULT_MAX_POSES;
  const width = attempt?.videoMeta?.width || 1;
  const height = attempt?.videoMeta?.height || 1;

  /** @type {Array<{ pt?: { x?: number, y?: number } }>} */
  const orbKeypoints = attempt?.orbFeatures?.keypoints ?? [];
  /** @type {ReplayPoint[]} */
  const starfield = orbKeypoints.map((kp) => ({
    x: r4((kp?.pt?.x ?? 0) / width),
    y: r4((kp?.pt?.y ?? 0) / height),
  }));

  /** @type {Array<{ keypoints?: ReplayKeypoint[] }>} */
  const allFrames = attempt?.frames ?? [];
  const detected = allFrames.filter(
    (f) => Array.isArray(f?.keypoints) && f.keypoints.length > 0,
  );
  /** @type {ReplayPose[]} */
  const poses = subsamplePoses(detected, maxPoses).map((f) => ({
    keypoints: (f.keypoints ?? []).map((kp) => ({
      name: kp.name,
      x: r4(kp.x),
      y: r4(kp.y),
      score: kp.score ?? 1,
    })),
  }));

  return { aspect: { w: width, h: height }, starfield, poses };
}

/**
 * Parse the millisecond timestamp embedded in a run filename
 * (`run-{timestamp}-{attempt|send}.json`, or legacy `attempt-{timestamp}.json`).
 * Returns 0 when no timestamp is present.
 *
 * @param {string} fileName
 * @returns {number}
 */
export function runTimestamp(fileName) {
  const m = fileName.match(/(?:run|attempt)-(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Sort run JSON filenames newest-first by embedded timestamp. Non-run files and
 * heavy `.data.json` siblings are filtered out.
 *
 * @param {string[]} fileNames
 * @returns {string[]}
 */
export function sortRunFilesNewestFirst(fileNames) {
  return fileNames
    .filter((n) => n.endsWith(".json") && !n.endsWith(".data.json"))
    .filter((n) => /(?:run|attempt)-\d+/.test(n))
    .sort((a, b) => runTimestamp(b) - runTimestamp(a));
}
