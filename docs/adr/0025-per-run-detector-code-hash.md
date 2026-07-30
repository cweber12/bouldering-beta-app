# Per-run detector code hash alongside appVersion

## Status

accepted

Amends ADR 0006 (dev-local detection diagnostics), which introduced the
`appVersion` stamp, and serves ADR 0018's append-only evidence model — a
superseded run is told apart by its stamps rather than deleted, so the stamps
have to be true. Independent of ADR 0020 (calibration freshness hash chain),
which pins the _inputs_ a run replayed; this pins the _code_ that replayed them.

## Context

`appVersion` comes from `NEXT_PUBLIC_APP_VERSION`, which `next.config.ts`
resolves by shelling out to `git rev-parse` **once, when the dev server starts**.
Next then bakes it into the bundle. A hot reload re-instantiates the module graph
and changes what the detector does; it does not restart the server, so the stamp
does not move.

The field therefore answers "which build was this server started from", while
every consumer — the trend analysis, the version-regression comparison, the
harness's evaluation pairing — reads it as "which code produced this run".

This is measured, not hypothetical. Across 495 posted pose runs the analysis
harness found 13 distinct builds, and two rows carry the argument
(harness issue #130):

- **`c305954`, 67 runs.** Stamped one build, behaviourally running the next
  one's landmark-flip fix. Nothing on disk distinguishes the 33 runs on one day
  from the 34 on the next, and the control window those runs were captured for is
  permanently lost.
- **`deaa1c0`, 141 runs in a single day.** Intended as the within-build repeat
  set a run-to-run variance floor is fitted to. That number only means something
  if "within-build" is true; a hot reload landing mid-session silently folds a
  real behavioural delta into the noise floor, and every later "this change is
  within noise" verdict inherits it.

The mitigation of record is a line in the harness's instructions telling humans
to restart the dev server before every batch. That is a process workaround for a
data-integrity defect, it has already failed once, and — the part a stricter
process cannot fix — it leaves **no artifact to check**. A batch is trusted or
discarded on someone's memory of whether they restarted.

The symmetric case was already handled: the harness restricts version
comparisons to `(video, truthHash)` pairs present on both sides, so a truth
revision can never masquerade as a scanner change. Nothing stopped the opposite —
two different builds masquerading as one version.

## Decision

Stamp every **Scan Diagnostics** record with a second identifier,
`detectorCodeHash`, derived from the executing code, and keep `appVersion`
unchanged beside it.

**Both fields, because the signal is the pair.** Same `appVersion` with a
different hash is the mid-batch-hot-reload signature. Different `appVersion` with
the same hash is a commit that never touched detection — runs the harness may
legitimately pool, which _increases_ usable n rather than fragmenting it. Either
field alone detects neither case, so replacing `appVersion` was never on the
table; it also stays as the human-readable anchor.

**Derived per run, server-side, from the working tree.**
`app/api/dev/detectorSources.ts` reads the detector modules off disk and
SHA-256s them;
`GET /api/dev/detector-hash` serves the result, and the scan path
(`useVideoProcessor`) fetches it once at the _start_ of a run — before a frame is
touched, so the hash describes the code the run is about to execute rather than
whatever is on disk by the time diagnostics are assembled. It is one read of a
few hundred KB outside the frame loop, so it cannot land in `inferenceMs`.

**Never memoized.** A server-side cache would survive exactly the event the field
exists to catch: Next re-instantiates the _client_ module graph on a hot reload,
but a server module holding a memo is not necessarily re-instantiated with it, so
the cached digest would go on describing code that no longer runs. A frozen hash
is the original defect with extra steps, so the route sets `Cache-Control:
no-store` and the client asks with `cache: "no-store"`.

**Coverage is by directory, not by hand-maintained list.**
`pipeline/pose/**` and `pipeline/tracking/**` are walked recursively, plus the
detector entry (`hooks/useVideoProcessor.ts`), the model loader
(`hooks/usePoseModel.ts`), the per-tier detection knobs (`utils/poseTiers.ts`),
`utils/poseConstants.ts`, `utils/cropFraction.ts`, `utils/videoSeek.ts` (which
frame the detector is shown) and `utils/colorBalance.ts` (the only preprocessing
applied to that frame). ORB matching, hold detection, the overlay and render
modules, the frame analyzer and ORB preprocessor, the harness itself, and all UI
are excluded — none can alter a keypoint. A stale manifest is the one failure
mode that silently reinstates the defect, so a new module under either walked
directory is covered the day it lands.

**Determinism is the product.** Newlines are normalized (this corpus is authored
on Windows — CRLF vs LF must not change the hash of identical code), a leading
BOM is stripped, only repo-relative POSIX paths enter the digest, the module set
is sorted by codepoint (never `localeCompare`, whose order depends on the
machine's ICU data), and nothing time-, build- or environment-derived is mixed
in. A hash keyed to a timestamp or an absolute path still moves when the code
moves — it just also moves when the code has not, which makes every run
unpoolable and is far harder to notice than a frozen stamp.

**Read failure yields null, never a guess.** A partial digest would look valid
while describing the wrong code, so any unreadable module fails the whole
computation and the record carries `detectorCodeHash: null`. Readers treat a null
as unknown provenance and degrade to pre-ADR behaviour — the same fail-open rule
as an unstamped **Ground Truth** (ADR 0020).

The current hash is also surfaced on the harness corpus page beside `appVersion`
and in the diagnostics panel, because the failure this closes costs a whole
batch, and the cheapest possible check is "does the hash on screen match the last
run's".

## Consequences

- A hot reload mid-batch is now visible in the evidence instead of being a
  postmortem. Runs that used to pool silently across a code change now carry the
  proof that they should not.
- Commits that do not touch detection become poolable, so usable n goes up where
  today every commit looks like a potential behavioural change.
- Every run posted before this ADR carries no hash and stays exactly as
  attributable as it was — the change makes future occurrences detectable, not
  past ones. What `c305954` actually ran is not recoverable.
- The hash covers more than strictly necessary. That is deliberate: a hash that
  moves spuriously costs some pooling, while one that fails to move reinstates
  the defect. Touching a hashed module — including a comment in it — moves the
  hash and splits that run's group.
- `MatchDiagnostics` is unchanged. It records ORB matching, which the hashed set
  deliberately excludes, so a detector hash there would be misleading.
- The derivation reads the working tree, so the field is dev-only in practice.
  That is not a gap: **Scan Diagnostics** records are themselves produced only
  under `NODE_ENV === "development"`, so every record that exists carries the
  pair.
- Restarting the dev server before a batch stays good hygiene, but it is no
  longer the only thing standing between the corpus and a silent contamination.
