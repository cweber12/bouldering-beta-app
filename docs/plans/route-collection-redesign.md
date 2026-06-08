# Route Collection redesign — implementation plan

Pivots the "Collection" surface from a flat per-run grid wrapped in a personal
profile into a **route-grouped** collection (rows + map), splits identity/social
out behind an avatar menu, and promotes the climb console to a dedicated
per-user `/route/...` URL that subsumes `/compare`.

## Confirmed decisions

| Area | Decision |
|---|---|
| Grid unit | **Route-grouped** default; per-run "Climbs" kept as a secondary toggle |
| Routes layout | Desktop: rows left + map right. Mobile: `List \| Map` toggle, **default Map** |
| Route row | thumbnail · name + rating · area · **climb count · last-climbed date** · map-pin button. No send/attempt indicator |
| Map ↔ list | Bidirectional highlight; **row body** opens the route; pin button centers map; pin click scrolls row into view |
| Console URL | **`/route/[userId]/{state}/{area}/{route}`** — replaces `/compare`. single = view, multi = compare |
| Scoping | **Per-user**. Sidebar shows that user's runs on the route |
| `/compare` | Replaced; old URLs redirect; `buildCompareUrl` → `buildRouteUrl` |
| Climb click | **No modal** — direct nav to `/route/[userId]/.../?climb=<key>` |
| Nav | `Scan \| Routes \| Docs` + new top-right **avatar menu** (Profile, Sign out) |
| Own Profile | Identity + social only (no climb grid) |
| Public profile | Identity header + the same two-pane Routes view, scoped to their uid |
| Route filters | Search + state/area + sort (default Last climbed). Run-type chips dropped. Restyled |

## URL shape

- Collection list: **`/routes`** (the nav "Routes" tab).
- Route console: **`/route/{userId}/{state}/{area}/{route}`**, with
  `?climb=<key>` (single selection) and `?compare=<csv>` (multi mode).
- Path segments are `encodeURIComponent` of the exact `state/area/route` strings
  the app already passes around (these come straight from the S3 key, so they're
  already canonical — no separate slug system needed).

---

## Phase 0 — URL helper foundation

**Goal:** one canonical builder, no behavior change yet.

- Add `utils/routeUrl.ts`:
  - `buildRouteUrl(userId, { state, area, route }, { climb?, compare?, mode? })`.
  - Re-export `ConsoleMode` here (moved from `compareUrl.ts`).
- Keep `utils/compareUrl.ts` temporarily re-exporting `buildRouteUrl`-backed
  helpers so nothing breaks mid-migration.

**Check/commit:** `tsc`, `eslint`, `vitest run __tests__/utils/`. Commit.

---

## Phase 1 — Route console page (replaces /compare)

**Goal:** the compare UI lives at `/route/[userId]/.../`, per-user scoped.

- Extract `app/compare/page.tsx`'s `ComparePageInner` into
  `components/route/RouteConsole.tsx` (props: `userId, state, area, route,
  initialClimb?, initialCompare?`). Logic is unchanged; inputs now come from
  props/path instead of `?keys/state/area/route`.
- New route: `app/route/[userId]/[state]/[area]/[route]/page.tsx` — decodes path
  params, reads `?climb` / `?compare`, renders `<RouteConsole>`.
- **Fix route-photo load** to per-user key
  `RouteData/{userId}/{state}/{area}/{route}/route-image.json` (was `RouteData/_/…`).
- `CompareClimbRail` keeps working (already fetches by `userId/state/area/route`);
  pass exact route context. Add an **exact-match** mode to the climbs API (new
  `exact=1` param) so "Slab" ≠ "Slab Master".
- `app/compare/page.tsx` → thin redirect: map legacy `?keys/state/area/route/mode`
  to `buildRouteUrl(user.uid, …)` and `router.replace`.
- `proxy.ts`: add `/route` (and `/routes`) to the protected matcher.

**Risks:** `RouteConsole` is large; keep the extraction mechanical (no rename of
internal state). Verify single↔multiple still derive from `?climb`/`?compare`.

**Check/commit:** `tsc`, `eslint`, `vitest run __tests__/components/compare __tests__/utils`. Commit.

---

## Phase 2 — Route-grouping API

**Goal:** one fetch returns route rows.

- New `app/api/profile/[userId]/routes/route.ts` (GET):
  - Reuse the list+`parseKey` logic from `climbs/page/route.ts`.
  - Fold all runs by `state/area/route`. For each route emit:
    `{ state, area, route, climbCount, lastClimbedLabel, lastClimbKey,
       thumbnail, rating, coordinates?, hasGps }` — pulled from the **most
    recent** run only (one JSON fetch per route, not per run).
  - Support `search`, `state`, `area`, and `sort` (`recent` default | `oldest`
    | `route`). Coordinates here also feed the map (drops the need for a separate
    pins call on the Routes page).
- Export a shared `RouteSummary` type for the client.

