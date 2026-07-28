# Give the S3 route-key grammar a single owner

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-consolidation-cleanup/PRD.md`

## Blocked by

`.scratch/actionable/arch-conventions-and-enforcement/` — the boundary rules should be live so
they reject a wrong-layer placement of the new module.

## What to build

Create `storage/routeKey.ts` as the one owner of the key grammar

```text
RouteData/{userId}/{state}/{area}/{route}/run-{timestamp}-{attempt|send}.json
```

Isomorphic leaf code — no AWS SDK, no `next/server`, no React — so both client components and API
routes consume the same implementation. `storage/` already exists and is already a leaf under the
target graph.

The module owns: the `RouteData` prefix constant, key building, key parsing, owner extraction, and
key validation. Follow the divergent-duplicate rule from `docs/agents/conventions.md` — the
signature covers every variant currently in use rather than picking one.

**Replace these six parsers:**

- `app/api/profile/[userId]/climbs/detail/route.ts:36` `parseKey`
- `app/api/profile/[userId]/climbs/page/route.ts:36` `parseKey` — byte-identical to the above
- `app/api/profile/[userId]/routes/route.ts:34` `parseKey` — same, **plus** a
  `(?:attempt|run)-(\d+)` timestamp capture the other two lack. Preserve that as an option or as
  an always-populated field; do not drop it and do not silently add it to the other two callers'
  behaviour.
- `app/dev/landing-clip/page.tsx:82` `parseRunKey`
- `app/api/dev/shared.ts:63` `parseBundleKey` — **check before touching.** This parses the corpus
  bundle key space, not the route key space. If the grammars genuinely differ, leave it alone and
  say so in `## Comments`.

**Replace the ten inline owner extractions** — bare `key.split("/")[1]` expressions in
`components/route/RouteConsole.tsx` (lines 208, 481, 515, 575, 647, 660), `app/compare/page.tsx:37`,
`hooks/useS3Storage.ts:171`, and `components/shared/ClimbDetailModal.tsx:70`.

**Collapse the prefix divergence.** The literal is `S3_PREFIX` in `app/api/s3/shared.ts:13`,
`BETA_FOLDER = "RouteData"` in `app/scan/page.tsx:52`, and a bare template literal in
`RouteConsole.tsx` (lines 329, 666). All three become imports of the one constant.

**Legacy keys must still parse.** `attempt-{timestamp}.json` files predate the
`run-{timestamp}-{type}` format and are still loadable per AGENTS.md, defaulting `runType` to
`"attempt"`. This is existing behaviour, not a new requirement — it must survive the consolidation.

## Acceptance criteria

- [ ] `storage/routeKey.ts` exists and exports the prefix constant plus build, parse, validate,
      and owner-extraction functions.
- [ ] A characterization test enumerates, for **each** of the six existing parsers, the inputs and
      outputs it produces today — including the timestamp capture unique to the `routes` route —
      and passes **before** any call site is migrated.
- [ ] Legacy `attempt-{timestamp}.json` keys parse, yielding `runType: "attempt"`.
- [ ] Keys with a missing segment, a trailing slash, or an unexpected depth are rejected the same
      way the current parsers reject them.
- [ ] All three duplicated `parseKey` copies in the profile routes are gone; each route imports
      from `storage/routeKey.ts`.
- [ ] `parseRunKey` in `app/dev/landing-clip/page.tsx` is gone.
- [ ] No bare `key.split("/")[1]` owner extraction remains in `app/`, `components/`, or `hooks/`.
- [ ] `BETA_FOLDER` is gone from `app/scan/page.tsx`; no `RouteData` string literal remains
      outside `storage/routeKey.ts`.
- [ ] `parseBundleKey` is either migrated or explicitly justified as a different key space in
      `## Comments`.
- [ ] `storage/routeKey.ts` imports nothing from `app/`, `components/`, `hooks/`, or `pipeline/`.
- [ ] `npx tsc --noEmit`, `npx eslint .`, and **full** `npx vitest run` pass.

## Comments

- The three `parseKey` copies drifting apart is the concrete argument for this issue: two are
  byte-identical and one has quietly gained a capture group. Nothing prevents the next edit from
  landing in only one of them.
- `app/api/` is outside the `vitest` coverage `include` list, so coverage reports will not reflect
  this work. Judge it by the characterization test directly.
