# Install knip and the filename and export-style rules

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-conventions-and-enforcement/PRD.md`
- Decision: `docs/adr/0025-mechanically-enforced-layer-boundaries.md` (issue 01)
- Conventions: `docs/agents/conventions.md` (issue 01)

## Blocked by

Issues 03 and 04 — both move files, so installing filename rules first would mean configuring them
against paths that are about to change.

## What to build

**Install `knip`** for dead-code and unused-dependency reporting, with a config covering `app/`,
`components/`, `hooks/`, `harness/`, `pipeline/`, `storage/`, `utils/`, and `scripts/`, and a CI
step. Entry points are the Next.js App Router files, `proxy.ts`, `vitest.config.mts`, and the
`scripts/*.mjs` binaries.

Three items are already known dead. Put them in an annotated ignore block so `knip` lands green
today rather than red:

```text
pipeline/legacy/orbFeatures.ts   — see arch-consolidation-cleanup issue 09
pipeline/legacy/orbMatcher.ts    — see arch-consolidation-cleanup issue 09
utils/compareUrl.ts              — see arch-consolidation-cleanup issue 09
```

The unused `vite-tsconfig-paths` devDependency should be reported and removed here rather than
ignored — `vitest.config.mts` resolves path aliases natively and says so in a comment, so there is
nothing to defer. `workers/` is excluded from `knip` entirely: AGENTS.md says keep it, and it is
already in `eslint.config.mjs`'s `globalIgnores`.

While in `eslint.config.mjs`, remove the duplicated `workers/**` entry in `globalIgnores` — it
appears twice.

**Add filename-case rules** via `unicorn/filename-case` with per-directory overrides, matching
what the tree already does:

- `components/**` — PascalCase
- `hooks/**`, `pipeline/**`, `utils/**`, `harness/**`, `storage/**` — camelCase
- `app/**` route segments — kebab-case

The one violation is `components/scan/controls/overlayIcons.tsx`. It is also the only component
file with no default export, which is consistent — it is a named-export icon collection, not a
component. Either rename it to `OverlayIcons.tsx` or move it out of `components/` to a location
where camelCase is correct; the second is the better reading of what the file is.

**Add an export-style rule.** `components/**` uses default exports (72 of 73 files already do),
everything else uses named exports (`hooks/`, `pipeline/`, `utils/`, `harness/`, `storage/` are
already at 100%). Normalise the two components that use the trailing `export default X;` form
instead of `export default function X(...)`: `components/scan/controls/ToolbarButton.tsx:40` and
`components/skeleton/FramePlayer.tsx:804`.

If no off-the-shelf rule expresses the default-vs-named split cleanly, a small
`no-restricted-syntax` pair scoped by `files:` override is acceptable — do not add a custom plugin
for this.

## Acceptance criteria

- [ ] `knip` is installed, configured, and runs as a CI step.
- [ ] `knip` reports clean, with an ignore block containing exactly the three items above, each
      annotated with a pointer to `arch-consolidation-cleanup` issue 09.
- [ ] `vite-tsconfig-paths` is removed from `devDependencies` and `npx vitest run` still resolves
      `@/*` aliases.
- [ ] `workers/` is excluded from `knip`.
- [ ] The duplicate `workers/**` entry in `eslint.config.mjs`'s `globalIgnores` is removed.
- [ ] Filename-case rules are active for `components/`, `hooks/`, `pipeline/`, `utils/`,
      `harness/`, `storage/`, and `app/` route segments, and `npx eslint .` passes.
- [ ] `overlayIcons.tsx` complies — renamed or relocated, with the decision noted in `## Comments`.
- [ ] The export-style rule is active and `ToolbarButton.tsx` and `FramePlayer.tsx` use the
      inline `export default function` form.
- [ ] **The rules are proven to bite:** adding a wrongly-cased file and a wrongly-exported
      component each make `npx eslint .` fail. Record the check in `## Comments`, then revert.
- [ ] `npx tsc --noEmit` passes.
- [ ] **Full** `npx vitest run` passes.

## Comments

- `knip` will likely report more than the three known items — unused exports are common in a
  codebase this size and were not exhaustively audited. Anything it finds beyond the three is a
  judgement call: delete it if it is genuinely dead, or add it to the ignore block with a reason.
  Do not silence a whole rule category to get to green.
- The `.claude/commands/pipeline-check.md` and `.claude/commands/theme-audit.md` manual checklists
  become partly redundant once the boundary and naming rules are live. Updating them is not in
  scope here; note in `## Comments` which of their checks are now mechanical so a later pass can
  trim them.
