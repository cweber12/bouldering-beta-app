# Read a posted detection run back off disk

Status: done
Branch: feat/harness-run-read
Merged: da23515
Type: AFK

## Parent

- `.scratch/actionable/dev-harness-review-surfaces/PRD.md`
- Blocks: issues 02 and 03 (nothing is reviewable until a run can be read)

## What to build

A `GET` on `app/api/dev/detections/route.ts`, which today exports only `POST`,
plus a validating client seam. This is the whole reason batch runs are
unreviewable: the payload is already durable on disk, and nothing in this repo
can fetch it.

Two shapes on one route:

- `GET /api/dev/detections?key=<bundleKey>` — list the Bundle's runs.
- `GET /api/dev/detections?key=<bundleKey>&run=<runTs>` — return one run's
  `data` (the `HarnessPosePayload`).

Read the local filesystem directly, the way the `setup` / `ground-truth` /
`vitpose` routes do — **not** by relaying to the downloader. The bundle
directory is already reachable through `HARNESS_ANALYSIS_ROOT`, and reviewing
past evidence must not require `HARNESS_API_BASE` to be up. The `POST` half
stays a relay; only reads go local.

Reuse rather than re-derive:

- `resolveBundleDir()` and its traversal-containment guard from
  `app/api/dev/shared.ts`.
- The envelope knowledge already encoded in `countRuns` in the same file: run
  files are `<ts>_pose.json` wrapping
  `{ video_key, route_folder, run_ts, written_at, type, data }`, and the
  `setupHash` lives at `data.setupHash`. `countRuns` currently opens that
  directory only to count and to read the hash — the listing here is the same
  walk with more fields, so factor the shared read rather than duplicating the
  directory scan.
- `runPairsWithTruth` from `utils/harnessFreshness.ts` for the pairing flag.

The list entry per run carries enough to pick a run *without* downloading it:
`runTs`, `writtenAt`, `setupHash`, `groundTruthHash`, `pairsWithTruth`, and the
scoring rollup's verdict counts. A run's frames and detector attempts are the
large part of the payload and must only travel on the single-run fetch.

New `utils/harnessRuns.ts` holds the client seam — `listRuns(bundleKey)`,
`loadRun(bundleKey, runTs)` — and the pure parsers. Mirror
`utils/harnessGroundTruth.ts`'s split: a framework-agnostic validating parser
plus a thin `fetch` wrapper. The route must trust the disk no more than it
trusts a request body: a hand-edited, truncated or legacy `_pose.json` has to
fail with a reason, not crash the reviewer or surface as `undefined` deep in a
render.

Legacy tolerance matters here — the corpus holds runs written before
`detectorAttempts`, before `missReason`, and before `selectionMethod` existed,
and those fields are documented as optional in `utils/harnessPayloads.ts`. A run
missing them is valid v1 evidence and must load, not 422.

## Acceptance criteria

- [x] `GET` with a `key` lists every `*_pose.json` in the Bundle's
      `detections/`, newest first, with `runTs`, `writtenAt`, `setupHash`,
      `groundTruthHash`, `pairsWithTruth` and verdict counts.
- [x] `GET` with `key` + `run` returns that run's `HarnessPosePayload`.
- [x] Neither shape returns frames or detector attempts on the *list* response.
- [x] A run written before `detectorAttempts` / `missReason` /
      `selectionMethod` existed loads successfully with those fields absent.
- [x] A malformed or truncated run file yields a clean error, never a partial
      object or an unhandled throw.
- [x] The route 404s outside development (`HARNESS_ENABLED`), 400s an invalid or
      traversing bundle key, and 404s an unknown run — matching the sibling
      routes' status vocabulary.
- [x] `POST` behaviour is unchanged: still a verbatim pass-through relay to the
      downloader.
- [x] No `any`. The parser returns a typed payload or an error.

## Tests

- `__tests__/api/dev/detectionsRoute.test.ts`, mirroring the structure of
  `setupRoute.test.ts`: the dev gate, key validation, traversal rejection, list
  and single-run happy paths, unknown run, malformed file.
- `__tests__/utils/harnessRuns.test.ts` for the pure parser, including the
  legacy-fields-absent case.

## Comments

Two things shipped beyond the written criteria, both from validating the parser
against the real corpus (396 run files under `HARNESS_ANALYSIS_ROOT`) before
writing the tests:

- **`malformed` on the list entry.** A run file the reviewer cannot open still
  belongs in the list — it exists on disk and the operator should see it — but a
  row showing all-null stamps is indistinguishable from a legitimate legacy run.
  One boolean says which.
- **Verdict counts keep the verified / unverified split** (`{ verified,
  unverified }` rather than one merged `VerdictCounts`). Merging them would hide
  exactly the distinction `harnessScoring` exists to preserve, and the split
  costs sixteen numbers.

The rollup nests its counts one level deeper than assumed while writing the
parser (`rollup.verified.counts`, not `rollup.verified`) — the corpus probe is
what caught it. All 396 run files parse; the 14 that yield no verdicts are
exactly the 14 that posted unscored.
