# pipeline/

Framework-agnostic processing modules. **Zero React imports.** All functions are synchronous and accept `cv` as their first argument.

## Modules

### `orbDetector.ts`

ORB feature detection and matching via OpenCV.js.

| Export | Signature | Description |
|---|---|---|
| `extractFeatures` | `(cv, imageData) → OrbFeatures` | Detect ORB keypoints and compute descriptors from a frame. |
| `matchOrbFeatures` | `(cv, ref, query) → OrbMatch[]` | BFMatcher + Lowe ratio test (0.7). Returns passing matches. |

Types exported: `OrbKeypoint`, `OrbFeatures`, `OrbMatch`.

### `homography.ts`

Perspective transform computation and application.

| Export | Signature | Description |
|---|---|---|
| `computeHomography` | `(cv, ref, query, matches) → Mat \| null` | RANSAC homography from ORB correspondences. Returns `null` when fewer than 4 matches. |
| `applyHomographyMatrix` | `(h, x, y) → {x, y}` | Project a single 2-D point through a homography matrix. |

### `poseDetection.ts`

MoveNet inference wrapper.

| Export | Signature | Description |
|---|---|---|
| `estimateFrame` | `(model, canvas) → Promise<PoseFrame>` | Run MoveNet Lightning on an offscreen canvas; returns 17 keypoints. |

Types exported: `PoseFrame`, `Keypoint`.

### `skeletonOverlay.ts`

Draw the skeleton on a canvas for a single frame.

| Export | Signature | Description |
|---|---|---|
| `buildTransformedKeypoints` | `(frame, homography, imgW, imgH) → Keypoint[]` | Re-project keypoints through the homography. |
| `drawSkeleton` | `(ctx, keypoints) → void` | Draw bones and joints using SKELETON_EDGES topology. |

### `cropDetector.ts`

Hip-centred crop geometry for outdoor mode.

| Export | Signature | Description |
|---|---|---|
| `getCropBox` | `(frame, videoW, videoH, margin?) → CropBox \| null` | Compute crop centred on mid-hip from a pose frame. |
| `cropImageData` | `(imageData, box) → ImageData` | Slice an ImageData to the given CropBox. |
| `projectKeypointsToFrame` | `(frame, box) → PoseFrame` | Re-project crop-relative keypoints back to full-frame coordinates. |

Types exported: `CropBox`.

### `poseInterpolator.ts`

Linear interpolation for outdoor mode gap-filling.

| Export | Signature | Description |
|---|---|---|
| `interpolateFrames` | `(detected, totalCount) → PoseFrame[]` | Fill `totalCount` frames from sparsely detected frames. |

### `poseVideoRenderer.ts`

Render an annotated WebM video from processed frames.

| Export | Signature | Description |
|---|---|---|
| `renderPoseVideo` | `(options) → Promise<string>` | Draw skeleton overlay on route photo for every frame; encode via `MediaRecorder`; return object URL. |

## Rules

- No `async` — all OpenCV calls are synchronous.
- Every OpenCV allocation must be freed in a `finally` block.
- Pass `cv` explicitly — never read from `window`.
- `type CV = any` is the only permitted `any`.
