# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

## Agent skills

### Issue tracker

Issues and PRDs live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles using their default strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

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

### Scoped instruction files

- **Scan/compare UI flows and media-preview/crop-overlay patterns**: `components/CLAUDE.md` (auto-loaded when working under `components/`).
- **Pipeline execution chain, module map, OpenCV rules, model singletons**: `pipeline/CLAUDE.md` (auto-loaded when working under `pipeline/`).
- **Profile & social storage formats, routes, validators**: `docs/agents/profile.md` (read before profile/social work).

### Auth flow

Firebase Auth (client) → `signIn()` in `useAuth.tsx` → exchange the Firebase ID token for an HTTP-only `__session` cookie via `POST /api/auth/session` (Firebase Admin `createSessionCookie`) → `proxy.ts` (Edge middleware) checks `__session` cookie **presence** on every protected route request (UX redirect guard only — firebase-admin is unavailable in Edge) → API routes call `getAuthUserId()`, which verifies the cookie server-side via `getAdminAuth().verifySessionCookie(cookie, true)`.

### S3 access control

Every `/api/s3/*` route calls `getAuthUserId()` (returns 401 if missing), then `isValidKey(key, userId)` or `isValidPrefix(prefix, userId)` before any AWS SDK call. Keys are always `RouteData/{userId}/...` so one user can never read or write another's data.
