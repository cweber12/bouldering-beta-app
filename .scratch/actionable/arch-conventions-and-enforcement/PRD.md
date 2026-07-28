# Mechanically-enforced architecture conventions

Status: ready-for-agent
Disposition: actionable

Spec inputs: repository-wide architecture audit (2026-07-28) covering 207 source files /
47,762 lines across `app/`, `components/`, `hooks/`, `pipeline/`, `storage/`, `utils/`;
grilling session recorded in `docs/adr/0025-mechanically-enforced-layer-boundaries.md`.
Glossary: CONTEXT.md — **Harness**, **Ground Truth**, **Test Video**, **Detection Error**,
**Status** (tracker), **Disposition**.

## Problem Statement

The repository's stated architecture is largely intact — `pipeline/` has zero React imports and
zero edges into `hooks/`, `components/`, or `app/` — but **none of it is checked by a machine**.
`eslint.config.mjs` contains exactly one custom rule (`@typescript-eslint/no-unused-vars`). Every
architectural rule in `AGENTS.md` and `pipeline/CLAUDE.md` is prose that an agent is expected to
grep by hand; `.claude/commands/pipeline-check.md` and `.claude/commands/theme-audit.md` exist
precisely because those rules have no other enforcement.

Prose-only rules decay silently, and two have already drifted:

1. **`utils/` and `pipeline/` are mutually dependent.** Ten import edges run each way. At
   directory level this is a cycle, which means no layer-boundary rule can be written at all until
   it is resolved. The dominant cause is that 16 `harness*.ts` files — 4,373 lines, 9% of the
   codebase — live flat in `utils/` while legitimately depending on `pipeline/` types. `utils/`
   has become the directory for everything unclassified rather than for leaf helpers.

2. **`AGENTS.md` says "Hooks consume pipeline functions", but 15 UI files import `pipeline/`
   directly.** Most of those imports are `import type` or pure canvas-drawing calls and are
   entirely reasonable; the rule as written is stricter than anything the codebase intends to
   obey, so it is ignored wholesale rather than obeyed selectively. Meanwhile the genuinely
   questionable cases — three components calling `pipeline/render/*` (MediaRecorder + async
   lifecycle) directly, bypassing the `usePoseVideo` / `useMultiPoseVideo` hooks that already
   wrap exactly those functions — go unnoticed inside the noise.

A third, smaller drift affects the tracker itself: `docs/agents/issue-tracker.md` documents the
`Status:` / `Branch:` / `Merged:` metadata but no body template, even though 115 of 122 issue
files share one. The undocumented `Type:` line carries five values (`AFK`, `interactive`, `agent`,
`HITL`, `AFK + external`) for two concepts, and is missing from 41 issues.

The risk is not that the architecture is wrong. The risk is that it is unverifiable, so each new
PRD is authored against rules nobody can check, and the gap widens.

## Solution

Turn the architecture from prose into executable rules, in an order where each rule lands together
with the change that makes it green.

The target layer graph:

```text
app/         → components, hooks, harness, storage, pipeline (types + pure fns), utils
components/  → hooks, harness, storage, pipeline (types + pure fns), utils
hooks/       → harness, storage, pipeline (all), utils
harness/     → pipeline, storage, utils          ← new top-level, peer of pipeline/
storage/     → pipeline (types), utils
pipeline/    → utils
utils/       → nothing (strict leaf)
```

`pipeline/render/*` is importable only by `hooks/`. UI reaches rendering through the existing
`usePoseVideo` / `useMultiPoseVideo`.

Sequence: document and decide (issues 01–02) → make the graph true (03–04) → switch on the rules
that enforce it (05–06). The `harness/` extraction is deliberately early: the tree is clean with
no branch in flight, and three queued P1 PRDs write directly into `utils/harness*.ts`, so the move
only gets more expensive with time.

## User Stories

1. As a maintainer, I want the layer graph expressed as a lint rule, so that a boundary violation
   fails a build instead of surviving until someone greps for it.
2. As a maintainer, I want `utils/` to be a strict leaf, so that "where does this helper go?" has
   one answer and the directory stops absorbing unclassified code.
3. As a maintainer, I want the Harness to be a named top-level module, so that 4,373 lines of
   bounded dev-tooling domain code stop masquerading as generic utilities.
4. As a maintainer, I want the UI→pipeline rule narrowed to what the codebase actually intends,
   so that the rule is obeyed rather than ignored wholesale.
5. As a maintainer, I want async rendering to go through its hooks, so that MediaRecorder
   lifecycle has one owner rather than three call sites plus two hooks.
6. As a maintainer, I want circular imports detected in CI, so that the cycle we are fixing cannot
   silently return.
7. As a maintainer, I want dead code and unused dependencies reported automatically, so that
   removal is driven by evidence rather than by memory.
8. As a maintainer, I want filename casing and export style enforced, so that the conventions
   72 of 73 components already follow become guarantees.
9. As an agent, I want the conventions written down in one place, so that I do not have to infer
   them from surrounding code or from three separate `CLAUDE.md` files.
10. As an agent, I want the issue body template documented, so that issues I author match the 115
    that came before rather than inventing a shape.
11. As an agent, I want `Type:` to have a closed vocabulary, so that "can this run unattended?"
    has an unambiguous answer.
