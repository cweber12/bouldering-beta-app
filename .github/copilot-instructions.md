# Bouldering Beta — Copilot Instructions

## Stack

| Concern | Version |
|---|---|
| Framework | Next.js **16.2.1** — App Router, `"use client"` boundary, webpack 5 |
| UI | React **19.2.4** |
| Language | TypeScript **strict** — `"module": "esnext"`, `"moduleResolution": "bundler"` |
| Styling | Tailwind CSS v4 |
| Computer vision | `@techstark/opencv-js ^4.12.0` (WASM, main thread synchronous) |
| Pose estimation | TF.js **4.22** + MoveNet Lightning (WebGL backend) |
| Testing | Vitest **^4.1.1** + jsdom + `@testing-library/react ^16.3.2` |
| Path alias | `@/*` → project root |

> **⚠ This is NOT the Next.js you know.** APIs and file conventions may differ from your training data. Read guides in `node_modules/next/dist/docs/` before writing code. Heed deprecation notices.

---

## Architecture

```
pipeline/            Framework-agnostic modules — zero React imports
  orbDetector.ts       extractFeatures(cv, imageData), matchOrbFeatures(cv, ref, query)
  homography.ts        computeHomography(cv, ...), applyHomographyMatrix(h, x, y)
  skeletonOverlay.ts   buildTransformedKeypoints(), drawSkeleton()
  poseDetection.ts     estimateFrame()
  poseVideoRenderer.ts renderPoseVideo() — MediaRecorder + canvas.captureStream

hooks/               React hooks — own state transitions, no direct OpenCV allocation
  useOpenCV.ts         exposes { ready, cv }
  useTFModel.ts        exposes { ready, model }
  useVideoProcessor.ts seek loop → pose estimation → ORB extraction → orbStatus
  useImageMatcher.ts   image File → extractFeatures → matchOrbFeatures
  usePoseVideo.ts      matchResult → renderPoseVideo → videoUrl

storage/
  sessionStore.ts      in-memory Map; re-exports all ORB types from orbDetector

utils/
  poseConstants.ts     KP indices, KP_NAMES, SKELETON_EDGES (COCO topology)
  cvHelpers.ts

workers/             Legacy — keep, do not delete
```

---

## Non-negotiable Rules

### OpenCV
- Runs **synchronously on the main thread** via `cv` from `useOpenCV`.
- **Never** create WASM inside a Worker — `onRuntimeInitialized` is unreliable in worker scope.
- Every OpenCV allocation **must** be freed in a `finally` block.
- Pass `cv` explicitly as a function parameter — never read from `window`.

### pipeline/ boundary
- Zero React imports in `pipeline/`.
- All pipeline functions take `cv` as their first argument (`type CV = any`).
- All pipeline functions are synchronous.

### Hooks
- Hooks call pipeline functions and own React state/error boundaries.
- `useVideoProcessor` exposes `orbStatus: "idle" | "extracting" | "ready" | "failed"`.
- `imageFile` state lives in the parent component; hooks receive it as a parameter.

### TypeScript
- `any` is only permitted for `type CV = any` and `type PoseDetector = any`.
- Never use `any` elsewhere. Never disable `tsc` checks.

### Testing
- Test files mirror source tree under `__tests__/`.
- Use `vi.stubGlobal` / `vi.unstubAllGlobals()` for DOM globals.
- `ImageData` not in jsdom — cast plain objects: `{ data, width, height, colorSpace } as ImageData`.
- Mock `pipeline/orbDetector` or `pipeline/homography` at module boundary — never exercise WASM directly.

---

## Post-change Checklist (run in order)

```powershell
npx tsc --noEmit              # zero output = success
npx vitest run                # all tests must pass
npx vitest run --coverage     # check new files appear in report
npx eslint .                  # no new lint errors
git add .
git commit -m "<message>"     # see Commit Convention below
git push
```

New `pipeline/` and `hooks/` files must have corresponding `__tests__/` coverage.

**After every code change: always run `git add .`, `git commit`, and `git push`
automatically — do not wait for the user to ask.**

---

## Commit Convention

```
<type>: <imperative summary ≤72 chars>

- bullet: what changed
- bullet: why
```

Types: `feat` `fix` `refactor` `test` `chore`
