# ViTPose Climber Identity — fix wrong-person Ground Truth seeds

Status: in-progress

> 2026-07-17 (tracker audit): issue 01 is done (`defe7ed`); issue 02 is
> ready-for-agent (cross-repo work in beta-scan-analysis, spec in
> `downloader-selector-fix.md`); issue 03 is the ready-for-human validation
> session that gates triage of issues 04–07 (intentionally needs-triage).
>
> 2026-07-17 (handoff `handoff-beta-scanner-prd-update.md`): issue 02 is done —
> all of Phase A landed in beta-scan-analysis (`6445d7a`, seed diagnostics
> `c7afff9`); `downloader-selector-fix.md` is archived. Phase A's residual
> error class then showed up on a real bundle (`planet-x/jGa4kCQkXaQ`), and the
> downloader used the Out of Scope escape hatch without waiting for the Phase B
> gate: **appearance-anchored stitching with backtrack recovery** shipped as
> its issue #19 (see Problem Statement item 5). Regression fixtures pin the bad
> bundle at 1913/1913 climber frames post-gap (previously 0) and exact
> motion-only parity on a known-good bundle (1391/1391); a 39-bundle batch
> validation surfaced two latent wrong-person bundles Phase A was silently
> getting wrong (`planet-x/R0Z6c1zlic0`, `midnight-lightning/…V8`), both
> verified fixed. Issue 03 is re-scoped to validate the appearance-anchored
> stitcher on the scanner's own corpus using the new `seedDebug.stitch`
> diagnostics; final batch numbers live in the downloader's
> `reports/stitch_batch_validation_v2.json` and on its issue #19.
>
> 2026-07-17 (issue 03 closed): all batches re-tested against the
> appearance-anchored stitcher; residual wrong-person rate is **~zero**. The
> phasing gate resolves to the ~zero branch — Phase B (issues 04–06) is
> deferred as escape-hatch scope, kept `needs-triage` rather than activated.
> Issue 07 (docs alignment) is the remaining live issue.

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
5. **Bounded slack still hijacks when a gap coincides with a bystander.**
   *(Observed after Phase A fixed 1–4; the hardest failure mode.)* On
   `planet-x/jGa4kCQkXaQ` the climber dropped out of detection for 5 frames,
   the gap-widened radius accepted a stationary bystander 0.165 away (inside
   the 0.18 cap), and the trajectory froze on them for ~75 s; the area-ratio
   band did not help. Solved by appearance (color signatures + backtrack
   recovery, downloader issue #19), not tighter geometry — tighter geometry
   was tried and rejected because it breaks traverses and down-climbs.

Items 1–4 are fixed by Phase A (issue 02, downloader `6445d7a`); item 5 by
appearance-anchored stitching (downloader issue #19).

Because the flag-only review flow auto-accepts the seed, a wrong-person seed
either poisons Ground Truth or costs a full re-calibration.

## Solution

Two phases, gated by a validation pass between them.

**Phase A — fix the selector (both repos, small). Shipped.** Carry the tap's
video timestamp through Scan Setup and the ViTPose request; anchor the
downloader's seed to the tap's frame, gate it with the Climber Crop, cap the
association slack, add size continuity on re-acquisition, and remove the silent
un-crop fallback. Recalibrate the problem videos and measure residual
wrong-person rate.

**Phase A follow-up — appearance-anchored stitching (downloader issue #19).
Shipped.** Fixes Problem Statement item 5. Each tracked box gets two
L1-normalized HSV hue-sat histograms (16×8) from shirt and pants sub-regions —
cheap color signatures, not embeddings — computed during the existing tracking
pass. The motion gate is unchanged but becomes a candidate pre-filter; among
candidates the winner minimizes gate-normalized motion distance +
Bhattacharyya appearance distance against a **rolling EMA reference** (updated
only on confident accepts — a frozen seed-time snapshot measurably decays over
an ascent). Histories without features reduce exactly to the old motion-only
behaviour. A wrong-person detector fires on a streak of ≥5 accepted frames
that mismatch the reference, sit on a foreign ByteTrack id, **and occur while
a confidently-matching person is visible elsewhere in the frame** — a
wrong-person claim requires positive evidence of the right person, so with no
other people visible it can never fire. On alarm, the walk discards the run
back to the last confident accept, rewinds, and re-associates (during
recovery, appearance strictness + area gate replace the motion gate, so the
climber high on the wall is reacquirable from a base-level anchor); if the
walk resumes on the very id it discarded, the alarm is ruled false and the
frames are restored. The artifact is unchanged (`version: 1`); the status
sidecar's `seedDebug` gains a `stitch` object (`stitchedFrames`, `idSwitches`,
`jumps`, `reseeds` — the latter with `discarded`/`recovered`/`restored`
counts) that issue 03 reads.

**Phase B — recoverable selection (artifact v2 + swap UI), sized by the
residual error after appearance stitching.** With issue #19 shipped, Phase B's
value proposition shrinks from routine correction tool to **escape hatch for
the residual** (similarly-dressed climbers, appearance-blind footage); issue
03 sizes or shrinks it accordingly. The downloader poses *every* tracked
person on each Detection Frame and writes them as candidates in a v2 artifact,
with the stitched Climber marked selected — fully compatible with the new
stitcher. In the Ground Truth reviewer, clicking another person makes them the
subject and **forward-propagates**: the reviewer follows the clicked person's
track (track id, bridged across id breaks by capped nearest-box continuity —
intentionally simpler than the downloader's scored motion+appearance
stitching; motion-only is fine for a human-supervised click flow) through
subsequent Detection Frames until the trail runs out. A wrong selection
becomes one click instead of a re-run.

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
- **Re-tap re-seeds — no backend work needed.** `climber_point.t` is honored
  end-to-end, so a re-tap that writes a new `t` into Scan Setup re-seeds at the
  tapped frame on the next job. This was the original motivation for issue 01
  and now works as designed.
- **Honest absence, more often.** The appearance-anchored stitcher prefers
  absent over wrong far more aggressively: frames where the Climber is
  undetected stay `keypoints: []` instead of adopting a bystander. The
  scanner's existing absent-seed affordance is exercised more; issue 03 should
  confirm the authoring UI handles longer absent stretches gracefully (the
  same Phase A stance — honest failure beats a confidently wrong seed — just
  applied to more frames).
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
- Embedding-based re-identification (OSNet-style) in the tracker.
  Color-histogram appearance re-ID is **in scope and shipped** in the
  downloader (its issue #19) — the escape hatch was used after Phase A's
  residual error was observed on real bundles. Embeddings should be considered
  only if color signatures prove insufficient (similarly-dressed climbers,
  grayscale/night footage).
- Any change to scoring, the batch runner, or the flag-only review vocabulary.
- Posing candidates on non-Detection frames (the artifact stays one entry per
  requested frame).

## Phasing gate

Issue 03 (recalibration validation) sits between the phases: Phase B issues stay
`needs-triage` until the residual wrong-person rate is known, and are sized (or
dropped) accordingly. With appearance-anchored stitching shipped, issue 03 now
validates that stitcher — not bare Phase A — and the residual rate is expected
to be far lower; the session confirms or refutes that on the scanner's own
corpus using `seedDebug.stitch`.
