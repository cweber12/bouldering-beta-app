# pipeline/

Framework-agnostic processing modules. **Zero React imports.** All functions are synchronous and accept `cv` as their first argument.

## Folder structure

Modules are grouped by concern. Import paths follow the folder, e.g. `@/pipeline/pose/poseDetection`.

```text
pipeline/
  pose/       poseDetection, mediapipePoseDetection, poseInterpolator, flipDetection
  tracking/   cropDetector, climberTracker, tapCropDetection, routeCropEstimator
  matching/   orbDetector, homography, orbThumbnail
  analysis/   frameAnalyzer, framePreprocessor, diagnostics
  holds/      holdDetection, holdsOverlay
  overlay/    skeletonOverlay, skeletonRenderer
  render/     poseVideoRenderer, multiPoseVideoRenderer, overlayVideoRecorder
  legacy/     orbFeatures, orbMatcher   (unused worker files, kept for reference)
```

## Modules

### `analysis/framePreprocessor.ts`

Lighting-condition-specific preprocessing applied to the pose-detection canvas before each
MediaPipe inference. The ORB background canvas is never touched.

| Export | Signature | Description |
|---|---|---|
| `applyFramePreprocessing` | `(cv, canvas, conditions) → void` | Modifies the canvas in-place based on the selected condition flags. No-op when `conditions` is empty or contains no recognized keys. |

Supported conditions and their effect:

| `conditions` value | Processing | Purpose |
|---|---|---|
| `washed_out` | equalizeHist blend (40 %) | Restores global contrast in overexposed regions |
| `backlit` | equalizeHist blend (40 %) + gamma γ=1.4 | Improves contrast then lifts midtones to reduce silhouette effect |
| `shadows` | equalizeHist blend (60 %) | Stronger enhancement for dark regions |
| `blends` | equalizeHist blend (40 %) | Improves climber/wall edge separation |
| `indoor_gym` | pre-blur (σ=3) + equalizeHist blend (40 %) | Evens fluorescent hot-spots then boosts contrast |
| `dusty` | Unsharp mask σ=1.5 | Restores edge clarity from lens fog or chalk |

Multiple conditions combine: contrast enhancement and unsharp masking are applied in sequence when both are selected.

### `matching/orbDetector.ts`

ORB feature detection and matching via OpenCV.js.

| Export | Signature | Description |
|---|---|---|
| `extractFeatures` | `(cv, imageData, normalizePixels?) → OrbFeatures` | Detect ORB keypoints and compute descriptors. When `normalizePixels` is `true` (default), applies histogram equalisation before detection to align intensity distributions between the video reference frame and an uploaded photo. |
| `matchOrbFeatures` | `(cv, ref, query) → OrbMatch[]` | BFMatcher + Lowe ratio test (0.7). Returns passing matches. |

Types exported: `OrbKeypoint`, `OrbFeatures`, `OrbMatch`.

### `matching/homography.ts`

Perspective transform computation and application.

| Export | Signature | Description |
|---|---|---|
| `computeHomography` | `(cv, ref, query, matches) → Mat \| null` | RANSAC homography from ORB correspondences. Returns `null` when fewer than 4 matches. |
| `applyHomographyMatrix` | `(h, x, y) → {x, y}` | Project a single 2-D point through a homography matrix. |

### `pose/poseDetection.ts`

Pose-frame vocabulary. Holds only the `PoseFrame` / `Keypoint` types shared by
every downstream module. Detection itself lives in `mediapipePoseDetection.ts`
(`estimateFramesMediaPipe` / `estimateFrameMediaPipe`).

Types exported: `PoseFrame`, `Keypoint`.

### `overlay/skeletonOverlay.ts`

Draw the skeleton on a canvas for a single frame.

| Export | Signature | Description |
|---|---|---|
| `buildTransformedKeypoints` | `(frame, homography, imgW, imgH) → Keypoint[]` | Re-project keypoints through the homography. |
| `drawSkeleton` | `(ctx, keypoints) → void` | Draw bones and joints using SKELETON_EDGES topology. |

### `tracking/cropDetector.ts`

Hip-centred crop geometry for outdoor mode.

| Export | Signature | Description |
|---|---|---|
| `getCropBox` | `(frame, videoW, videoH, margin?) → CropBox \| null` | Compute crop centred on mid-hip from a pose frame. |
| `cropImageData` | `(imageData, box) → ImageData` | Slice an ImageData to the given CropBox. |
| `projectKeypointsToFrame` | `(frame, box) → PoseFrame` | Re-project crop-relative keypoints back to full-frame coordinates. |

Types exported: `CropBox`.

### `pose/poseInterpolator.ts`

Linear interpolation for outdoor mode gap-filling.

| Export | Signature | Description |
|---|---|---|
| `interpolateFrames` | `(detected, totalCount) → PoseFrame[]` | Fill `totalCount` frames from sparsely detected frames. |

### `render/poseVideoRenderer.ts`

Render an annotated WebM video from processed frames.

| Export | Signature | Description |
|---|---|---|
| `renderPoseVideo` | `(options) → Promise<string>` | Draw skeleton overlay on route photo for every frame; encode via `MediaRecorder`; return object URL. |

### `render/overlayVideoRecorder.ts`

Shared WebM recorder behind both `renderPoseVideo` and `renderMultiPoseVideo`.
Owns the `MediaRecorder` lifecycle, MIME selection, real-time-paced output loop,
single-run cleanup, and blob-URL production. Each renderer supplies only a
per-frame `drawFrame(frameIndex, timestampSec)`.

| Export | Signature | Description |
|---|---|---|
| `recordOverlayVideo` | `({ canvas, fps, totalFrames, firstTimestamp, drawFrame, onProgress?, onCleanup? }) → Promise<string>` | Capture `canvas` to a WebM blob, calling `drawFrame` per output frame; return object URL. |

## Rules

- No `async` — all OpenCV calls are synchronous.
- Every OpenCV allocation must be freed in a `finally` block.
- Pass `cv` explicitly — never read from `window`.
- `type CV = any` is the only permitted `any`.
