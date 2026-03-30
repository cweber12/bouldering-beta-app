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
| Pose estimation | `@mediapipe/tasks-vision ^0.10.34` (MediaPipe Pose Landmarker, GPU delegate) |
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
  poseDetection.ts   estimateFrameUnified()
  poseVideoRenderer.ts  renderPoseVideo() — MediaRecorder + canvas.captureStream
  [orbFeatures.ts / orbMatcher.ts / orbWorker.js]  legacy worker files, not used

hooks/           React hooks that wire pipeline modules to UI state
  useOpenCV.ts     loads /public/opencv.js; exposes { ready, cv }
  usePoseModel.ts  loads MediaPipe Pose Landmarker; exposes { ready, model }
  useVideoProcessor.ts  seek loop → pose estimation → ORB extraction
  useImageMatcher.ts    upload image → extractFeatures → matchOrbFeatures
  usePoseVideo.ts  auto-renders annotated WebM from match result

storage/
  sessionStore.ts  in-memory Map; exports RunType, RouteAttempt (includes runType, rating?, notes?)

utils/
  poseConstants.ts  MP_KP indices, MP_KP_NAMES, MP_SKELETON_EDGES (MediaPipe/BlazePose topology)
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
- `proxy.ts` refreshes the session on every request and protects `/upload`, `/match`, `/compare` routes (redirect to `/login`).
- `hooks/useAuth.tsx` provides `AuthProvider` context + `useAuth()` hook. **File must stay `.tsx`** — it contains JSX.
- All S3 API routes call `getAuthUserId()` and return 401 when unauthenticated.
- `isValidKey()` and `isValidPrefix()` enforce that every S3 key is scoped to the authenticated user: `RouteData/{userId}/...`.
- `hooks/useS3Storage.ts` derives user-scoped keys via `deriveS3Key(userId, attempt)`.
- `components/shared/NavBar.tsx` shows `PUBLIC_TABS` (Home, Docs) for unauthenticated users and `AUTH_TABS` (all tabs) for authenticated users.

### Testing
- Test files mirror the source tree under `__tests__/`.
- Use `vi.stubGlobal` + `vi.unstubAllGlobals()` in afterEach for DOM globals.
- `ImageData` not available in jsdom — use plain object casts: `{ data, width, height, colorSpace } as ImageData`.
- OpenCV calls are never tested directly — mock `pipeline/orbDetector` or `pipeline/homography` at the module boundary.
- `FakeOrbWorker.prototype.postMessage` save/restore prevents prototype pollution between tests.

---

## Security Review Checklist

When adding or changing code, verify the following:

- **Open redirect** — Any `router.push(url)` or `redirect(url)` using user-supplied input must validate the target is a relative path (`startsWith("/")`, not `startsWith("//")`, no `://`).
- **User-scoped data** — Every S3 key or prefix must include the authenticated user ID. Server-side API routes must call `isValidKey(key, userId)` / `isValidPrefix(prefix, userId)` before any S3 operation.
- **Input length limits** — User-supplied strings (state, area, route names, notes) must be length-limited before storage. S3 keys must not exceed 1024 bytes.
- **Error sanitisation** — AWS/infrastructure error details must not be returned to the client in production. Use `awsErrorMessage()` which logs details server-side and returns a generic message.
- **Auth gating** — Protected routes (`/upload`, `/match`, `/compare`) must be guarded by `proxy.ts`. API routes must call `getAuthUserId()` and return 401 when null.
- **File extensions** — Any file containing JSX must use `.tsx` (not `.ts`). Verify after renaming or creating hook/component files.
- **Cookie security** — Supabase cookies use `SameSite` and `Secure` attributes. Never store tokens in `localStorage`.
- **No secrets in client code** — Only `NEXT_PUBLIC_*` env vars may be referenced in client components. AWS credentials and `SUPABASE_SERVICE_ROLE_KEY` must stay server-side.

---

## After Every Code Change

Run these checks in order, then commit and push without prompting the user:

```powershell
# 1. Type-check (zero output = success)
npx tsc --noEmit

# 2. Full test suite
npx vitest run

# 3. Coverage (target: all pipeline/ and hooks/ files appear in report)
npx vitest run --coverage

# 4. Lint
npx eslint .

# 5. Stage, commit, and push
git add .
git commit -m "<type>: <summary>

<body bullets>"
git push
```

Review the coverage report for any new source files not covered by tests.
Fix TypeScript errors before proceeding. Do not disable tsc checks.

**The agent MUST run `git add .`, `git commit -m "..."`, and `git push` automatically
after every code change session without waiting to be asked.**

### README maintenance
- When a code change adds, removes, or renames user-visible features, pages,
  storage formats, or API behaviour, update `README.md` in the same commit.
- Keep the S3 key format example, Pages table, and feature summary in the README
  consistent with the actual code.

---

## Commit Message Convention

```
<type>: <imperative summary under 72 chars>

<body — what changed and why, bullet points>
```

Types: `feat`, `fix`, `refactor`, `test`, `chore`
<!-- END:nextjs-agent-rules -->
