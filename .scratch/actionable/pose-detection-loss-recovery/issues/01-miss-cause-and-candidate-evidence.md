# Miss-cause and candidate evidence

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/pose-detection-loss-recovery/PRD.md`
- Handoff: `beta-scan-analysis/docs/handoffs/scanner-detection-improvements.md` §1
- Contract: `beta-scan-analysis/docs/handoffs/scanner-detector-attempt-evidence.md`
  ("Iteration 2 additions")

## What to build

Make a `missing` **Detector Attempt** causally legible without changing any
detection behavior. Half of all misses currently classify as `unexplained` in the
harness purely because a missing attempt reports nothing about where the
reacquire looked or what it saw there.

Add three additive, optional fields to `DetectorAttempt` in
`utils/harnessPayloads.ts` and populate them in `hooks/useVideoProcessor.ts`:

- `reacquireSteps?: { region: DetectorAttemptRegion; found: boolean }[]` — the
  ordered regions the reacquire searched. Today that is a single full-frame rung,
  so the array has at most one entry; issue 03 fills it out. `reacquireAttempted`
  and `reacquired` stay for compatibility.
- `bestUnselectedCandidateScore?: number | null` — the highest mean keypoint
  confidence among MediaPipe candidates that were not selected on this attempt,
  across every region searched. `null` when there were no unselected candidates.
- `missReason?: "no-candidates" | "identity-gated" | null` — `no-candidates` when
  MediaPipe returned zero poses on every region searched; `identity-gated` when
  candidates existed but every one fell outside the identity gate in
  `selectClimberPose`. `null` (or absent) on non-missing attempts.

`detectClimber` already computes the candidate list, so both new signals are
derivable there — return them from `ClimberDetectionResult` rather than
recomputing.

## Why this is first

Full-frame reacquire already searches every pixel of the frame, so "the crop was
misplaced" cannot on its own explain a miss. What reacquire does not relax is the
identity gate: `selectClimberPose` rejects every candidate further than
`REACQUIRE_GATE` from a stale predicted centroid. `missReason` is what separates
a gate rejection from a detector failure, and that distinction decides whether
issues 03 and 04 are correctly ordered.

## Acceptance criteria

- [ ] `DetectorAttempt` carries `reacquireSteps`, `bestUnselectedCandidateScore`,
      and `missReason` as optional fields; a payload without them stays valid.
- [ ] `reacquireSteps` records one entry per region searched during reacquire,
      in search order, each with its normalized region and whether it found the
      Climber. Full-frame rungs use `{ x: 0, y: 0, w: 1, h: 1 }`.
- [ ] `bestUnselectedCandidateScore` is populated from the candidates MediaPipe
      returned across the initial and reacquire searches, and is `null` when
      every returned candidate was selected or none was returned.
- [ ] A `missing` attempt on which MediaPipe returned no candidates anywhere
      reports `missReason: "no-candidates"`.
- [ ] A `missing` attempt on which candidates existed but none passed the
      identity gate reports `missReason: "identity-gated"`.
- [ ] `accepted`, `flipRejected`, and `qualityRejected` attempts do not carry a
      `missReason`.
- [ ] No detection behavior changes: search regions, gates, acceptance, and the
      resulting `frames[]` are byte-identical to before for the same input.
- [ ] Collection stays gated behind `collectDetectorAttempts`; user-facing scans
      pay no extra cost.
- [ ] Processor tests cover both miss reasons and the reacquire-step array with
      MediaPipe mocked at the module boundary.

## Target metrics (harness re-measures)

- `unexplained` miss share — 50.5% baseline, should fall as causes become
  assignable. Read from `eval_crop_quality_miss_causes.csv`.
- Reacquire success rate — 4.3% baseline, unchanged by this issue (it is the
  instrument, not the fix).

## Comments

- Do not add `selectionDistance` or a raw nearest-candidate distance here; the
  contract defers both. Issue 07 proposes `nearestCandidateDistance` to the
  harness as a contract question.
- Note for the handoff reply: the existing corpus can already separate the two
  miss classes without a new run — a `missing` attempt with `candidateCount > 0`
  was gated out, not undetected.
