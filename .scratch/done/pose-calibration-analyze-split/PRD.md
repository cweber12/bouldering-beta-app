# Calibration without MediaPipe: uniform GT grid, video-keyed truth, Analyze step

Status: done
Disposition: done

> 2026-07-21 (closeout): issues 01–05 and 07 are done; issue 06 is terminal
> `wontfix` and superseded by `.scratch/done/pose-calibration-freshness/` plus ADR 0020
> (`65d35ba`) which keeps freshness/pairing hash-chained rather than
> video-identity paired. Old ground-truth-detection-eval issues 08/09 remain
> superseded by this feature's issues 04/05.

Spec inputs: `docs/adr/0018` (Ground Truth eval) and `docs/adr/0019` (ViTPose scaffold), both amended by this PRD; the flag-only review model shipped by `.scratch/done/pose-calibration-flag-review/`; the scoring design in `.scratch/actionable/pose-ground-truth-detection-eval/issues/08-headless-scoring-pass.md` (amended, not superseded, by this PRD); the analyzer handoff pattern established by `.scratch/actionable/pose-ground-truth-detection-eval/downloader-vitpose-contract.md`.
Glossary: CONTEXT.md — **Ground Truth**, **Detection Frame**, **Scan Setup**, **Test Video**, **Climber**, **Detection Error**.

## Problem Statement

Calibration no longer produces anything a MediaPipe detection contributes to: Ground Truth is seeded by ViTPose and reviewed flag-only, yet every calibration still runs a full throwaway MediaPipe scan. That scan survives for one reason — its sampled + adaptively-refined timestamps define the Detection Frame grid. This costs a slow scan pass on every calibration, and worse, it welds truth to the detector under test: refinement timestamps are re-probes of gaps where *that* MediaPipe version struggled, so a future MediaPipe version's frames will never land on them and those Ground Truth frames would falsely score `missing`. The grid dependency is also why the staleness rule discards accepted truth whenever crops are redrawn — even though truth landmarks are full-frame normalized and a crop change cannot geometrically invalidate them. Finally, there is still no way to actually run the current production detection pipeline against stored truth: the headless scoring pass remains unbuilt, and its spec assumes a frozen setup and a detector-derived grid.

## Solution

Remove MediaPipe from calibration entirely and replace the detector-derived grid with a **uniform 100 ms grid** computed from video duration by pure arithmetic. Every frame the production scan can ever probe — base samples at any tier stride and refinement re-probes alike — lands on a 100 ms multiple, so any run's frames align with the grid by exact set-intersection, reproducibly, forever. Calibration becomes: draw crops + tap the Climber → save the Scan Setup → the ViTPose job kicks off immediately with the grid (a loading screen replaces the scan pass) → flag-only review → Accept & save. Accepted Ground Truth becomes **video-keyed**: the staleness-discard rule dies, `setupHash` remains on the file as seed provenance only, and crop/tier edits never touch accepted truth or re-run the seed. Detection output moves to a new **Analyze** step — a per-video action plus a batch sweep — that runs the production MediaPipe pipeline exactly as the user-facing scan does, with the *current* Scan Setup and current implementation, scores it in-browser against the stored truth over the frames the run actually probed, and posts an append-only scored run. Superseded data is never deleted: every run is stamped with `appVersion`, `setupHash`, and `groundTruthHash`, and staleness is determined by hash comparison at analysis time. The analyzer's only change is relaxing its pairing gate from setupHash equality to video-identity pairing, specified in a handoff doc.

## User Stories

