# 05 - Restore the assembly script's test suite

Status: in-progress
Branch: fix/merge-script-shebang

## Parent

- .scratch/actionable/ui-landing-replay-multi-clip/PRD.md

## What to build

Make issue 02's drift guard actually run.

`__tests__/scripts/mergeLandingReplay.test.ts` does not execute and never has.
It fails at collection, before a single test:

```text
RolldownError: Parse failure: Invalid Character `!`
  … const resolve = __vite__cjsImport1_node_path["resolve"];#!/usr/bin/env node
At file: /scripts/merge-landing-replay.mjs:1:306
```

`scripts/merge-landing-replay.mjs` opens with `#!/usr/bin/env node`. The suite
imports that module, and Vite hoists its import interop above line 1, so the
shebang ends up mid-statement and the file will not parse. The shebang was there
in the file's only commit (`f651396`), so this is not a regression — the suite
has produced a passing result exactly zero times.

What that costs is specific. Issue 02 deliberately duplicated the contract's
guard and constants into the script, because `scripts/*.mjs` are run by bare
`node` with no build step and cannot import the TypeScript contract. The whole
justification for that duplication was that it is *checked* rather than trusted:
the suite imports both sides and asserts `isReplayItemLike` agrees with
`isReplayItem` across a fixture matrix. With the suite uncollected, the guard is
duplicated and unchecked, which is the arrangement issue 02 explicitly refused.

## User stories covered

- The script's mirror of the contract cannot drift unnoticed.

## Acceptance criteria

- [x] `npx vitest run __tests__/scripts/mergeLandingReplay.test.ts` collects and
      passes.
- [x] The script still runs as `node scripts/merge-landing-replay.mjs …`, with
      the same refusals and the same exit codes.
- [x] `npx vitest run` no longer fails to collect a suite (see the flakiness note
      below for what a full run does still do).
- [x] Whatever keeps the shebang out is written down where the next person would
      otherwise put one back.

## Comments

**The shebang is simply removed.** It is the only one in `scripts/` — the other
five (`audit-issues`, `diagnostics-report`, `fetch-mediapipe-models`,
`fetch-mediapipe-wasm`, `fetch-opencv`) all open with their docblock and are
invoked as `node scripts/<name>.mjs`. The README already documents this script
that way, no `package.json` bin entry refers to it, and the file has no execute
bit to make a shebang meaningful. So the fix restores the house convention
rather than working around the bundler, and the module docblock now says why the
line is absent — the next person to add one would otherwise be re-fixing this.

**The 14 tests pass unchanged once collected.** The suite was never wrong, only
unreachable; the script's mirrored guard and constants do agree with
`pipeline/overlay/landingReplayItem.ts` today. Nothing had drifted yet, which is
the good version of finding this.

**How it survived the quality gate.** The local workflow runs *targeted* tests
for a change, and the full `npx vitest run` that would have surfaced it lives in
CI — which has not run, because `main` is 37 commits ahead of `origin/main` and
nothing has been pushed. A collection failure also reports as `Test Files 1
failed | 102 passed` with `Tests 1217 passed` beside it, which reads like a pass
at a glance. No process change is proposed here, but that is the shape of it.

**Issue 02's acceptance box stays ticked.** The tests it claims exist do exist
and do pass; what was untrue was only that they had been observed doing so.

**Separately: the full suite is flaky under parallel load, and was before this.**
Three consecutive `npx vitest run` passes on this branch gave 1222/1222,
1222/1222, then one failure — in
`__tests__/app/profile/…` (`keeps map mounted and map mode active when selecting
a pin on own profile`), unrelated to anything here. An earlier run on
`feat/landing-replay-deferred-decode` had instead failed
`LandingReplay > plays only the first five items of an over-long playlist`, which
then passed 3/3 when its own file was run alone. Different test each time, always
green in isolation, so it is timing under worker concurrency rather than a real
defect. Out of scope for this issue and not chased here — but it is the reason a
single red full-suite run should be re-run before it is believed, and it deserves
its own issue if it starts costing anything.
