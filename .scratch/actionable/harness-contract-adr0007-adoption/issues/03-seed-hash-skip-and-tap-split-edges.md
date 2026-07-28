# Seed-hash skip, force, and the remaining tap-split edges

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/harness-contract-adr0007-adoption/PRD.md`
- Spec: `beta-scan-analysis/docs/handoffs/scanner-tap-split-adr0007.md` §1, §3, §5, §6
- Independent of issues 01 and 02; can land in any order

## What to build

The ADR 0007 edges left over once the core tap split is accounted for. The
substantive one is a live correctness bug: a re-calibration that moves the seed
currently leaves a **stale scaffold** on disk with nothing able to detect it,
because `setupHash` matches either way.

1. **Drop the `climber_point` alias.** `app/api/dev/corpus/vitpose/route.ts`
   sends `climber_point: b.seedTap` alongside `seed_tap` — putting the *seed* tap
   in the *setup* tap's slot, which is the exact conflation ADR 0007 exists to
   remove. Confirm the harness no longer reads it before deleting; if it still
   does, send `climberPoint` there and not `seedTap`.

2. **Handle `200 skipped`.** The endpoint now stamps a `seedHash` into
   `vitpose.json` covering seed tap, seed region, climb window, and video binary.
   An unchanged seed answers **synchronously**:

   ```jsonc
   { "status": "skipped", "reason": "unchanged-seed",
     "seedHash": "…", "artifactPath": "analysis/<route>/<video_key>/vitpose.json" }
   ```

   Treat it as success with the artifact already present. **Do not poll** — no
   status sidecar will ever be written, so today's code waits out the full
   `VITPOSE_POLL_TIMEOUT_MS` and then reports a failure that did not happen. A 202
   still means "running, poll the sidecar" exactly as before.

3. **Send `force`.** `"force": true` re-runs regardless of the seed hash. Wire it
   where a deliberate re-seed happens, so an operator can override the skip.

4. **Gate on the capability flag.** `GET /api/contract` advertises
   `"capabilities": { "decoupledSeed": true, "splitTaps": true }` with
   `apiVersion` still `1`. Gate the new request fields on `splitTaps` so a
   mixed-version deployment degrades **visibly** rather than silently writing
   fields an old harness ignores.

## Acceptance criteria

- [ ] The ViTPose request no longer carries the seed tap in a setup-tap-named
      field.
- [ ] A `200 skipped` response resolves the request as success, surfaces the
      artifact as present, and starts no polling — pinned by a test that fails if
      a poll is scheduled.
- [ ] A `202` response still polls the status sidecar exactly as today.
- [ ] `force` reaches the endpoint from the deliberate re-seed path and is absent
      (not `false`) otherwise, so the request stays byte-identical when unused.
- [ ] With `splitTaps` absent or false, the new fields are omitted and the
      operator is told the harness is on an older contract — not silently
      degraded.
- [ ] The capability probe is not fetched per request; it is resolved once and
      reused, consistent with how `/api/contract` is already consumed.

## Comments

### Both open questions answered against the harness source (2026-07-27)

Checked while closing issue 04. Read these before starting — they change what §1
and §2 have to do.

**§1 — the harness still reads `climber_point`, and the alias is actively
harmful.** Two call sites in `beta-scan-analysis/app.py`:

- `app.py:341` — `tap_src = payload.seed_tap if payload.seed_tap is not None
  else payload.climber_point`. Harmless: `seed_tap` wins, so the alias is dead
  weight on this path.
- `app.py:509-512` — `climber_point_t = payload.climber_point.t` when present,
  **else** `setup.json`'s `climberPoint.t`. Not harmless: this feeds the
  video-stats window, so sending `climber_point: b.seedTap` overwrites the
  *setup* tap's time with the *seed* tap's. The seed tap moves with every
  re-seed, so this is the ADR 0007 conflation still doing live damage in the
  harness's own stats.

So the answer to "confirm the harness no longer reads it before deleting" is: it
does read it. Per §1's own fallback instruction, send `climberPoint` there — or
omit the field entirely and let the harness fall back to `setup.json`, which is
the value we would be sending anyway.

**§2 — the export-race deletion does block `200 skipped`, exactly as suspected.**
The chain: `app.py:427` `seed_is_unchanged()` → `vitpose_job.py:918`
`artifact_seed_hash(bundle_dir)` → reads `vitpose.json` **from the bundle dir**.
Our relay `rm`s that file before forwarding
(`app/api/dev/corpus/vitpose/route.ts:186`), so `artifact_seed_hash` always
returns `None`, `seed_is_unchanged` is always `False`, and the harness can never
answer `skipped`. §2 is unbuildable until the deletion moves.

Of the two options §2 offers, **delete only after a 202** is the one to take. The
other ("stop deleting when the seed is unchanged") needs the seed hash computed
client-side, duplicating `vitpose_job.seed_hash` in TypeScript — a second
implementation of a hash whose inputs the harness owns, which will drift.
Deleting after a 202 needs nothing new: a 202 means a job really is starting, so
the artifact is about to be rewritten and clearing it first is safe; a 200
`skipped` means the artifact on disk *is* the answer and must survive.

**One hazard this removes:** the harness also writes a terminal skip sidecar
(`write_skip_status`, `app.py:433`) specifically so a client that only knows the
202-and-poll flow terminates instead of hanging. Our relay clears the status file
*before* the POST, and the harness writes the skip status *during* it, so that
ordering is already safe — the sidecar path works even before §2 lands. Worth
knowing: §2 is a correctness and latency fix, not a hang fix.

### Original notes

- **Found while building issue 01, and it likely blocks §2 outright:** the relay
  deletes `vitpose.json` from the bundle dir *before* forwarding the request
  (`app/api/dev/corpus/vitpose/route.ts`, the export-race fix for harness issue
  #21). If that file is the same artifact the harness hashes against — the skip
  response names `analysis/<route>/<video_key>/vitpose.json`, which resolves under
  the shared `HARNESS_ANALYSIS_ROOT` — then the harness can never see an
  unchanged seed and `200 skipped` can never fire. Confirm the storage layout
  with the harness before building the skip handler, then decide: stop deleting
  when the seed is unchanged (needs the seed hash client-side to know), or delete
  only after a 202 comes back. The export race the deletion prevents is real, so
  it cannot simply be dropped.

- Both call sites request scaffolds on the truth's 100 ms grid already
  (`Calibrator.tsx`, `ReseedSweeper.tsx`, via `buildDetectionGrid`), so no
  request-side sampling work is needed. The 8 legacy bundles at 1.0 s predate
  that code; the reset regenerates them.
- The skip response is also why a stale scaffold was previously undetectable:
  `seedHash` is the signal `setupHash` could never be. Worth stating plainly in
  the handoff reply (loss-recovery issue 07) that we adopted it.
- No detection behavior changes.
