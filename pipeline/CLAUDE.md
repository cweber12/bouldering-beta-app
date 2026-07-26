# Pipeline Rules

Scoped instructions for `pipeline/` work (and its tests under `__tests__/pipeline/`). General rules live in the root `CLAUDE.md` / `AGENTS.md` and still apply.

Note: `pipeline/` is not scan-only — the compare page runs the identical pipeline through two `CompareSlot` components.

## Module map

```
pipeline/        Framework-agnostic processing modules (NO React imports), grouped by concern
  pose/      poseDetection (Keypoint / PoseFrame types), mediapipePoseDetection
             (estimateFramesMediaPipe / estimateFrameMediaPipe), poseInterpolator, flipDetection
  tracking/  cropDetector, climberTracker, tapCropDetection, routeCropEstimator
  matching/  orbDetector (extractFeatures, matchOrbFeatures), homography
             (computeHomography, applyHomographyMatrix), orbThumbnail
  analysis/  frameAnalyzer, framePreprocessor, diagnostics
  holds/     holdDetection, holdsOverlay
  overlay/   skeletonOverlay (buildTransformedKeypoints, drawSkeleton), skeletonRenderer
  render/    poseVideoRenderer (renderPoseVideo — MediaRecorder + canvas.captureStream),
             multiPoseVideoRenderer, overlayVideoRecorder
  legacy/    orbFeatures, orbMatcher — legacy worker files, not used
```

## Pipeline execution chain

```
Video frame (ImageData)
  └─ mediapipePoseDetection.ts  estimateFramesMediaPipe()  → PoseFrame[]  (sparse)
       └─ poseInterpolator.ts  interpolatePoseFrames()  → dense PoseFrame[]
            └─ poseInterpolator.ts  smoothPoseFrames()      → smoothed PoseFrame[]
                 └─ skeletonRenderer.ts  buildSkeletonFrameData()
                      └─ skeletonOverlay.ts  buildTransformedKeypoints()
                           └─ (homography applied per keypoint via homography.ts)

Route photo (ImageData)
  └─ orbDetector.ts  extractFeatures()   → OrbFeatures  (video frame 0)
       └─ orbDetector.ts  matchFeatures()    → OrbMatch[]
            └─ homography.ts  computeHomography()  → Float64Array | null (3×3)
```

## OpenCV (`cv`)

- OpenCV runs **synchronously on the main thread** via the `cv` object from `useOpenCV`.
- **Never** create a new WASM runtime inside a Worker — the WASM bootstrap is async and unreliable in worker scope (`importScripts` returns before `onRuntimeInitialized` fires).
- Every function that allocates OpenCV objects **must** free them in a `finally` block.
- Thread `cv` explicitly as a function parameter — never read it from global/window state.

## Pipeline modules

- Files in `pipeline/` must have **zero React imports**. Keep framework boundary clean.
- All `pipeline/` functions accept `cv` as their first argument (or `CV = any` typed alias).
- No `async` inside pipeline modules — all OpenCV calls are synchronous.
- `eslint-disable-next-line @typescript-eslint/no-explicit-any` is acceptable **only** for `type CV = any` and `type PoseDetector = any` (WASM bindings have no TS types).

## Model singletons

`usePoseModel` and `useOpenCV` both use module-level caches so the WASM runtimes are initialised once per page load regardless of how many components mount. `usePoseModel` additionally queues listeners so concurrent mounts resolve from the same promise without double-loading.

## Testing pipeline code

- `ImageData` not available in jsdom — use plain object casts: `{ data, width, height, colorSpace } as ImageData`.
- OpenCV calls are never tested directly — mock `pipeline/orbDetector` or `pipeline/homography` at the module boundary.
- `FakeOrbWorker.prototype.postMessage` save/restore prevents prototype pollution between tests.
