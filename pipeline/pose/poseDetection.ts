/**
 * Pose-frame vocabulary: the Keypoint / PoseFrame types shared by every
 * downstream pipeline module.
 *
 * Pose *detection* lives in `pipeline/mediapipePoseDetection.ts`
 * (`estimateFramesMediaPipe` / `estimateFrameMediaPipe`). This module holds only
 * the data types those functions produce, so the many modules that pass poses
 * around depend on the shape, not on any specific backend.
 *
 * A second pose backend is possible but not implemented: the `PoseBackend` seam
 * marker and the backend-parameterised topology helpers live in
 * `utils/poseConstants.ts`. When a real second backend lands, add a dispatcher
 * there with actual branching — not an ignored parameter.
 *
 * This module is framework-agnostic — no React imports. Keep it that way.
 */

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

export type PoseFrameSource =
  | "raw"
  | "interpolated"
  | "filled"
  | "flipDiscarded"
  | "limbExpanded";

export interface PoseFrame {
  /** Video timestamp in seconds. */
  timestamp: number;
  /** Provenance for scanner-exported corpus frames. Missing on legacy persisted runs. */
  source?: PoseFrameSource;
  /** Filtered keypoints for this frame. Empty if no pose was detected. */
  keypoints: Keypoint[];
}