12. As a reviewer, I want each enforcement rule proven to fail on a real violation, so that a
    green build is evidence rather than assumption.
13. As a reviewer, I want the pure-move issues verifiable by `tsc` alone, so that behaviour-
    preservation is a property of the change rather than a claim about it.
14. As a future reader, I want the rejected alternatives recorded, so that the shape of the graph
    is explicable rather than arbitrary.

## Implementation Decisions

- **Enforce by lint, not by prose.** Layer boundaries via an import-boundary rule, cycles via
  `madge --circular`, dead code and unused dependencies via `knip`, naming via
  `unicorn/filename-case`. Recorded in ADR 0025.
- **Deliberately not adopted:** coverage thresholds, an eslint `max-lines` cap, and pre-commit
  hooks. `max-lines` would fail ~30 files on day one and needs a baseline this PRD is not taking
  on; pre-commit hooks are new to this repo and slow every commit; coverage thresholds belong with
  a coverage PRD, not this one. CI remains the only gate.
- **`scripts/audit-issues.mjs` stays agent-run.** It gains a new drift check but is not wired into
  CI — AGENTS.md already makes running it a session-completion gate.
- **`harness/` becomes a top-level peer of `pipeline/` and `storage/`**, sitting above `pipeline/`
  and permitted to import it. This resolves 6 of the 10 `utils/ → pipeline/` inversions in one
  move. Rejected: allowing type-only upward imports (leaves the domain module in `utils/`), and
  inverting the arrow by pushing `poseConstants` / `cvHelpers` / `cropFraction` into `pipeline/`
  (pushes UI code deeper into the processing layer).
- **The UI→pipeline rule is narrowed, not enforced as written.** UI may import pipeline types and
  pure drawing/geometry functions; it may not import `pipeline/render/*`. Rejected: a total ban
  (would wrap stateless drawing functions in hooks across 15 files) and a type-only rule (would
  break the canvas components where the drawing call is the whole point).
- **The issue template is canonized descriptively.** 115 of 122 issues already use it; the doc is
  being corrected to match reality, not to impose a new shape.
- **`Type:` collapses to two values** — `agent` and `interactive`. New issues in this PRD already
  use the target vocabulary.
- `knip` lands with an annotated ignore block for the three known-dead items so it can go green
  immediately; `arch-consolidation-cleanup` issue 09 deletes them and empties the block.

## Testing Decisions

- Pure-move issues (03, 04) are verified by `npx tsc --noEmit` plus a **full** `npx vitest run`.
  Under `"strict": true` with `moduleResolution: "bundler"`, a move that type-checks and leaves
  every test green cannot have changed behaviour — there is no runtime path a broken import could
  survive. No new tests are written for a move.
- Enforcement issues (05, 06) must prove the rule bites: acceptance requires both a green run on
  the clean tree **and** a demonstration that a deliberately introduced violation fails. A rule
  that passes because it matches nothing is worse than no rule.
- The three `pipeline/render/*` call-site fixes in issue 05 are the only runtime change in this
  PRD and are covered by the existing `usePoseVideo` / `useMultiPoseVideo` suites plus a manual
  smoke pass confirming the annotated WebM still renders in both scan and compare.
- Doc/tracker issues (01, 02) are verified by `node scripts/audit-issues.mjs` exiting clean.

Prior art to follow: the existing pipeline contract tests that rely on deterministic fixtures, and
the module-boundary mocking pattern used wherever OpenCV behaviour is isolated.

## Out of Scope

- **Scan orchestration.** `hooks/useVideoProcessor.ts` (1,755 lines) and the eight pure functions
  it exports belong to `.scratch/actionable/scan-pipeline-isolation-testability/` issues 02–06.
  This PRD does not touch that file beyond mechanical import rewrites.
- **All consolidation and deduplication work** — that is `arch-consolidation-cleanup`.
- **`__tests__/` restructuring.** `__tests__/pipeline/` is flat against 8 source subdirectories
  and `__tests__/api/` is a synthetic tree with invented filenames. Only tests belonging to files
  this PRD moves are relocated, and only to keep the mirror rule true.
- **Doc and ADR hygiene** — the stale `CLAUDE.md` line pointing at `.scratch/<feature>/`, the
  duplicate ADR number 0014, the three competing ADR `Status` conventions, the two
  `.scratch/done/` folders lacking a `PRD.md`, and `components/CLAUDE.md` describing a compare
  flow that `RouteConsole.tsx` replaced.
- **New test coverage** for the four untested S3 routes, `components/ui/`, or `utils/firebase/`.
- **UI file splits.** `RouteConsole.tsx` and the two profile pages stay as they are.

## Further Notes

- `arch-` is a new domain prefix alongside `pose-`, `scan-`, `dev-`, `ui-`, `auth-`, `map-`.
- This PRD is P1 and sits at the top of `.scratch/ROADMAP.md` `Now`, ahead of the three P1 pose
  PRDs. The justification is timing, not importance: the `harness/` move is cheapest while nothing
  is in flight, and every pose issue authored afterwards is written against final paths.
- Issue order matters. 05 cannot land before 03 and 04, because the `utils/` boundary rule is not
  satisfiable until `utils/` is actually a leaf.
