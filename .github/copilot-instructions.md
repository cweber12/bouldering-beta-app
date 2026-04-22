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

### Color system and theming
- All colors must use semantic CSS tokens defined in `app/globals.css` (`@theme inline` for dark defaults, `.theme-light` class for light overrides).
- **Never** use raw Tailwind palette classes for status/semantic colors: no `red-400`, `amber-900`, `emerald-500`, `black/60` etc. where a semantic token exists.
- Semantic token classes available: `text-danger`, `bg-danger-surface`, `border-danger-border`, `text-caution`, `bg-caution-surface`, `border-caution-border`, `text-send`, `bg-send`, `bg-send-surface`, `text-attempt`, `bg-attempt`, `bg-attempt-surface`, `text-fg-inverse`.
- Run-type chips: `bg-send/80 text-fg-inverse` (send) and `bg-attempt/80 text-fg-inverse` (attempt). Run-type badges: `bg-send-surface text-send` / `bg-attempt-surface text-attempt`.
- Error banners: `bg-danger-surface border-danger-border text-danger`. Warning banners: `bg-caution-surface border-caution-border text-caution`.
- Modal loading overlays: `bg-surface/70 backdrop-blur-sm` (not `bg-black/40`).
- Theme is toggled via `useTheme()` from `hooks/useTheme.tsx`. `ThemeProvider` is mounted in `components/shared/Providers.tsx`.
- `ThemeToggle` component lives in `components/shared/ThemeToggle.tsx` — import and place it in the NavBar right-side controls.
- A FOUC-prevention inline script in `app/layout.tsx` reads `localStorage` and applies `theme-light` or `theme-dark` class to `<html>` before React hydrates.
- Canvas drawing values (map pins, skeleton overlays) use `utils/theme.ts` `dark`/`light` objects — keep them in sync with `globals.css` tokens.

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

### Media previews with crop overlays
- **Never** display media with `object-contain` CSS when a `CropBoxOverlay` is involved — letterboxing causes crop fractions to map to the container rather than the actual media bounds.
- Use an aspect-ratio-constrained container with `object-fill` class on the media element so the container IS the media bounds. Crop fractions then map 1:1 to media pixels.
- CSS variable `--nav-h: 3rem` (NavBar height) is defined in `app/globals.css` `:root`.
- **Viewport-fit pattern** (inline preview):
  ```tsx
  function mediaContainerStyle(w: number, h: number): React.CSSProperties {
    const ratio = (w / h).toFixed(6);
    const maxH = "calc(100dvh - var(--nav-h) - 1rem)";
    return { width: `min(100%, calc(${maxH} * ${ratio}))`, maxHeight: maxH, aspectRatio: `${w} / ${h}` };
  }
  // Media element: className="absolute inset-0 w-full h-full object-fill"
  ```
- **Fullscreen pattern**: `fsMediaContainerStyle` uses `maxHeight: calc(100dvh - 8rem)`.
- Detect natural size: `onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}` for images; `setSize({ w: video.videoWidth || 16, h: video.videoHeight || 9 })` in the `onLoadedData`/`canplay` handler for videos. Default to `{ w: 4, h: 3 }` or `{ w: 16, h: 9 }` before load.
- Every media container with a crop overlay must have an **Expand** button that opens a fullscreen portal: `createPortal(<div className="fixed inset-0 z-fullscreen flex flex-col bg-surface" role="dialog" aria-modal="true">…</div>, document.body)`.
- Add an ESC key `useEffect` that closes the fullscreen when `useEffect([…], [fsState])` is active.
- **Video previews**: show crop-mode buttons (Climber / Wall texture) in a `<div className="flex items-center gap-2 flex-wrap">` toolbar **above** the video container.
- **Image previews**: no crop-mode toolbar — only the single `CropBoxOverlay` crop box is shown.
- Fullscreen video uses a separate `useRef<HTMLVideoElement>` so it plays independently; sync `currentTime` on open and back to the inline player on close.

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
- `utils/supabase/service.ts` is removed. Profile and following data now live in S3 under the `ProfileData/` prefix in the same bucket as route data.

### Authentication (Firebase)
- Auth uses Firebase Auth (email/password) with HTTP-only session cookies.
- `utils/firebase/client.ts` — browser Firebase app + auth (`getFirebaseApp`, `getFirebaseAuth`).
- `utils/firebase/admin.ts` — Firebase Admin SDK (`getAdminAuth`). Server-side only, never import in client bundles.
- `utils/firebase/constants.ts` — shared constants (`SESSION_COOKIE_NAME`, `SESSION_COOKIE_MAX_AGE_MS`). Safe for Edge runtime (no firebase-admin import).
- `app/api/auth/session/route.ts` — POST creates session cookie from ID token; DELETE clears it.
- `proxy.ts` checks for the `__session` cookie (presence only, Edge-compatible UX guard). Full verification happens in Route Handlers via `getAdminAuth().verifySessionCookie()`.
- `hooks/useAuth.tsx` provides `AuthProvider` context + `useAuth()` hook. **File must stay `.tsx`** — it contains JSX.
- All S3 API routes call `getAuthUserId()` and return 401 when unauthenticated. `getAuthUserId()` verifies the session cookie with Firebase Admin.
- Firebase `User.uid` is the user identifier (not `user.id`). Use `user.uid` in all client components.
- `isValidKey()` and `isValidPrefix()` enforce that every S3 key is scoped to the authenticated user: `RouteData/{userId}/...`.
- `hooks/useS3Storage.ts` derives user-scoped keys via `deriveS3Key(userId, attempt)`.
- `components/shared/NavBar.tsx` shows `PUBLIC_TABS` (Home, Docs) for unauthenticated users and `AUTH_TABS` (all tabs) for authenticated users.
- **No secrets in client code** — Only `NEXT_PUBLIC_*` env vars may be referenced in client components. `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`, and AWS credentials must stay server-side.

---

## Security Review Checklist

When adding or changing code, verify the following:

- **Open redirect** — Any `router.push(url)` or `redirect(url)` using user-supplied input must validate the target is a relative path (`startsWith("/")`, not `startsWith("//")`, no `://`).
- **User-scoped data** — Every S3 key or prefix must include the authenticated user ID. Server-side API routes must call `isValidKey(key, userId)` / `isValidPrefix(prefix, userId)` before any S3 operation.
- **Input length limits** — User-supplied strings (state, area, route names, notes) must be length-limited before storage. S3 keys must not exceed 1024 bytes.
- **Error sanitisation** — AWS/infrastructure error details must not be returned to the client in production. Use `awsErrorMessage()` which logs details server-side and returns a generic message.
- **Auth gating** — Protected routes (`/scan`, `/match`, `/compare`, `/profile`) must be guarded by `proxy.ts`. API routes must call `getAuthUserId()` and return 401 when null.
- **File extensions** — Any file containing JSX must use `.tsx` (not `.ts`). Verify after renaming or creating hook/component files.
- **Cookie security** — Firebase session cookies use `HttpOnly`, `SameSite: strict`, and `Secure` (production) attributes. Never store tokens in `localStorage`.
- **No secrets in client code** — Only `NEXT_PUBLIC_*` env vars may be referenced in client components. AWS credentials and `FIREBASE_PRIVATE_KEY` must stay server-side.

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
