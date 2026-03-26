<!-- BEGIN:nextjs-agent-rules -->
# Bouldering Beta — Agent Rules

## Stack Snapshot

| Concern | Library / Version |
|---|---|
| Framework | Next.js **16.2.1** — App Router, `"use client"` boundary, webpack 5 |
| UI | React **19.2.4** |
| Language | TypeScript **strict**, `"module": "esnext"`, `"moduleResolution": "bundler"` |
| Styling | Tailwind CSS v4 |
| Computer vision | `@techstark/opencv-js ^4.12.0` (WASM, main thread only) |
| Pose estimation | TF.js **4.22**  + `@tensorflow-models/pose-detection ^2.1.3` (MoveNet Lightning, WebGL) |
| Testing | Vitest **^4.1.1** + jsdom + `@testing-library/react ^16.3.2` |
| Path alias | `@/*` → project root |

> **⚠ This is NOT the Next.js you know.** APIs, conventions and file structure
> may all differ from training data. Read the relevant guide in
> `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

---

## Project Architecture

```
pipeline/        Framework-agnostic processing modules (NO React imports)
  orbDetector.ts   extractFeatures(cv, imageData), matchOrbFeatures(cv, ref, query)
  homography.ts    computeHomography(), applyHomographyMatrix()
  skeletonOverlay.ts  buildTransformedKeypoints(), drawSkeleton()
  poseDetection.ts   estimateFrame()
  poseVideoRenderer.ts  renderPoseVideo() — MediaRecorder + canvas.captureStream
  [orbFeatures.ts / orbMatcher.ts / orbWorker.js]  legacy worker files, not used

hooks/           React hooks that wire pipeline modules to UI state
  useOpenCV.ts     loads /public/opencv.js; exposes { ready, cv }
  useTFModel.ts    loads MoveNet Lightning; exposes { ready, model }
  useVideoProcessor.ts  seek loop → pose estimation → ORB extraction
  useImageMatcher.ts    upload image → extractFeatures → matchOrbFeatures
  usePoseVideo.ts  auto-renders annotated WebM from match result

storage/
  sessionStore.ts  in-memory Map; all ORB types re-exported from orbDetector

utils/
  poseConstants.ts  KP indices, KP_NAMES, SKELETON_EDGES (MoveNet/COCO topology)
  cvHelpers.ts

workers/         Legacy Web Worker files (keep, do not delete)
```

---

## Critical Coding Rules

### OpenCV (`cv`)
- OpenCV runs **synchronously on the main thread** via the `cv` object from `useOpenCV`.
- **Never** create a new WASM runtime inside a Worker — the WASM bootstrap is async and unreliable in worker scope (`importScripts` returns before `onRuntimeInitialized` fires).
- Every function that allocates OpenCV objects **must** free them in a `finally` block.
- Thread `cv` explicitly as a function parameter — never read it from global/window state.

### Pipeline modules
- Files in `pipeline/` must have **zero React imports**. Keep framework boundary clean.
- All `pipeline/` functions accept `cv` as their first argument (or `CV = any` typed alias).
- No `async` inside pipeline modules — all OpenCV calls are synchronous.

### Hooks
- Hooks consume pipeline functions; they own state transitions and error boundaries.
- Expose `orbStatus: "idle" | "extracting" | "ready" | "failed"` from `useVideoProcessor` so the UI never shows image upload until ORB extraction has completed.
- `imageFile` state lives in the parent component and is passed to `usePoseVideo` — hooks do not own File objects.

### TypeScript
- `eslint-disable-next-line @typescript-eslint/no-explicit-any` is acceptable **only** for `type CV = any` and `type PoseDetector = any` (WASM bindings have no TS types).
- Never use `any` elsewhere.

### Testing
- Test files mirror the source tree under `__tests__/`.
- Use `vi.stubGlobal` + `vi.unstubAllGlobals()` in afterEach for DOM globals.
- `ImageData` not available in jsdom — use plain object casts: `{ data, width, height, colorSpace } as ImageData`.
- OpenCV calls are never tested directly — mock `pipeline/orbDetector` or `pipeline/homography` at the module boundary.
- `FakeOrbWorker.prototype.postMessage` save/restore prevents prototype pollution between tests.

---

## After Every Code Change

Run these checks in order before committing:

```powershell
# 1. Type-check (zero output = success)
npx tsc --noEmit

# 2. Full test suite
npx vitest run

# 3. Coverage (target: all pipeline/ and hooks/ files appear in report)
npx vitest run --coverage
```

Review the coverage report for any new source files not covered by tests.
Fix TypeScript errors before proceeding. Do not disable tsc checks.

---

## Commit Message Convention

```
<type>: <imperative summary under 72 chars>

<body — what changed and why, bullet points>
```

Types: `feat`, `fix`, `refactor`, `test`, `chore`
<!-- END:nextjs-agent-rules -->
