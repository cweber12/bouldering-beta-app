# Bouldering Beta — Copilot Instructions

## Stack

| Concern | Version |
|---|---|
| Framework | Next.js **16.2.1** — App Router, `"use client"` boundary, webpack 5 |
| UI | React **19.2.4** |
| Language | TypeScript **strict** — `"module": "esnext"`, `"moduleResolution": "bundler"` |
| Styling | Tailwind CSS v4 |
| Computer vision | `@techstark/opencv-js ^4.12.0` (WASM, main thread synchronous) |
| Pose estimation | `@mediapipe/tasks-vision ^0.10.34` (MediaPipe Pose Landmarker, GPU delegate) |
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
  poseDetection.ts     estimateFrameUnified()
  poseVideoRenderer.ts renderPoseVideo() — MediaRecorder + canvas.captureStream

hooks/               React hooks — own state transitions, no direct OpenCV allocation
  useOpenCV.ts         exposes { ready, cv }
  usePoseModel.ts      exposes { ready, model }
  useVideoProcessor.ts seek loop → pose estimation → ORB extraction → orbStatus
  useImageMatcher.ts   image File → extractFeatures → matchOrbFeatures
  usePoseVideo.ts      matchResult → renderPoseVideo → videoUrl

storage/
  sessionStore.ts      in-memory Map; re-exports all ORB types from orbDetector
                       exports RunType ("attempt" | "send"), RouteAttempt includes runType, rating?, notes?

utils/
  poseConstants.ts     MP_KP indices, MP_KP_NAMES, MP_SKELETON_EDGES (MediaPipe/BlazePose topology)
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

### Run classification & S3 key format
- `RouteAttempt.runType` is `"attempt" | "send"` (re-exported as `RunType`).
- Optional `rating?: string` and `notes?: string` are stored alongside each run.
- S3 key format: `RouteData/{userId}/{state}/{area}/{route}/run-{timestamp}-{attempt|send}.json`.
- ID format: `run-{timestamp}` (without the type suffix).
- Legacy `attempt-{timestamp}.json` files are still loadable — default `runType` to `"attempt"`.
- UI colours: amber for attempts, emerald for sends.

### Authentication (Supabase)
- Auth uses `@supabase/ssr` with cookie-based sessions (no localStorage tokens).
- `utils/supabase/client.ts` — browser client (`createBrowserClient`).
- `utils/supabase/server.ts` — server client (`createServerClient` with cookie jar from `next/headers`).
- `middleware.ts` refreshes the session on every request and protects `/upload`, `/match`, `/compare` routes (redirect to `/login`).
- `hooks/useAuth.tsx` provides `AuthProvider` context + `useAuth()` hook. **File must stay `.tsx`** — it contains JSX.
- All S3 API routes call `getAuthUserId()` and return 401 when unauthenticated.
- `isValidKey()` and `isValidPrefix()` enforce that every S3 key is scoped to the authenticated user: `RouteData/{userId}/...`.
- `hooks/useS3Storage.ts` derives user-scoped keys via `deriveS3Key(userId, attempt)`.
- `components/shared/NavBar.tsx` shows `PUBLIC_TABS` (Home, Docs) for unauthenticated users and `AUTH_TABS` (all tabs) for authenticated users.

---

## Security Review Checklist

When adding or changing code, verify the following:

- **Open redirect** — Any `router.push(url)` or `redirect(url)` using user-supplied input must validate the target is a relative path (`startsWith("/")`, not `startsWith("//")`, no `://`).
- **User-scoped data** — Every S3 key or prefix must include the authenticated user ID. Server-side API routes must call `isValidKey(key, userId)` / `isValidPrefix(prefix, userId)` before any S3 operation.
- **Input length limits** — User-supplied strings (state, area, route names, notes) must be length-limited before storage. S3 keys must not exceed 1024 bytes.
- **Error sanitisation** — AWS/infrastructure error details must not be returned to the client in production. Use `awsErrorMessage()` which logs details server-side and returns a generic message.
- **Auth gating** — Protected routes (`/upload`, `/match`, `/compare`) must be guarded by `middleware.ts`. API routes must call `getAuthUserId()` and return 401 when null.
- **File extensions** — Any file containing JSX must use `.tsx` (not `.ts`). Verify after renaming or creating hook/component files.
- **Cookie security** — Supabase cookies use `SameSite` and `Secure` attributes. Never store tokens in `localStorage`.
- **No secrets in client code** — Only `NEXT_PUBLIC_*` env vars may be referenced in client components. AWS credentials and `SUPABASE_SERVICE_ROLE_KEY` must stay server-side.

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

### README maintenance
- When a code change adds, removes, or renames user-visible features, pages,
  storage formats, or API behaviour, update `README.md` in the same commit.
- Keep the S3 key format example, Pages table, and feature summary in the README
  consistent with the actual code.

---

## Commit Convention

```
<type>: <imperative summary ≤72 chars>

- bullet: what changed
- bullet: why
```

Types: `feat` `fix` `refactor` `test` `chore`
