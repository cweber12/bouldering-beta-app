/**
 * Keypoint indices and skeleton edge definitions for MoveNet (17 keypoints).
 *
 * Every renderer and consumer imports from here — never hardcode indices.
 * If you switch to BlazePose (33 keypoints), add a BLAZEPOSE_* block below
 * and update SKELETON_EDGES to match.
 *
 * MoveNet keypoint order matches the COCO topology:
 * https://github.com/tensorflow/tfjs-models/tree/master/pose-detection#keypoint-diagram
 */

export const KP = {
  NOSE: 0,
  LEFT_EYE: 1,
  RIGHT_EYE: 2,
  LEFT_EAR: 3,
  RIGHT_EAR: 4,
  LEFT_SHOULDER: 5,
  RIGHT_SHOULDER: 6,
  LEFT_ELBOW: 7,
  RIGHT_ELBOW: 8,
  LEFT_WRIST: 9,
  RIGHT_WRIST: 10,
  LEFT_HIP: 11,
  RIGHT_HIP: 12,
  LEFT_KNEE: 13,
  RIGHT_KNEE: 14,
  LEFT_ANKLE: 15,
  RIGHT_ANKLE: 16,
} as const;

export type KeypointIndex = (typeof KP)[keyof typeof KP];

/** Human-readable name for each keypoint index. */
export const KP_NAMES: Record<KeypointIndex, string> = {
  [KP.NOSE]: "nose",
  [KP.LEFT_EYE]: "left_eye",
  [KP.RIGHT_EYE]: "right_eye",
  [KP.LEFT_EAR]: "left_ear",
  [KP.RIGHT_EAR]: "right_ear",
  [KP.LEFT_SHOULDER]: "left_shoulder",
  [KP.RIGHT_SHOULDER]: "right_shoulder",
  [KP.LEFT_ELBOW]: "left_elbow",
  [KP.RIGHT_ELBOW]: "right_elbow",
  [KP.LEFT_WRIST]: "left_wrist",
  [KP.RIGHT_WRIST]: "right_wrist",
  [KP.LEFT_HIP]: "left_hip",
  [KP.RIGHT_HIP]: "right_hip",
  [KP.LEFT_KNEE]: "left_knee",
  [KP.RIGHT_KNEE]: "right_knee",
  [KP.LEFT_ANKLE]: "left_ankle",
  [KP.RIGHT_ANKLE]: "right_ankle",
};

/**
 * Skeleton edges as [from, to] keypoint index pairs.
 * Used by skeletonRenderer to draw limb lines.
 */
export const SKELETON_EDGES: [KeypointIndex, KeypointIndex][] = [
  // Head
  [KP.LEFT_EAR, KP.LEFT_EYE],
  [KP.LEFT_EYE, KP.NOSE],
  [KP.NOSE, KP.RIGHT_EYE],
  [KP.RIGHT_EYE, KP.RIGHT_EAR],
  // Torso
  [KP.LEFT_SHOULDER, KP.RIGHT_SHOULDER],
  [KP.LEFT_SHOULDER, KP.LEFT_HIP],
  [KP.RIGHT_SHOULDER, KP.RIGHT_HIP],
  [KP.LEFT_HIP, KP.RIGHT_HIP],
  // Left arm
  [KP.LEFT_SHOULDER, KP.LEFT_ELBOW],
  [KP.LEFT_ELBOW, KP.LEFT_WRIST],
  // Right arm
  [KP.RIGHT_SHOULDER, KP.RIGHT_ELBOW],
  [KP.RIGHT_ELBOW, KP.RIGHT_WRIST],
  // Left leg
  [KP.LEFT_HIP, KP.LEFT_KNEE],
  [KP.LEFT_KNEE, KP.LEFT_ANKLE],
  // Right leg
  [KP.RIGHT_HIP, KP.RIGHT_KNEE],
  [KP.RIGHT_KNEE, KP.RIGHT_ANKLE],
];

/** Total number of MoveNet keypoints. */
export const MOVENET_KEYPOINT_COUNT = 17;
