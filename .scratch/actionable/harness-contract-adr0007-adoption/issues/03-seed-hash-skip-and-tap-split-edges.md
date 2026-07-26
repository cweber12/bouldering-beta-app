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

- Both call sites request scaffolds on the truth's 100 ms grid already
  (`Calibrator.tsx`, `ReseedSweeper.tsx`, via `buildDetectionGrid`), so no
  request-side sampling work is needed. The 8 legacy bundles at 1.0 s predate
  that code; the reset regenerates them.
- The skip response is also why a stale scaffold was previously undetectable:
  `seedHash` is the signal `setupHash` could never be. Worth stating plainly in
  the handoff reply (loss-recovery issue 07) that we adopted it.
- No detection behavior changes.
