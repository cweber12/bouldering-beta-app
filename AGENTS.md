<!-- BEGIN:nextjs-agent-rules -->

# Bouldering Beta — Agent Rules

## Stack Snapshot

| Concern         | Library / Version                                                            |
| --------------- | ---------------------------------------------------------------------------- |
| Framework       | Next.js **16.2.1** — App Router, `"use client"` boundary, webpack 5          |
| UI              | React **19.2.4**                                                             |
| Language        | TypeScript **strict**, `"module": "esnext"`, `"moduleResolution": "bundler"` |
| Styling         | Tailwind CSS v4                                                              |
| Computer vision | `@techstark/opencv-js ^4.12.0` (WASM, main thread only)                      |
| Pose estimation | `@mediapipe/tasks-vision ^0.10.34` (MediaPipe Pose Landmarker, GPU delegate) |
| Testing         | Vitest **^4.1.1** + jsdom + `@testing-library/react ^16.3.2`                 |
| Path alias      | `@/*` → project root                                                         |

> **⚠ This is NOT the Next.js you know.** APIs, conventions and file structure
> may all differ from training data. Read the relevant guide in
> `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

---

## Project Architecture

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

hooks/           React hooks that wire pipeline modules to UI state
  useOpenCV.ts     loads /public/opencv.js; exposes { ready, cv }
  usePoseModel.ts  loads MediaPipe Pose Landmarker; exposes { ready, model }
  useVideoProcessor.ts  seek loop → pose estimation → ORB extraction
  useImageMatcher.ts    upload image → extractFeatures → matchOrbFeatures
  usePoseVideo.ts  auto-renders annotated WebM from match result
  useClickOutside.ts  close-on-outside-click seam (mousedown/pointerdown)
  useEscapeKey.ts     ESC-to-close seam
  useMeasuredHeight.ts  ResizeObserver callback ref → measured px height

components/       React components grouped by why they live there
  ui/        generic primitives (LoadingSpinner, ThemeToggle, InfoDropdown,
             ComboInput, ImageCropper, LocationAutocomplete, Modal,
             FullscreenModal)
  layout/    app chrome & page shells (NavBar, AccountMenu, Preloader,
             Providers, LoadingGate, ToolPageShell, ToolRouteHeader)
  skeleton/  skeleton-overlay UI (FramePlayer, SkeletonStylePanel)
  capture/   crop + camera (CropBoxOverlay, CameraRecorderModal)
  run/       run-type domain primitives (RunTypeBadge, RunStatusDot)
  scan/ compare/ route/ routes/ map/  feature-owned components
  shared/    ClimbDetailModal only (pending removal in redesign)

storage/
  sessionStore.ts  in-memory Map; exports RunType, RouteAttempt (includes runType, rating?, notes?)

utils/
  poseConstants.ts  MP_KP indices, MP_KP_NAMES, MP_SKELETON_EDGES (MediaPipe/BlazePose topology)
  cropFraction.ts   CropFraction type + DEFAULT_CROP (plain data, no React)
  leaflet.ts        initLeafletMap() — CartoDB tiles + icon fix (ClimbsMap, MapPicker)
  cvHelpers.ts

workers/         Legacy Web Worker files (keep, do not delete)
```

---

## Critical Coding Rules

### Color system and theming

- All colors must use semantic CSS tokens defined in `app/globals.css` (`@theme inline` for dark defaults, `.theme-light` class for light overrides).
- **Never** use raw Tailwind palette classes for status/semantic colors: no `red-400`, `amber-900`, `emerald-500`, `black/60` etc. where a semantic token exists.
- Semantic token classes available: `text-danger`, `bg-danger-surface`, `border-danger-border`, `text-caution`, `bg-caution-surface`, `border-caution-border`, `text-send`, `bg-send`, `bg-send-surface`, `text-attempt`, `bg-attempt`, `bg-attempt-surface`, `text-fg-inverse`.
- Run-type chips: `bg-send/80 text-fg-inverse` (send) and `bg-attempt/80 text-fg-inverse` (attempt). Run-type badges: `bg-send-surface text-send` / `bg-attempt-surface text-attempt`.
- Error banners: `bg-danger-surface border-danger-border text-danger`. Warning banners: `bg-caution-surface border-caution-border text-caution`.
- Modal loading overlays: `bg-surface/70 backdrop-blur-sm` (not `bg-black/40`).
- Theme is toggled via `useTheme()` from `hooks/useTheme.tsx`. `ThemeProvider` is mounted in `components/layout/Providers.tsx`.
- `ThemeToggle` component lives in `components/ui/ThemeToggle.tsx` — import and place it in the NavBar right-side controls.
- A FOUC-prevention inline script in `app/layout.tsx` reads `localStorage` and applies `theme-light` or `theme-dark` class to `<html>` before React hydrates.
- Canvas drawing values (map pins, skeleton overlays) use `utils/theme.ts` `dark`/`light` objects — keep them in sync with `globals.css` tokens.

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
- **Dismiss/modal seams** — do not hand-roll close-on-outside-click or ESC effects. Use `useClickOutside(ref, onOutside, enabled, eventType?)` and `useEscapeKey(onEscape, enabled?)`. For dialogs/sheets use `components/ui/Modal` (portal + backdrop) and for the crop fullscreen views `components/ui/FullscreenModal` — both already compose the two hooks.

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