1. As a calibration author, I want calibration to skip the MediaPipe scan pass entirely, so that calibrating a Test Video costs seconds of review instead of a full detection run I never look at.
2. As a calibration author, I want the ViTPose seed job to start as soon as I confirm crops and the Climber tap, so that the wait happens on a loading screen immediately after setup instead of after a redundant scan.
3. As a calibration author, I want the Detection Frame grid computed from the video's duration at a uniform 100 ms stride, so that my Ground Truth covers the whole video evenly instead of wherever one detector version happened to struggle.
4. As a calibration author, I want the flag-only review flow (Auto / Wrong / Absent, one Accept & save) unchanged over the denser grid, so that reviewing ~10 frames per second of video stays a skim, not a chore.
5. As a calibration author, I want the filmstrip and review affordances to stay responsive on a few hundred grid frames, so that dense truth doesn't degrade the authoring experience.
6. As a calibration author, I want to edit crops, the Climber tap, tier, or panning on a video whose Ground Truth is accepted without the truth being discarded, so that I can tune Scan Setups against fixed truth — the whole point of having truth.
7. As a calibration author, I want editing the Scan Setup on a video with accepted Ground Truth to skip the ViTPose job entirely, so that setup tuning is instant and never burns downloader compute on a seed nobody will review.
8. As a calibration author, I want condition-label edits to keep saving independently of crops and of truth (as today), so that fixing a shadows label never touches either.
9. As a calibration author, I want an explicit re-seed action for a video with accepted truth, so that I can densify an old sparse-grid truth file onto the 100 ms grid when I choose to.
10. As a calibration author, I want my existing flags carried forward by timestamp when I re-seed, so that densifying or re-reviewing never costs me my prior review pass.
11. As a calibration author, I want ViTPose failure to keep gating Ground Truth authoring with a message and a retry (as today), so that I can never author self-graded or seedless truth — while the Scan Setup save itself still succeeds.
12. As a calibration author, I want the legacy-tap and seed warnings to keep surfacing in the new flow, so that Climber-identity hazards stay visible without the old preview.
13. As a harness user, I want a per-video Analyze action that runs the production MediaPipe pipeline exactly as the user-facing scan would — current implementation, current Scan Setup — so that scored runs measure what real users actually get.
14. As a harness user, I want a batch Analyze sweep over every corpus video with accepted Ground Truth, so that after a pipeline change I can re-score the whole corpus in one action.
15. As a harness user, I want Analyze to never fire automatically after accepting truth, so that authoring truth and evaluating detection stay separate acts and a messy pipeline state never posts a junk run.
16. As a harness user, I want each Analyze run posted append-only and stamped with `appVersion`, `setupHash`, and `groundTruthHash`, so that every score is attributable to exactly one implementation, one setup, and one truth.
17. As a harness user, I want detection output rendered in the Analyze step (skeleton over the video with its diagnostics), so that the eyeball view the old calibration preview provided still exists — now alongside verdicts instead of instead of them.
18. As a harness user, I want superseded runs kept rather than deleted when I edit a setup or re-flag truth, so that I can compare cropping-implementation and setup variations across history.
19. As the harness pipeline, I want scoring to cover exactly the Ground Truth frames the run actually probed (matched within 1 ms), so that a sparse-stride run is never charged `missing` for grid frames it was never scheduled to visit.
20. As the harness pipeline, I want a probe-coverage statistic (probed present GT frames / total present GT frames) on every rollup, so that a run scoring well over 20 % of the grid is distinguishable from one scoring well over 100 %.
21. As the harness pipeline, I want `detectionRateVsGT` computed over probed present frames, so that the denominator matches the frames the run could possibly have detected.
22. As the harness pipeline, I want the scoring ladder, thresholds, body-scale rule, and rollup shape unchanged from the grilled issue-08 design, so that this rework changes frame *selection*, not verdict semantics.
23. As the analyzer pipeline, I want truth paired to runs by video identity instead of setupHash equality, so that truth authored once keeps grading runs made under any Scan Setup.
24. As the analyzer pipeline, I want each run's `setupHash` reported as a grouping dimension on evaluation records, so that cross-setup comparisons stay possible after the gate relaxes.
25. As the analyzer pipeline, I want legacy sparse-grid ground-truth files to keep scoring without migration, so that the existing corpus stays valid (its timestamps are already 100 ms multiples — just fewer of them).
26. As a developer, I want the grid arithmetic in a pure framework-agnostic module, so that grid reproducibility is pinned by unit tests instead of by seek-loop behavior.
27. As a developer, I want the ground-truth schema, hash pre-image, and `GROUND_TRUTH_VERSION` untouched, so that video-keying is purely a semantics change and no stored file needs rewriting.
28. As a developer, I want the throwaway-scan wiring, Detection Preview phases, and staleness-discard logic deleted from the calibrator rather than disabled, so that the page shrinks to the flow it actually runs.
29. As a developer, I want the ViTPose request/poll contract unchanged, so that the downloader needs no code change — only awareness that jobs now carry ~5× more frames.
30. As a developer, I want the analyzer change specified in a handoff doc in the analyzer's established format, so that the cross-repo work is executable there without this conversation.
31. As a developer, I want ADRs 0018 and 0019 and the amended issues (08, 09) updated in the same feature, so that the documented grid, staleness, and scoring-flow decisions match the shipped ones.