**Check/commit:** `tsc`, `eslint`, add `__tests__/api/routes` (mock S3 list/get). Commit.

---

## Phase 3 — Routes page (two-pane)

**Goal:** the new default Collection surface at `/routes`.

- `app/routes/page.tsx` — two-pane shell:
  - Desktop: `RouteList` (left, single column) + `ClimbsMap` (right). Mobile:
    `List | Map` segmented control, **default Map**.
  - Left-pane `Routes | Climbs` toggle. Map persists across both.
- New components under `components/routes/`:
  - `RouteRow.tsx` — thumbnail · name+rating · area · count · last-climbed ·
    pin button (disabled when `!hasGps`). Row body → `buildRouteUrl(uid, route,
    { climb: lastClimbKey })`.
  - `RouteList.tsx` — fetches `/api/profile/{uid}/routes`; owns `selectedRoute`
    highlight state shared with the map.
  - `RouteToolbar.tsx` — restyled search + state/area filters + sort.
  - `ClimbGrid.tsx` — the existing per-run grid extracted from `/profile`
    (Climbs secondary view); card click → `buildRouteUrl(uid, route, { climb })`.
- Map interaction: extend `ClimbsMap` with `selectedKey`, `onPinHover`, and an
  imperative `centerOn(key)` (or controlled `center` prop). Wire bidirectional
  highlight (row hover → pin glow + pan; pin click → scroll row into view).
- Route pins are inherently one-per-route now (from the `/routes` endpoint).

**Risks:** Leaflet highlight/center plumbing; keep the map dynamic-imported
(`ssr:false`) as today.

**Check/commit:** `tsc`, `eslint`, component tests for `RouteRow`/`RouteList`. Commit.

---

## Phase 4 — Profile/social split + avatar menu + nav

**Goal:** identity leaves the Collection surface.

- `components/shared/AccountMenu.tsx` — avatar dropdown (avatar → `/profile`,
  Sign out). Replaces the bare Sign-out button in `NavBar`.
- `NavBar`: `AUTH_LINKS = Scan | Routes | Docs`. Update `HELP_CONTENT` keys
  (`/compare` → `/route`; add `/routes`).
- `app/profile/page.tsx`: strip the climb grid / filters / map (now on `/routes`);
  keep identity edit, following, and find-climbers only.

**Check/commit:** `tsc`, `eslint`, NavBar/AccountMenu tests. Commit.

---

## Phase 5 — Public profile parity

**Goal:** browsing another climber uses the same Routes view.

- `app/profile/[userId]/page.tsx`: keep the identity header + follow; replace the
  grid with the Phase 3 two-pane Routes view, parameterized by `userId`.
- Route taps → `buildRouteUrl(thatUserId, …)`.

**Check/commit:** `tsc`, `eslint`, targeted tests. Commit.

---

## Phase 6 — Kill ClimbDetailModal

**Goal:** remove the modal; one navigation path everywhere.

- Delete `components/shared/ClimbDetailModal.tsx` + its test.
- Replace remaining usages (public profile, Climbs grid, map pin handlers) with
  `buildRouteUrl(userId, route, { climb: key })` navigation.
- The modal's "Take a photo" entry point is already covered by the route page's
  camera/upload.
- Remove now-dead `compareUrl.ts` shim; delete `utils/compareUrl.ts` and its test
  once all callers use `routeUrl`.

**Check/commit:** `tsc`, `eslint`, full `vitest run`. Commit.

---

## Phase 7 — Pins endpoint cleanup

**Goal:** retire the per-run pins path where the Routes endpoint now serves coords.

- If `/routes` coordinates fully cover the map, drop the `/pins` fetch from the
  Routes and public-profile pages. Keep `/api/.../pins` only if still used
  elsewhere; otherwise dedup it to one-per-route or remove.

**Check/commit:** `tsc`, `eslint`, tests. Commit.

---

## Phase 8 — Docs & final sweep

- `README.md`: Pages table (`/routes`, `/route/[userId]/...`), drop `/compare`,
  note route-photo per-user key.
- `AGENTS.md` / `CLAUDE.md`: update the scan/compare flow description and the
  route-photo key if canonicalized.
- Grep for stray `/compare`, `buildCompareUrl`, `ClimbDetailModal` references
  (docs, copilot-instructions, tests).
- Full `tsc` + `eslint` + `vitest run`. Final commit.

---

## Cross-cutting flags

- **Exact route match** (Phase 1) — add `exact=1` to the climbs API; the rail and
  route console must match the route exactly, not by substring.
- **Route-photo key canonicalized** to per-user (Phase 1) — verify `isValidKey`
  accepts it (it already scopes to `RouteData/{userId}/…`).
- **Singular vs plural**: `/routes` = the list, `/route/...` = one route console.
  Intentional, keep consistent in links and help copy.
- **No send status on rows** (by decision) — send/attempt still appears inside the
  route console, just not on the collection rows.
