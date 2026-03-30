/**
 * Keypoint indices and skeleton edge definitions for
 * MediaPipe Pose Landmarker (33 keypoints, BlazePose topology).
 *
 * Every renderer and consumer imports from here — never hardcode indices.
 *
 * MediaPipe Pose Landmarker uses the BlazePose 33-keypoint topology:
 * https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
 */

// ---------------------------------------------------------------------------
// Pose backend type
// ---------------------------------------------------------------------------

/**
 * Identifies which pose-detection backend produced a set of keypoints.
 * Only MediaPipe is supported; the type is kept as a literal for
 * backwards-compatibility with stored RouteAttempt data.
 */
export type PoseBackend = "mediapipe";

// ---------------------------------------------------------------------------
// MediaPipe Pose Landmarker (33 BlazePose keypoints)
// ---------------------------------------------------------------------------

export const MP_KP = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export type MediaPipeKeypointIndex = (typeof MP_KP)[keyof typeof MP_KP];

/** Human-readable name for each MediaPipe Pose Landmarker keypoint index. */
export const MP_KP_NAMES: Record<MediaPipeKeypointIndex, string> = {
  [MP_KP.NOSE]: "nose",
  [MP_KP.LEFT_EYE_INNER]: "left_eye_inner",
  [MP_KP.LEFT_EYE]: "left_eye",
  [MP_KP.LEFT_EYE_OUTER]: "left_eye_outer",
  [MP_KP.RIGHT_EYE_INNER]: "right_eye_inner",
  [MP_KP.RIGHT_EYE]: "right_eye",
  [MP_KP.RIGHT_EYE_OUTER]: "right_eye_outer",
  [MP_KP.LEFT_EAR]: "left_ear",
  [MP_KP.RIGHT_EAR]: "right_ear",
  [MP_KP.MOUTH_LEFT]: "mouth_left",
  [MP_KP.MOUTH_RIGHT]: "mouth_right",
  [MP_KP.LEFT_SHOULDER]: "left_shoulder",
  [MP_KP.RIGHT_SHOULDER]: "right_shoulder",
  [MP_KP.LEFT_ELBOW]: "left_elbow",
  [MP_KP.RIGHT_ELBOW]: "right_elbow",
  [MP_KP.LEFT_WRIST]: "left_wrist",
  [MP_KP.RIGHT_WRIST]: "right_wrist",
  [MP_KP.LEFT_PINKY]: "left_pinky",
  [MP_KP.RIGHT_PINKY]: "right_pinky",
  [MP_KP.LEFT_INDEX]: "left_index",
  [MP_KP.RIGHT_INDEX]: "right_index",
  [MP_KP.LEFT_THUMB]: "left_thumb",
  [MP_KP.RIGHT_THUMB]: "right_thumb",
  [MP_KP.LEFT_HIP]: "left_hip",
  [MP_KP.RIGHT_HIP]: "right_hip",
  [MP_KP.LEFT_KNEE]: "left_knee",
  [MP_KP.RIGHT_KNEE]: "right_knee",
  [MP_KP.LEFT_ANKLE]: "left_ankle",
  [MP_KP.RIGHT_ANKLE]: "right_ankle",
  [MP_KP.LEFT_HEEL]: "left_heel",
  [MP_KP.RIGHT_HEEL]: "right_heel",
  [MP_KP.LEFT_FOOT_INDEX]: "left_foot_index",
  [MP_KP.RIGHT_FOOT_INDEX]: "right_foot_index",
};

