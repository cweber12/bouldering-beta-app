# Delete the dead modules and empty the knip ignore block

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-consolidation-cleanup/PRD.md`
- Opened by: `.scratch/actionable/arch-conventions-and-enforcement/issues/06-install-knip-and-naming-rules.md`

## Blocked by

`arch-conventions-and-enforcement` issue 06 — it installs `knip` with the ignore block this issue
empties. Landing this first would leave nothing to verify the deletion against.

## What to build

Delete the three items the foundation PRD parked in `knip`'s ignore block, then remove the block.

**`pipeline/legacy/orbFeatures.ts` and `pipeline/legacy/orbMatcher.ts`.** Imported by nothing in
`app/`, `components/`, `hooks/`, `utils/`, `harness/`, or the rest of `pipeline/` — only by each
other and by `__tests__/pipeline/orbFeatures.test.ts` and `__tests__/pipeline/orbMatcher.test.ts`.
They redefine `OrbKeypoint`, `OrbResult`, and `OrbMatch`, types that
`pipeline/matching/orbDetector.ts` also defines, so the repo currently carries three names for ORB
and two competing definitions of its core types.

Delete both sources and both test files, then remove the now-empty `pipeline/legacy/` directory
and its entry from `pipeline/CLAUDE.md`'s module map.

**Before deleting, confirm the current ORB path does not rely on them.** `pipeline/CLAUDE.md`
already describes them as "legacy worker files, not used", and the audit found no importers — but
run the check rather than trusting the doc, since the doc is what this PRD is correcting elsewhere.

**`utils/compareUrl.ts`.** A 26-line back-compat shim that re-exports `ConsoleMode` from
`utils/routeUrl.ts` and builds a `/compare?...` URL. `app/compare/page.tsx` is now only a redirect
to `buildRouteUrl`, so the repo has two URL builders for one destination. Delete it and migrate any
remaining importer to `utils/routeUrl.ts`.

**`workers/` is not deleted.** It is unreferenced and `knip` will want to flag it, but AGENTS.md
says "Legacy Web Worker files (keep, do not delete)" and it is already excluded from `knip` by
issue 06. Leave it.

The `vite-tsconfig-paths` devDependency was already removed by foundation issue 06 — verify it is
gone rather than removing it again.

## Acceptance criteria

- [ ] A check confirms nothing outside the two legacy files and their own tests imports
      `orbFeatures` or `orbMatcher`; the result is recorded in `## Comments`.
- [ ] `pipeline/legacy/` is gone, along with `__tests__/pipeline/orbFeatures.test.ts` and
      `__tests__/pipeline/orbMatcher.test.ts`.
- [ ] `pipeline/CLAUDE.md`'s module map no longer lists `legacy/`.
- [ ] `OrbKeypoint`, `OrbResult`, and `OrbMatch` have exactly one definition each, in
      `pipeline/matching/orbDetector.ts`.
- [ ] `utils/compareUrl.ts` is gone and any importer uses `utils/routeUrl.ts`.
- [ ] `workers/` is untouched and still excluded from `knip`.
- [ ] `vite-tsconfig-paths` is absent from `package.json`.
- [ ] `knip`'s ignore block is empty (or the key removed) and `knip` reports clean.
- [ ] `npx tsc --noEmit` passes with zero output.
- [ ] `npx eslint .` passes.
- [ ] **Full** `npx vitest run` passes; the total count drops only by the assertions in the two
      deleted legacy test files.
- [ ] `npx next build` succeeds.

## Comments

- Deleting tests normally warrants suspicion. It is right here because these two suites test
  modules nothing else imports — they are the only reason the dead code registers as used at all,
  which is exactly how dead code survives an audit.
- This closes the loop opened by foundation issue 06: `knip` shipped green with an annotated
  ignore block rather than red, and this issue is what makes the block unnecessary.