### Profile & social

- Profile data stored at `ProfileData/{userId}/profile.json` (displayName, location, bio, profilePicture as base64 data URL).
- Search index at `ProfileData/_index/{userId}.json` (displayName, email, location) — updated on every profile save.
- Following list at `ProfileData/{userId}/following.json` — array of user IDs.
- Profile API routes: `/api/profile` (own GET/PUT), `/api/profile/[userId]` (public GET), `/api/profile/[userId]/climbs` (public climb list), `/api/profile/[userId]/climbs/detail` (single climb detail by key), `/api/profile/follow` (GET/POST/DELETE), `/api/profile/search?q=` (GET).
- `isValidProfileKey()` and `isValidRoutePrefix()` validate cross-user reads.
- Profile text fields capped at `PROFILE_TEXT_LIMIT` (500 chars); profile picture must be a `data:image/` URL.
- `ClimbDetailModal` (`components/shared/ClimbDetailModal.tsx`) — reusable modal showing full climb info + thumbnail image. Used from both profile pages.
- `ClimbsMap` (`components/map/ClimbsMap.tsx`) — accepts optional `onPinClick` callback and `key` field on pins for navigation.
- Profile and following data live in S3 under the `ProfileData/` prefix (same bucket as route data) — there is no separate database service.

### Authentication (Firebase)

