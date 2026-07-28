# Conventions doc, ADR 0025, and the Harness glossary entry

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-conventions-and-enforcement/PRD.md`

## Blocked by

Nothing. This is the first issue in the PRD.

## What to build

Write down the target architecture before any code moves. Docs only — this issue changes zero
source files.

**`docs/adr/0025-mechanically-enforced-layer-boundaries.md`.** Use ADR 0024's format (a `## Status`
heading with the value on the following line; the inline `Status: accepted` form used by 0020–0022
is the minority and the format cleanup is out of scope). The decision has two inseparable halves:
the layer graph is shaped so it _can_ be enforced, and the enforcement is what holds it.

Record the graph:

```text
app/         → components, hooks, harness, storage, pipeline (types + pure fns), utils
components/  → hooks, harness, storage, pipeline (types + pure fns), utils
hooks/       → harness, storage, pipeline (all), utils
harness/     → pipeline, storage, utils
storage/     → pipeline (types), utils
pipeline/    → utils
utils/       → nothing (strict leaf: no react, no pipeline, no hooks, no components, no app)
```

with `pipeline/render/*` importable only by `hooks/`.

Record these as considered-and-rejected, with the reason:

- Allowing type-only `utils/ → pipeline/` and banning only runtime edges. Nearly free — 9 of the
  10 edges are already type-only, and only `utils/backdropLuma.ts` would have to move — but it
  leaves 4,373 lines of Harness domain code in `utils/`, and `utils` keeps meaning "unclassified".
- Inverting the arrow: pushing `poseConstants`, `cvHelpers`, `imageHelpers`, `cropFraction` down
  into `pipeline/` so `utils/ → pipeline/` becomes the one legal direction. Fewer files move, but
  `cropFraction` and `imageHelpers` are used widely by components, which would then import from
  `pipeline/` — pushing UI code deeper into the processing layer.
- Enforcing `AGENTS.md`'s "Hooks consume pipeline functions" literally. Would mean re-exporting
  ~20 types through hooks and wrapping stateless drawing functions (`drawSkeleton`, `drawHolds`)
  in hooks that hold no state, across 15 files including the four largest components.
- A UI type-only rule (types flow freely, all runtime imports via hooks). Cleaner in principle,
  but it forces `FramePlayer`, `XrayStage`, and `LandingReplay` to receive drawing functions
  through hooks purely to satisfy the rule, in the files where the drawing call is the point.
- Coverage thresholds, an eslint `max-lines` cap, and pre-commit hooks. `max-lines` fails ~30
  files immediately and needs a baseline effort of its own; pre-commit hooks are new to this repo
  and slow every commit; coverage thresholds belong to a coverage PRD. CI stays the only gate.

**`docs/agents/conventions.md`.** The agent-facing rules, following the register of the existing
`docs/agents/*.md` files. Cover: the layer graph and what each layer may import; filename casing
per directory (PascalCase in `components/`, camelCase in `hooks|pipeline|utils|harness|storage`,
kebab-case for `app/` route segments); export style (`components/` default, everything else
named); and the divergent-duplicate rule — when consolidating implementations that differ,
preserve every variant behind an explicit parameter rather than picking one and letting the
outliers change.

**`CONTEXT.md`.** Add a **Harness** entry under the Diagnostics grouping. The term appears in ADRs
0017–0020, five PRDs, and 4,373 lines of code, but the glossary defines only its _outputs_ (Ground
Truth, Detection Error, Test Video, Scan Setup) and never the thing itself:

> **Harness**:
> The external detection eval tool that scores scanner output against authored Ground Truth over
> a corpus of Test Videos. Runs outside the scan flow and never during a user's Run.
> _Avoid_: test suite, scanner, analyzer.

Keep `CONTEXT.md` a glossary — no layer names, no file paths, no implementation detail. Those
belong in `conventions.md` and the ADR.

**`AGENTS.md`.** Two edits. Replace the absolute _"Hooks consume pipeline functions"_ under
**Hooks** with the narrowed rule (UI may import pipeline types and pure drawing/geometry
functions; `pipeline/render/*` is hooks-only, reached from UI via `usePoseVideo` /
`useMultiPoseVideo`). Add `harness/` to the Project Architecture tree with a one-line description,
and point at `docs/agents/conventions.md` from the scoped-instruction-files list the same way
`docs/agents/profile.md` is referenced.

## Acceptance criteria

- [ ] `docs/adr/0025-mechanically-enforced-layer-boundaries.md` exists, uses ADR 0024's `## Status`
      heading form, and states the layer graph including the `pipeline/render/*` restriction.
- [ ] The ADR records all five rejected alternatives above with the reason each was rejected.
- [ ] `docs/agents/conventions.md` exists and covers the layer graph, per-directory filename
      casing, export style, and the divergent-duplicate rule.
- [ ] `CONTEXT.md` has a **Harness** entry with an `_Avoid_:` line, placed with the other
      diagnostics terms, and introduces no file paths or layer names.
- [ ] `AGENTS.md`'s Hooks section states the narrowed UI→pipeline rule instead of the absolute one.
- [ ] `AGENTS.md`'s Project Architecture tree lists `harness/`, and its scoped-instruction-files
      list points at `docs/agents/conventions.md`.
- [ ] No file outside `docs/`, `CONTEXT.md`, and `AGENTS.md` is modified.
- [ ] `npx prettier --check` passes on every file touched.
- [ ] `node scripts/audit-issues.mjs` exits clean.
