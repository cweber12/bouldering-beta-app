/**
 * Thin wrapper around the TF.js pose-detection model call.
 *
 * Accepts a canvas element (drawn from a video frame) and returns an array
 * of normalized keypoints with confidence scores, filtered by minScore.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoseDetector = any;

export interface Keypoint {
  /** Keypoint name (e.g. "left_wrist"). */
  name: string;
  /** X position normalized to [0, 1] relative to the frame width. */
  x: number;
  /** Y position normalized to [0, 1] relative to the frame height. */
  y: number;
  /** Model confidence score in [0, 1]. */
  score: number;
}

export interface PoseFrame {
  /** Video timestamp in seconds. */
  timestamp: number;
  /** Filtered keypoints for this frame. Empty if no pose was detected. */
  keypoints: Keypoint[];
}

const DEFAULT_MIN_SCORE = 0.3;

/**
 * Run pose estimation on a single video frame canvas.
 *
 * @param detector  - The loaded TF.js PoseDetector instance.
 * @param canvas    - A canvas element containing the current video frame pixels.
 * @param timestamp - The video timestamp (seconds) this frame corresponds to.
 * @param minScore  - Keypoints below this confidence threshold are dropped.
 * @returns A PoseFrame, or null if the model returned no poses.
 */
export async function estimateFrame(
  detector: PoseDetector,
  canvas: HTMLCanvasElement,
  timestamp: number,
  minScore: number = DEFAULT_MIN_SCORE,
): Promise<PoseFrame | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poses: any[] = await detector.estimatePoses(canvas, {
    maxPoses: 1,
    flipHorizontal: false,
  });

  if (!poses.length || !poses[0].keypoints?.length) return null;

  const raw = poses[0].keypoints;
  const frameW = canvas.width;
  const frameH = canvas.height;

  const keypoints: Keypoint[] = raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((kp: any) => (kp.score ?? 0) >= minScore)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((kp: any) => ({
      name: kp.name ?? "",
      // MoveNet returns pixel coords — normalize to [0,1].
      x: kp.x / frameW,
      y: kp.y / frameH,
      score: kp.score ?? 0,
    }));

  return { timestamp, keypoints };
}