## Implementation Decisions

- **MediaPipe leaves calibration.** The calibrator no longer loads a pose model or runs any detection: the throwaway scan, the Detection Preview phase, and their wiring are deleted. Tier remains part of the Scan Setup (and of `setupHash`) — it parameterizes Analyze runs, not truth.
- **Uniform grid.** A new pure grid module computes Detection Frame timestamps as `i × 100 ms` for `i = 0 … floor(duration / 100 ms)`, from the video element's duration. The grid is video-keyed and independent of setup, tier, and detector. It is sent verbatim as the ViTPose job's `frames` list (contract unchanged; echo-and-match within 1 ms as today) and becomes the one-record-per-frame basis of `ground-truth.json`.
- **Alignment by arithmetic, not replay.** Analyze runs sample with the production seek loop (base stride + adaptive refinement + adaptive crop), whose probe times are all 100 ms multiples by construction. Run frames match GT frames by timestamp within 1 ms; no tolerance-window matching, no forcing the run onto a schedule.
- **Calibration flow.** Confirm saves the Scan Setup, then immediately requests the ViTPose job with the grid and shows a loading state until `vitpose.json` lands. Flag-only review (unchanged model from calibration-flag-review) then Accept & save. ViTPose remains a hard requirement for authoring; on failure, review is gated with retry while the setup save stands.
- **Ground Truth is video-keyed.** The staleness-discard rule (and its "prior truth discarded" notice) is removed. `setupHash` stays on `ground-truth.json` purely as seed provenance: schema, canonical hash pre-image, and `GROUND_TRUTH_VERSION` are unchanged, so no stored file is rewritten. Carry-forward re-keys from setupHash-match to timestamp-match: prior flags land on grid frames with matching timestamps regardless of setup changes; new frames arrive auto-accepted.
- **Setup edits under accepted truth.** Editing crops/tap/tier/panning with accepted Ground Truth present skips the ViTPose job and review entirely. An explicit re-seed action re-requests ViTPose on the 100 ms grid (densifying legacy truth) with flags carried forward by timestamp. Label edits keep their existing independent save path.
- **Analyze step.** A per-video Analyze action plus a batch sweep gated on accepted Ground Truth (this amends the batch-runner issue 09). Analyze runs detection exactly as the user-facing scan — current implementation, current Scan Setup — scores in-browser against `ground-truth.json`, and posts one append-only run through the existing detections relay, stamped `appVersion` + `setupHash` + `groundTruthHash`, with `ScanDiagnostics` riding along. It never auto-fires on accept. Its rendered output (skeleton + diagnostics) replaces the deleted calibration preview.
- **Scoring domain.** The issue-08 ladder, thresholds (`DRIFT_MIN`, `WRONG_MAX`, `MIN_JOINT_COVERAGE`), body-scale rule, and rollup shape stand. Amendments: scoring covers only *probed* GT frames (those the run's detection-frame list matches within 1 ms); the rollup gains `probeCoverage` (probed present / total present); `detectionRateVsGT`'s denominator becomes probed present frames. Run frames absent from the grid should not exist (all probes are 100 ms multiples) and are ignored with a count if encountered.
- **Invalidation is stamp-based, never deletion.** Setup edits supersede prior runs via `setupHash` mismatch (kept as evidence about the old setup). Label edits invalidate nothing. Truth re-flags produce a new `groundTruthHash`, staling prior runs' scores while the rows record which truth scored them. Current-state views filter on current hashes; history remains for cross-setup and cross-version comparison.
- **Analyzer handoff.** One change in the analyzer repo, specified in a handoff doc following the downloader-contract pattern: the evaluation pairing gate relaxes from setupHash equality to video-identity pairing, with the run's `setupHash` carried as a reported dimension on evaluation records. Include a perf note that ViTPose jobs now carry ~5× more frames. No `vitpose_job` contract change.
- **No migration.** Legacy ground-truth files remain valid sparser grids (their timestamps came from the same 100 ms seek arithmetic) and keep scoring under intersection alignment; re-seeding densifies them opportunistically.
- **Docs.** ADR 0018 (grid definition, staleness rule, scoring-flow assumptions) and ADR 0019 (seed timing, grid source) are amended; issues 08 and 09 in the ground-truth-detection-eval feature are amended in place per the scoring-domain and batch-gate decisions above.

## Testing Decisions

Good tests here exercise external behavior at module and route seams — timestamps, hashes, parsed results, scoring verdicts, posted payload shapes — never internal helpers or page state. Seams confirmed with the user:

- **Grid module** (new test file, following the existing harness-util test pattern): grid arithmetic from duration, 100 ms multiples, boundary behavior at the final frame, determinism.
- **Ground Truth scaffold util** (existing tests evolve): carry-forward keyed by timestamp across setup changes and across grid densification; seed gating unchanged; no discard path remains.
- **Ground Truth schema util** (existing tests): pin that schema, hash pre-image, and version are unchanged — video-keying is semantics only.
- **Scoring module** (new test file, per the amended issue 08): synthetic GT/run pairs covering every verdict kind, body-scale degradation, probed-frame selection (sparse run over dense grid), `probeCoverage`, and the amended `detectionRateVsGT` denominator.
- **Payloads util and dev routes** (existing tests): posted run carries the scoring block and all three stamps; ViTPose and ground-truth routes unchanged.
- **Calibration page stays untested** (per the flag-review precedent): all decision-bearing logic (grid, gating, carry-forward, scoring) lives in framework-agnostic utils below it.
- **Analyzer gate** is tested in the analyzer repo's existing pytest suite, per its handoff doc.

## Out of Scope

- **Scanner data-contract Phases 1–2** (headless ORB cross-match batch; per-frame source/condition enrichment of scan exports) — separate PRDs, as before.
- **Climber-identity Phase B** (multi-candidate artifact v2, click-to-swap) — its own PRD, needs-triage.
- **Trend analysis / dashboards** over the accumulated scored runs — the analyzer consumes the records; presentation is its own work.
- **Changing scoring semantics** — ladder, thresholds, body-scale, verified/unverified handling all stand as grilled in issue 08; only frame selection and denominators change.
- **Moving detection or scoring out of the browser** — the production MediaPipe pipeline is browser-bound; scoring stays in beta-scanner and posts results.
- **Migration or rewriting of stored ground-truth files** — none is needed.

## Further Notes

- The uniform grid *fixes* a latent issue-08 hazard rather than merely equaling the old design: detector-derived refinement timestamps could never be re-probed by a future detector version and would have scored `missing` forever.
- Grid density is a named constant (the existing 100 ms sampling base), not a tier property — if it ever changes, old truth remains scoreable because alignment is intersection, not identity.
- The review filmstrip already handles flagged/seeded-absent marking; the only new pressure is volume (~300 frames for a 30 s clip). Thumbnail generation is seek-based and detector-independent, so no pipeline coupling is added — virtualize if profiling demands it.
- Issue 08's "Blocked by" list is stale after this PRD (its blockers merged); its amended spec becomes buildable as this feature's Analyze slice.
