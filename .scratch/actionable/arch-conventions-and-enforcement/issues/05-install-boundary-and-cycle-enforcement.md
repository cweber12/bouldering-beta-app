# Install layer-boundary and cycle enforcement

Status: ready-for-agent
Type: agent

## Parent

- `.scratch/actionable/arch-conventions-and-enforcement/PRD.md`
- Decision: `docs/adr/0025-mechanically-enforced-layer-boundaries.md` (issue 01)

## Blocked by

Issues 03 and 04. The `utils/` boundary rule is unsatisfiable until `utils/` is actually a leaf,
so this cannot land before both moves are merged.

## What to build

Turn the layer graph from ADR 0025 into a rule that fails a build.

**Encode the graph.** Add `eslint-plugin-boundaries` (or `import/no-restricted-paths` via
`eslint-plugin-import` — either is acceptable; pick the one that expresses the graph with less
configuration and note the choice in the ADR if it differs from what the ADR assumed). The rules
to encode:

```text
app/         → components, hooks, harness, storage, pipeline, utils
components/  → hooks, harness, storage, pipeline, utils
hooks/       → harness, storage, pipeline, utils
harness/     → pipeline, storage, utils
storage/     → pipeline, utils
pipeline/    → utils
utils/       → (nothing)
```

plus one exception that is the point of the whole rule: **`pipeline/render/*` is importable only
by `hooks/`.** `components/` and `app/` may import every other `pipeline/` subdirectory.

`__tests__/` is exempt — a test may import whatever it tests.

**Add cycle detection.** `madge --circular` over the source directories, as a CI step. The
`utils/ ↔ pipeline/` cycle this PRD just removed must not be able to return silently.

**Fix the three violations** the `pipeline/render/*` rule surfaces. Each one bypasses a hook that
already exists and already wraps exactly the function being called:

- `components/compare/CompareSlot.tsx:12` imports `renderPoseVideo` → use `usePoseVideo`.
- `components/compare/CompareOverlayPlayer.tsx:6` imports `renderMultiPoseVideo` → use
  `useMultiPoseVideo`.
- `app/scan/page.tsx:28` imports `renderPoseVideo` → use `usePoseVideo`.

Both hooks expose the same `"idle" | "rendering" | "ready" | "error"` status enum and own the
object-URL lifecycle, so each call site should end up with less code, not more. Where a call site
needs behaviour the hook does not currently offer, extend the hook rather than keeping the direct
import — that is the reason the rule exists.

**Wire it into CI.** Add the `madge` step to `.github/workflows/ci.yml`. The boundary rules run
inside the existing `npx eslint .` step and need no new step. Note that lint currently runs _after_
tests in the workflow, so a boundary violation costs a full test run before it reports — moving
`npx eslint .` ahead of `npx vitest run` is a worthwhile part of this issue.

## Acceptance criteria

- [ ] The layer graph above is encoded as lint rules and `npx eslint .` passes on the clean tree.
- [ ] `utils/` is configured to import nothing from any other source layer.
- [ ] `pipeline/render/*` is importable only from `hooks/`; other `pipeline/` subdirectories stay
      importable from `components/` and `app/`.
- [ ] `__tests__/` is exempt from the boundary rules.
- [ ] **The rule is proven to bite:** a deliberately introduced violation of each of (a) the
      `utils/` leaf rule and (b) the `pipeline/render/*` rule makes `npx eslint .` fail. Record
      the two commands and their output in `## Comments` on this issue, then revert them.
- [ ] `CompareSlot.tsx`, `CompareOverlayPlayer.tsx`, and `app/scan/page.tsx` no longer import from
      `pipeline/render/`; each uses `usePoseVideo` or `useMultiPoseVideo`.
- [ ] `madge --circular` reports no cycles and runs as a CI step.
- [ ] `npx eslint .` runs before `npx vitest run` in `.github/workflows/ci.yml`.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npx vitest run __tests__/hooks/ __tests__/components/compare/` passes.
- [ ] Manual smoke: `npm run dev`, render an annotated WebM from the scan flow **and** from a
      two-slot route console. Both still produce a playable video.

## Comments

- These three call sites are the only runtime behaviour change in this PRD. Everything else is a
  pure move or a doc edit. The manual smoke pass is here rather than in the other issues for
  exactly that reason.
- If extending `usePoseVideo` turns out to be substantial rather than incidental, stop and split
  it out — the boundary rule can ship with these three files on a narrow, annotated exception and
  the hook work can follow. A rule that ships is worth more than a rule that waits.
