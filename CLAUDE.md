# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

## Commands

```bash
# Local dev server
npm run dev

# Type-check (zero output = passing)
npx tsc --noEmit

# Run all tests
npx vitest run

# Run a single test file
npx vitest run __tests__/pipeline/orbDetector.test.ts

# Run tests in watch mode
npx vitest

# Coverage report
npx vitest run --coverage

# Lint
npx eslint .

# Format
npm run format

# Fetch OpenCV WASM (required once after clone, or after deleting public/opencv.js)
node scripts/fetch-opencv.mjs
```

---

## Architecture: How the pieces connect

### Scan page flow (app/scan/)
The scan page is a multi-step wizard. Each step is a component under `components/scan/process-flow/`:

1. **StepPickVideo** — user selects or records a video (camera modal). The video is stored only in React state; nothing hits S3 yet.
2. **StepSetDetection** — user draws a crop box over the climber. `CropBoxOverlay` writes fractional coordinates; `useVideoProcessor` drives the seek loop that feeds frames to `poseDetection.ts → estimateFrameUnified()`.
3. **StepViewLandmarks** — shows the sparse pose frames, lets the user trim/review. `useSkeletonFrames` pre-computes `SkeletonFrameData` from those frames.
4. **StepMatchRoutePhoto** — user uploads a route photo. `useImageMatcher` calls `extractFeatures` (ORB on the first video frame) then `matchFeatures`, then `computeHomography` to find the perspective transform from video-space to photo-space.
5. **Save flow** — `usePoseVideo` auto-renders an annotated WebM using `poseVideoRenderer.ts` (MediaRecorder + canvas.captureStream). `MetadataBottomSheet` collects route name / location / run type. `useS3Storage.uploadAttempt` serialises via `fsHelpers.ts` and POSTs to `/api/s3/put`.

### Compare page flow (app/compare/)
Two `CompareSlot` components each independently run the scan pipeline. `CompareOverlayPlayer` time-syncs both skeleton overlays using `multiPoseVideoRenderer.ts`.

### Pipeline execution chain
```
Video frame (ImageData)
  └─ poseDetection.ts  estimateFrameUnified()      → PoseFrame[]  (sparse)
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

### Auth flow
Firebase Auth (client) → `signIn()` in `useAuth.tsx` → exchange ID token for HTTP-only session cookie via `POST /api/auth/session` → `middleware.ts` (proxy.ts) validates the cookie on every protected route request using the Supabase server client → API routes call `getAuthUserId()` which re-validates server-side.

### S3 access control
Every `/api/s3/*` route calls `getAuthUserId()` (returns 401 if missing), then `isValidKey(key, userId)` or `isValidPrefix(prefix, userId)` before any AWS SDK call. Keys are always `RouteData/{userId}/...` so one user can never read or write another's data.

### Model singletons
`usePoseModel` and `useOpenCV` both use module-level caches so the WASM runtimes are initialised once per page load regardless of how many components mount. `usePoseModel` additionally queues listeners so concurrent mounts resolve from the same promise without double-loading.