- Auth uses **Firebase Auth** (client SDK) with **server-issued HTTP-only session cookies** — no localStorage tokens, no Supabase.
- `utils/firebase/client.ts` — browser Firebase app/auth (`getFirebaseAuth`). Client sign-in/sign-up via `signInWithEmailAndPassword` / `createUserWithEmailAndPassword`.
- `utils/firebase/admin.ts` — server-only Firebase Admin SDK singleton (`getAdminAuth`). Initialised from `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (server-side env, never `NEXT_PUBLIC_`).
- `utils/firebase/constants.ts` — Edge-safe shared constants: `SESSION_COOKIE_NAME` (`__session`), `SESSION_COOKIE_MAX_AGE_MS` (14 days). **Never** import `firebase-admin` here (used by Edge middleware).
- Session flow: client `signIn()` (`hooks/useAuth.tsx`) gets a Firebase ID token → `POST /api/auth/session` calls `adminAuth.createSessionCookie()` and sets the `__session` HTTP-only cookie → `DELETE /api/auth/session` clears it on sign-out.
- `proxy.ts` runs in the Edge runtime and only checks `__session` **cookie presence** to redirect unauthenticated users away from `/scan`, `/compare`, `/profile` (UX guard, not full verification — firebase-admin is unavailable in Edge).
- `app/api/s3/shared.ts` `verifySession()` performs the real check server-side via `getAdminAuth().verifySessionCookie(cookie, true)` (checks signature + revocation).
- `hooks/useAuth.tsx` provides `AuthProvider` context + `useAuth()` hook. **File must stay `.tsx`** — it contains JSX.
- All S3 API routes call `getAuthUserId()` (verifies the session cookie) and return 401 when unauthenticated.
- `isValidKey()` and `isValidPrefix()` enforce that every S3 key is scoped to the authenticated user: `RouteData/{userId}/...`.
- `hooks/useS3Storage.ts` derives user-scoped keys via `deriveS3Key(userId, attempt)`.
- `components/layout/NavBar.tsx` shows `PUBLIC_TABS` (Home, Docs) for unauthenticated users and `AUTH_TABS` (all tabs) for authenticated users.

### Testing

- Test files mirror the source tree under `__tests__/`.
- Use `vi.stubGlobal` + `vi.unstubAllGlobals()` in afterEach for DOM globals.
- `ImageData` not available in jsdom — use plain object casts: `{ data, width, height, colorSpace } as ImageData`.
- OpenCV calls are never tested directly — mock `pipeline/orbDetector` or `pipeline/homography` at the module boundary.
- `FakeOrbWorker.prototype.postMessage` save/restore prevents prototype pollution between tests.

### Media previews with crop overlays

- **Never** display media with `object-contain` CSS when a `CropBoxOverlay` is involved — letterboxing causes crop fractions to map to the container rather than the actual media bounds.
- Use an aspect-ratio-constrained container with `object-fill` class on the media element so the container IS the media bounds. Crop fractions then map 1:1 to media pixels.
- CSS variable `--nav-h: 3rem` (NavBar height) is defined in `app/globals.css` `:root`.
- **Viewport-fit pattern** (inline preview):
  ```tsx
  function mediaContainerStyle(w: number, h: number): React.CSSProperties {
    const ratio = (w / h).toFixed(6);
    const maxH = "calc(100dvh - var(--nav-h) - 1rem)";
    return {
      width: `min(100%, calc(${maxH} * ${ratio}))`,
      maxHeight: maxH,
      aspectRatio: `${w} / ${h}`,
    };
  }
  // Media element: className="absolute inset-0 w-full h-full object-fill"
  ```
- **Fullscreen pattern**: `fsMediaContainerStyle` uses `maxHeight: calc(100dvh - 8rem)`.
- **Height-filling pattern** (scan flow Steps 2 & 3): fills the available vertical space `s` with the media, width following the aspect ratio and capped to `100%`. Both orientations reach the full height (landscape caps to viewport width only on narrow screens), so the media stays flush against the footer rather than leaving a vertical gap. Helpers in `utils/mediaContainerStyle.ts`: `fitMediaStyle(w, h, s)` / `fitMediaWidth(w, h, s)` take a **measured** `s` (px, via `useMeasuredHeight` on a `flex-1 min-h-0` stage); `fitMediaMaxWidth(w, h, offset)` is the dvh-calc variant for flow layouts. The scan video stage is flush (no border/radius/padding) and centered on `bg-surface`; the transport bar aligns to `fitMediaWidth`. Default the pre-load aspect ratio to portrait `{ w: 9, h: 16 }` (ascents are recorded vertically).
- Detect natural size: `onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}` for images; `setSize({ w: video.videoWidth || 16, h: video.videoHeight || 9 })` in the `onLoadedData`/`canplay` handler for videos. Default to `{ w: 4, h: 3 }` or `{ w: 16, h: 9 }` before load.
- Every media container with a crop overlay must have an **Expand** button that opens a fullscreen portal: `createPortal(<div className="fixed inset-0 z-fullscreen flex flex-col bg-surface" role="dialog" aria-modal="true">…</div>, document.body)`.
- Add an ESC key `useEffect` that closes the fullscreen when `useEffect([…], [fsState])` is active.
- **Video previews**: show crop-mode buttons (Climber / Wall texture) in a `<div className="flex items-center gap-2 flex-wrap">` toolbar **above** the video container.
- **Image previews**: no crop-mode toolbar — only the single `CropBoxOverlay` crop box is shown.
- Fullscreen video uses a separate `useRef<HTMLVideoElement>` so it plays independently; sync `currentTime` on open and back to the inline player on close.

---

## Security Review Checklist

When adding or changing code, verify the following:

- **Open redirect** — Any `router.push(url)` or `redirect(url)` using user-supplied input must validate the target is a relative path (`startsWith("/")`, not `startsWith("//")`, no `://`).
- **User-scoped data** — Every S3 key or prefix must include the authenticated user ID. Server-side API routes must call `isValidKey(key, userId)` / `isValidPrefix(prefix, userId)` before any S3 operation.
- **Input length limits** — User-supplied strings (state, area, route names, notes) must be length-limited before storage. S3 keys must not exceed 1024 bytes.
- **Error sanitisation** — AWS/infrastructure error details must not be returned to the client in production. Use `awsErrorMessage()` which logs details server-side and returns a generic message.
- **Auth gating** — Protected routes (`/scan`, `/compare`, `/profile`) must be guarded by `proxy.ts`. API routes must call `getAuthUserId()` and return 401 when null.
- **File extensions** — Any file containing JSX must use `.tsx` (not `.ts`). Verify after renaming or creating hook/component files.
- **Cookie security** — The Firebase `__session` cookie is `httpOnly` with `SameSite=strict` and `Secure` (in production). Never store ID tokens or session cookies in `localStorage`.
- **No secrets in client code** — Only `NEXT_PUBLIC_*` env vars may be referenced in client components. AWS credentials and the Firebase Admin service-account vars (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`) must stay server-side.

---

## After Every Code Change

Run these checks in order, then commit without prompting the user:

```powershell
# 1. Type-check (zero output = success)
npx tsc --noEmit

# 2. Lint
npx eslint .

# 3. Targeted tests for changed files/features
npx vitest run <targeted test files>

# 4. Stage and commit
git add .
git commit
```

Fix TypeScript errors before proceeding. Do not disable tsc checks.

**The agent MUST run `npx tsc --noEmit`, `npx eslint .`, targeted `npx vitest run ...`,
and `git add .` + `git commit` after every code change session without waiting to be asked.**

### Worktree-first workflow (required for non-interference)

- Default to a dedicated worktree and branch for each issue/task.
- Never do implementation work on the primary checkout when other active work is in flight.
- Start each task branch from `main`.
- Keep one issue per branch; do not batch unrelated fixes.
- Avoid destructive git commands (`reset --hard`, force-push, rewriting shared history).

Recommended setup:

```powershell
git fetch origin
git switch main
git pull --ff-only
git worktree add ..\beta-scanner-<task> -b <type>/<task-name>
```

### Local merge policy

- Default behavior is local validation + local commit only (no automatic push).
- Do not merge automatically unless the user explicitly requests completion merge.
- If requested, merge locally using `git merge --no-ff` from the primary checkout after checks pass.

Merge-on-complete sequence when explicitly requested:

```powershell
# in task worktree
npx tsc --noEmit
npx eslint .
npx vitest run <targeted test files>
git add .
git commit

# in primary checkout
git switch main
git merge --no-ff <task-branch>
```

### Issue tracking

- When implementing a `.scratch/` issue, follow the **PRD lifecycle loop** in
  `docs/agents/issue-tracker.md`: tackle exactly one issue per branch,
  sequence issues by number, branch each one from `main`, write the active
  `Branch:` line into the `.scratch/.../issues/*.md` file when work starts,
  then merge with `git merge --no-ff` and close the issue in that same `.scratch`
  file by setting `Status: done` + `Merged: <sha>` in the same step.
- An issue is never `done` until its code is merged, and merged code never lands
  without moving its issue to `done` — the two happen together. This includes
  **batch commits**: a commit that lands several issues' work closes every one of
  them (status + `Branch:` + `Merged:` + ticked checkboxes) immediately.
- The PRD's own `Status:` moves with its issues (`ready-for-agent` →
  `in-progress` on first landing → `done` when all issues are terminal), and an
  issue replaced by newer work is closed `wontfix` with a `Superseded-by:`
  pointer — see `docs/agents/issue-tracker.md`.
- Before ending a PRD work session, run `node scripts/audit-issues.mjs` and
  resolve any drift it reports (unclosed/unmerged issues, incomplete tracking
  blocks, PRD status drift, dangling supersession pointers); delete local
  branches it warns about.

### README maintenance

- When a code change adds, removes, or renames user-visible features, pages,
  storage formats, or API behaviour, update `README.md` in the same commit.
- Keep the S3 key format example, Pages table, and feature summary in the README
  consistent with the actual code.

---

## Commit Message Convention

```
<type>: <imperative summary under 72 chars>

- bullet describing what changed
- bullet describing what changed

one or two sentences explaining why the change was made
```

Formatting rules:

- No quotation marks anywhere in the commit message.
- No explicit What, How, or Why labels.
- Use a short summary line, then a blank line, then bullets, then a blank line, then a brief why paragraph.

Types: `feat`, `fix`, `refactor`, `test`, `chore`

<!-- END:nextjs-agent-rules -->
