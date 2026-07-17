# ViTPose Climber Identity — fix wrong-person Ground Truth seeds

Status: in-progress

> 2026-07-17 (tracker audit): issue 01 is done (`defe7ed`); issue 02 is
> ready-for-agent (cross-repo work in beta-scan-analysis, spec in
> `downloader-selector-fix.md`); issue 03 is the ready-for-human validation
> session that gates triage of issues 04–07 (intentionally needs-triage).

Spec inputs: `docs/adr/0019` (ViTPose scaffold, amended by this PRD), the cross-program
contract `.scratch/ground-truth-detection-eval/downloader-vitpose-contract.md`
(superseded in part by this PRD), and the downloader repo's `vitpose_job.py`.
Glossary: CONTEXT.md — **Climber**, **Ground Truth**, **Detection Frame**, **Scan Setup**,
**Test Video**.

## Problem Statement

When a Test Video contains people besides the Climber (spotters, belayers,
passersby), the ViTPose Ground Truth seed frequently poses the wrong person —
sometimes from the first Detection Frame, sometimes switching mid-clip. The
Climber selection data (tap + Climber Crop) *is* sent with every job; the failure
is in how the downloader's selector uses it:

1. **The tap has no frame anchor.** The scanner captures the tap's video time in
   `StepSetDetection` but drops it before Scan Setup; the request contract carries
   only `{x, y}`. The downloader therefore searches the *entire clip* for a box
   containing the tap — a bystander crossing that screen position at any moment
   can steal the seed.
2. **With a tap present, the Climber Crop is ignored entirely** by
   `_seed_climber`'s tap branch.
3. **Unbounded association slack.** The frame-to-frame stitching threshold grows
   0.04 per source frame of detection gap; after ~1 s of occlusion at 30 fps it
   exceeds the full frame, so the trajectory adopts whoever is detected next
   (mid-clip hijack).
4. **The no-tap fallback silently un-crops**: if the crop filters out every
   track, `_largest_track` falls back to the largest track anywhere in frame.

Because the flag-only review flow auto-accepts the seed, a wrong-person seed
either poisons Ground Truth or costs a full re-calibration.

## Solution

Two phases, gated by a validation pass between them.

**Phase A — fix the selector (both repos, small).** Carry the tap's video
timestamp through Scan Setup and the ViTPose request; anchor the downloader's
seed to the tap's frame, gate it with the Climber Crop, cap the association
slack, add size continuity on re-acquisition, and remove the silent un-crop
fallback. Recalibrate the problem videos and measure residual wrong-person rate.

**Phase B — recoverable selection (artifact v2 + swap UI), sized by Phase A's
residual error.** The downloader poses *every* tracked person on each Detection
Frame and writes them as candidates in a v2 artifact, with the stitched Climber
marked selected. In the Ground Truth reviewer, clicking another person makes
them the subject and **forward-propagates**: the reviewer follows the clicked
person's track (track id, bridged across id breaks by the same capped
nearest-box continuity) through subsequent Detection Frames until the trail runs
out. A wrong selection becomes one click instead of a re-run.

## Implementation Decisions

- **Tap timestamp.** `climberPoint` gains an optional `t` (video seconds of the
  frame the tap was made on): in `ScanSetupInput`, `setup.json`, the
  `ViTPoseRequest`, and the downloader contract (`climber_point: {x, y, t?}`).
  `canonicalSetupInput` includes `t` (rounded) **only when present**, so every
  existing setup's `setupHash` is stable until the user actually re-taps — no
  Ground Truth is orphaned by the schema change alone.
- **Seed anchoring (downloader).** With `t`: consider only tracker frames within
  a small window of `t`; prefer the box containing the tap, else the nearest
  center in the window. Without `t` (legacy): the *earliest* box containing the
  tap, else the current global-nearest behaviour.
- **Crop as a seed gate, not a trajectory gate.** The seed box's center must lie
  inside the Climber Crop (slightly expanded); the stitched trajectory may leave
  the crop freely — the Climber climbs out of it.
- **Slack cap + size continuity (downloader).** Association threshold becomes
  `min(base + per_frame * gap, cap)` with cap ≈ 0.18 normalized; a re-acquired
  box must be within a size-ratio band of the last associated box.
- **No silent un-crop.** If the no-tap crop filter excludes every track, the
  trajectory is empty → all frames seed `absent` → authoring is disabled with
  the existing "no Climber tracked" affordance, prompting a re-tap. Honest
  failure beats a confidently wrong seed.
- **Artifact v2 (Phase B).** `version: 2`; each frame keeps `keypoints` (the
  selected person — back-compatible with the existing scaffold consumer) and
  adds `candidates: [{trackId, box, keypoints}]` plus `selectedTrackId`.
  Candidates are every tracked person on that frame, capped at the 6 most
  prominent by summed area; batched ViTPose makes posing them cheap. The
  beta-scanner parser accepts v1 and v2.
- **Swap semantics (Phase B).** The clicked frame always re-seeds (explicit
  intent — even a flagged-absent frame becomes present/auto when you click a
  person on it). Forward propagation re-seeds frames whose review is `auto` or
  `human-flagged-wrong` (the wrong-person seed is what the flag complained
  about; the flag resets to `auto` with the new seed). It never touches
  `human-flagged-absent` frames or `human` frames (future editor). Propagation
  is silent-forward (no confirm batch); the filmstrip marks re-assigned frames.
- **Swap persistence.** Swaps live in the authoring session and persist through
  the saved `ground-truth.json` joints as usual. The artifact stays
  downloader-owned and is never rewritten by the reviewer.

## Testing Decisions

- **Downloader** (`test_vitpose_job.py`, stub tracker/pose seams as today): seed
  anchored to `t` window; tap-containing beats nearest; crop gate rejects
  out-of-crop seeds; slack cap prevents adoption across a long gap; size
  continuity rejects a mismatched re-acquisition; empty-trajectory on crop
  filter-out; legacy no-`t` earliest-containing behaviour.
- **beta-scanner utils**: `harnessSetup` — hash stable without `t`, changes with
  `t`, parser accepts optional finite `t ≥ 0`; `harnessViTPose` — v1 and v2
  parse, candidates validated, v2 selected keypoints pass through unchanged.
- **Propagation util** (new framework-agnostic module + tests): follows track
  id, bridges id breaks under the cap, stops at trail end, respects the review
  guard matrix (auto → replaced; flagged-wrong → replaced + reset; flagged-absent
  and human → skipped; clicked frame → always replaced).
- **Reviewer component** (extend existing jsdom test): candidates render,
  clicking one fires the swap callback, re-assigned frames marked in the stepper.

## Out of Scope

- Swap carry-forward across re-calibration — track ids are not stable across
  tracker re-runs, so swaps do not survive a re-seed; a residual wrong pick after
  Phase A costs one click per hijack segment, per calibration.
- Appearance-based re-identification (embedding similarity) in the tracker —
  revisit only if Phase A + swaps still leave unacceptable residual error.
- Any change to scoring, the batch runner, or the flag-only review vocabulary.
- Posing candidates on non-Detection frames (the artifact stays one entry per
  requested frame).

## Phasing gate

Issue 03 (recalibration validation) sits between the phases: Phase B issues stay
`needs-triage` until the residual wrong-person rate after Phase A is known, and
are sized (or dropped) accordingly.