/** Skeleton edges as [from, to] keypoint index pairs for MediaPipe. */
export const MP_SKELETON_EDGES: [MediaPipeKeypointIndex, MediaPipeKeypointIndex][] = [
  // Face
  [MP_KP.LEFT_EAR, MP_KP.LEFT_EYE_OUTER],
  [MP_KP.LEFT_EYE_OUTER, MP_KP.LEFT_EYE],
  [MP_KP.LEFT_EYE, MP_KP.LEFT_EYE_INNER],
  [MP_KP.LEFT_EYE_INNER, MP_KP.NOSE],
  [MP_KP.NOSE, MP_KP.RIGHT_EYE_INNER],
  [MP_KP.RIGHT_EYE_INNER, MP_KP.RIGHT_EYE],
  [MP_KP.RIGHT_EYE, MP_KP.RIGHT_EYE_OUTER],
  [MP_KP.RIGHT_EYE_OUTER, MP_KP.RIGHT_EAR],
  [MP_KP.MOUTH_LEFT, MP_KP.MOUTH_RIGHT],
  // Torso
  [MP_KP.LEFT_SHOULDER, MP_KP.RIGHT_SHOULDER],
  [MP_KP.LEFT_SHOULDER, MP_KP.LEFT_HIP],
  [MP_KP.RIGHT_SHOULDER, MP_KP.RIGHT_HIP],
  [MP_KP.LEFT_HIP, MP_KP.RIGHT_HIP],
  // Left arm
  [MP_KP.LEFT_SHOULDER, MP_KP.LEFT_ELBOW],
  [MP_KP.LEFT_ELBOW, MP_KP.LEFT_WRIST],
  [MP_KP.LEFT_WRIST, MP_KP.LEFT_PINKY],
  [MP_KP.LEFT_WRIST, MP_KP.LEFT_INDEX],
  [MP_KP.LEFT_WRIST, MP_KP.LEFT_THUMB],
  [MP_KP.LEFT_INDEX, MP_KP.LEFT_PINKY],
  // Right arm
  [MP_KP.RIGHT_SHOULDER, MP_KP.RIGHT_ELBOW],
  [MP_KP.RIGHT_ELBOW, MP_KP.RIGHT_WRIST],
  [MP_KP.RIGHT_WRIST, MP_KP.RIGHT_PINKY],
  [MP_KP.RIGHT_WRIST, MP_KP.RIGHT_INDEX],
  [MP_KP.RIGHT_WRIST, MP_KP.RIGHT_THUMB],
  [MP_KP.RIGHT_INDEX, MP_KP.RIGHT_PINKY],
  // Left leg
  [MP_KP.LEFT_HIP, MP_KP.LEFT_KNEE],
  [MP_KP.LEFT_KNEE, MP_KP.LEFT_ANKLE],
  [MP_KP.LEFT_ANKLE, MP_KP.LEFT_HEEL],
  [MP_KP.LEFT_ANKLE, MP_KP.LEFT_FOOT_INDEX],
  [MP_KP.LEFT_HEEL, MP_KP.LEFT_FOOT_INDEX],
  // Right leg
  [MP_KP.RIGHT_HIP, MP_KP.RIGHT_KNEE],
  [MP_KP.RIGHT_KNEE, MP_KP.RIGHT_ANKLE],
  [MP_KP.RIGHT_ANKLE, MP_KP.RIGHT_HEEL],
  [MP_KP.RIGHT_ANKLE, MP_KP.RIGHT_FOOT_INDEX],
  [MP_KP.RIGHT_HEEL, MP_KP.RIGHT_FOOT_INDEX],
];

/** Total number of MediaPipe Pose Landmarker keypoints. */
export const MEDIAPIPE_KEYPOINT_COUNT = 33;

// ---------------------------------------------------------------------------
// Topology helpers — select the right constants for a given backend
// ---------------------------------------------------------------------------

export interface PoseTopology {
  keypointCount: number;
  keypointNames: Record<number, string>;
  skeletonEdges: [number, number][];
}

/** Return the topology constants for the MediaPipe pose backend. */
export function getTopology(_backend?: PoseBackend): PoseTopology {
  return {
    keypointCount: MEDIAPIPE_KEYPOINT_COUNT,
    keypointNames: MP_KP_NAMES,
    skeletonEdges: MP_SKELETON_EDGES,
  };
}
