# Anchor the flaky timing tests on real readiness signals

Status: done
Branch: test/anchor-timing-tests
Merged: e408eeb
Type: AFK

## Parent

- `.scratch/done/test-suite-flake-stabilisation/PRD.md`

## What to build

Two test files fail intermittently, in a different test each run, for the same
underlying reason: each waits for something in the DOM as a stand-in for the
state it actually depends on, then reads that state before it has settled.

### 1. `__tests__/components/skeleton/LandingReplay.test.tsx`

The file stubs `requestAnimationFrame` into a `rafCallbacks` map and drives time
with `advance(ms)`, which drains whatever is registered at that instant. Its own
comment states the contract: *"the first call after mounting only anchors the
baseline; every call after that advances replay time by exactly `ms`."*

That contract silently breaks when the component has not yet scheduled a frame.
The tests gate on a caption:

```ts
await waitFor(() => expect(screen.getByText("Slab Master")).toBeTruthy());
advance(0);   // ← may drain an empty map: no baseline anchored
```

The caption renders from the fetched playlist; the first rAF is scheduled
separately. When `advance(0)` finds the map empty, every later `advance` is one
frame out — the clip sits at time 0 instead of mid-handoff, no layer composite
is recorded, and `(blits.get(stage) ?? []).at(-1)?.source` is `undefined`.

Fix it at the shared seam so every test in the file inherits it — wait for the
stub to actually hold a callback before the first `advance`. Something like a
`waitForFirstFrame()` helper the tests call in place of (or as part of) their
current `waitFor`. Do **not** patch the individual assertions; at least three
different tests in this file have been observed failing, and the next run picks
a different one.

### 2. `__tests__/app/profile/mapViewportPolicy.test.tsx`

The `next/dynamic` mock counts mounts in an effect:

```tsx
useEffect(() => { mapStats.mountCount += 1; }, []);
```

The test then snapshots that counter straight after a `findBy*`:

```ts
await screen.findByRole("button", { name: "Mock pin click" });
const mountCountBeforeClick = mapStats.mountCount;   // ← may still be 0
```

`findBy*` resolves on the render that puts the button in the DOM, which does not
guarantee mount effects have flushed. When they have not, the snapshot is 0, the
later read is 1, and `expect(mapStats.mountCount).toBe(mountCountBeforeClick)`
reports a remount that never happened — the exact opposite of what the test is
asserting. Wait for the counter itself to reach its expected value before
snapshotting it.

Check the sibling assertions at the same time: `mountCountAfterFirstMapView`
(around line 193) snapshots the same counter the same way and has the same hole,
even though it has not been observed failing yet.

## Acceptance criteria

- [x] `LandingReplay` establishes its rAF baseline from the stub actually holding
      a callback, not from a caption appearing, and the fix lives in the file's
      shared setup/helper rather than in individual assertions.
- [x] `mapViewportPolicy` waits for the mount counter to settle before every
      snapshot of it, including the ones not yet observed failing.
- [x] No file under `components/`, `app/`, `hooks/` or `utils/` is modified — if a
      product change looks necessary, stop and say why rather than making it.
- [x] `npx vitest run` passes **10 consecutive times** with no exclusions. Record
      the actual run count and any failure seen in `## Comments`.
- [x] The two files are no longer excluded from anyone's verification gate.

## Comments

- Observed failures, all on a clean `main`, all reproduced with the two files run
  in isolation as well as in the full suite:
  - `LandingReplay > draws straight to the stage once a single clip owns it again`
  - `LandingReplay > opens on the first clip while the later ones are still undecoded`
  - `LandingReplay > cycles the playlist in file order and wraps to the first item`
  - `mapViewportPolicy > keeps map mounted and map mode active when selecting a pin on own profile`
- Rate is roughly 1 run in 3 for `LandingReplay` and 1 in 4 for
  `mapViewportPolicy`, so a single green run proves nothing — hence the
  10-consecutive-run criterion.
- Resist `test.retry` or `--retry`. It would turn a red suite green without
  removing a single race, and the next real regression would be retried away too.
- Both root causes are races the test owns. If a fix seems to require changing
  `LandingReplay.tsx` or the profile page, that is a signal the diagnosis moved —
  write down what changed before touching product code.

### Closing record

Both diagnoses held; no product code was touched. `LandingReplay` got a
`waitForFirstFrame()` seam that waits for the rAF stub to hold a callback and
then anchors the baseline, and all ten anchor sites in the file go through it —
including the re-anchor after a resume, so no hand-rolled anchor is left.
`mapViewportPolicy` got `waitForMapMounts(count)`, used at both snapshots.

**Verification: `npx vitest run` × 10 consecutive, 0 failures, 1404 tests each.**
No exclusions — and none existed to remove: the workaround during
`harness-contract-adr0007-adoption` issue 04 was an ad-hoc command-line filter,
never checked in, so nothing in the repo referenced these files.

Reproduction before the fix was load-dependent. `mapViewportPolicy` failed on the
third of three full-suite runs with the anchor instrumented. The `LandingReplay`
race never fired on this machine (8 isolated runs, 3 full-suite runs) even with a
probe that threw when `advance(0)` found an empty map — the fix rests on the
mechanism being demonstrable from the code rather than on a local repro.

### Scope added: two more flakes, both blocking the 10-run gate

The gate surfaced two failures outside the two named files. Neither could be left
alone without making the 10-consecutive-run criterion unreachable, and both are
the same defect — an assertion synchronised on a proxy instead of the state it
depends on — so they were fixed here under the PRD's rule that only failures
actually observed get fixed. Both fixes are test-only.

- `useVideoProcessor > sums MediaPipe latency across every pass on the attempt`
  busy-waited 2 ms per mocked MediaPipe pass and compared real wall-clock, so a
  scheduler preemption during the one-pass attempt could make it out-measure the
  four-pass one and invert the assertion. Each pass now advances a stubbed
  `performance.now()` by exactly its charge — the hook reads that clock nowhere
  else — which let the assertion tighten from *the miss cost more* to the exact
  sums (2 ms and 8 ms), i.e. the summing the test is named for.
- `ClimbsMap > hides below threshold and re-renders from cache on zoom re-entry`
  slept 700 ms against a 600 ms debounce. Two candidate anchors were also wrong
  and are worth recording: the `Zoom in to see nearby crags` hint appears a full
  debounce early because `onZoomEnd` sets the zoom state synchronously, and a
  bare `expect(osmClearLayers).toHaveBeenCalled()` was already true from the
  first query because `renderOsmFeatures` clears the layer itself — that
  assertion had been passing vacuously. It now waits for the clear *count* to
  grow past a baseline, the only signal that the zoom-out query ran. Fixing it
  also closed a latent false pass: `markersAfterFirstQuery` was snapshotted right
  after the fetch call rather than after the render, so it could be captured as 0
  and make the final `toBeGreaterThan` trivially true.

The suite is deterministic at 10 runs, not proven deterministic forever. If a
fifth flake appears it wants its own issue rather than more growth here.
