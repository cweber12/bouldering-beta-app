# Make the Test Suite Deterministic

Status: ready-for-agent
Disposition: actionable

Spec inputs: the suite itself — `__tests__/components/skeleton/LandingReplay.test.tsx`
and `__tests__/app/profile/mapViewportPolicy.test.tsx`.
Glossary: CONTEXT.md — **Landing Replay** (overlay & review), **Run** (persistence).

## Problem Statement

`npx vitest run` does not give the same answer twice. Over four consecutive full
runs on a clean `main`, three different tests failed and no single test failed
every time:

| Run | Failure |
| --- | --- |
| 1 | clean |
| 2 | `LandingReplay > opens on the first clip while the later ones are still undecoded` |
| 3 | `LandingReplay > cycles the playlist in file order and wraps to the first item` |
| — | `LandingReplay > draws straight to the stage once a single clip owns it again` |
| — | `mapViewportPolicy > keeps map mounted and map mode active when selecting a pin on own profile` |

This is worse than a broken test, because a broken test is information. A suite
that fails somewhere different each run trains everyone to re-run it until it
goes green, and the first real regression it catches gets re-run away with the
rest. It already cost a verification pass during
`harness-contract-adr0007-adoption` issue 04, where confirming the failures were
pre-existing meant stashing the work, switching to `main`, and running the pair
four times.

Both files fail for the **same reason**: they synchronise on a DOM proxy for
readiness instead of on the thing they actually need to be ready.

- **`LandingReplay`** drives a stubbed `requestAnimationFrame`. `advance()`
  drains whatever callbacks are registered *at that moment*, and the tests gate
  their first `advance(0)` on a caption appearing (`waitFor(getByText(…))`).
  Nothing links the caption to the component having scheduled its first frame.
  When it has not, `advance(0)` drains an empty set, the baseline the helper's
  own comment promises is never anchored, and every subsequent `advance` is one
  frame out — so the clip sits at time 0 instead of mid-handoff and the assertion
  reads an undefined layer.
- **`mapViewportPolicy`** counts mounts in a `useEffect(…, [])` inside its
  `next/dynamic` mock, then snapshots `mapStats.mountCount` immediately after an
  `await screen.findByRole(…)`. `findBy*` resolves on the render that puts the
  button in the DOM, which is not necessarily after mount effects have flushed —
  so the snapshot can read 0 while the later assertion reads 1, and the test
  reports a spurious remount.

Neither is a product bug. Both are real gaps in the test's own synchronisation,
and both are fixable without touching a line of `components/`.

## Scope

1. **Anchor `LandingReplay` on a scheduled frame, not a caption** — wait for the
   rAF stub to hold a callback before the first `advance`, so the baseline the
   helper documents is actually established. One shared seam; every test in the
   file inherits it.
2. **Anchor `mapViewportPolicy` on the observed mount, not the rendered button**
   — wait for `mountCount` to reach its expected value before snapshotting it.
3. **Prove it.** Run the full suite enough times in a row to make the claim
   mean something, and record the count in the issue.

## Non-Goals

- Changing any component under test. Both root causes are in the test harness;
  a product change to satisfy a test would be the wrong repair.
- A repo-wide flake sweep. Only failures actually observed get fixed here — a
  speculative hunt through 109 files is a different, much larger task.
- Retry-on-failure config. Retries hide flake rather than removing it, and would
  defeat the point of the change.

## Further Notes

- The two files were excluded from the final gate on
  `harness-contract-adr0007-adoption` issue 04 so that work could be verified.
  That exclusion is a workaround, not a precedent — no other run should need it.
- `LandingReplay` fails in more than one test and in a different one each run,
  which is why the fix belongs in the file's shared `advance`/setup seam rather
  than in whichever assertion happened to fail last.
