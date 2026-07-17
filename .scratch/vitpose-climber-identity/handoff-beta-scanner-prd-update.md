# Handoff: update the ViTPose Climber Identity PRD + issues for the appearance-stitching backend

For an agent working in **beta-scanner**. Drop this next to `PRD.md` in
`.scratch/vitpose-climber-identity/` and work through it. Everything below
describes work already merged (or in final validation) in the downloader repo
(`beta-scan-analysis`); nothing here asks for new scanner code — it asks you to
bring the PRD, its issues, and `downloader-selector-fix.md` in line with a
backend that has moved two steps past them.

## What changed in the downloader since the PRD was written

**1. Phase A (issue 02) is done.** Every item in `downloader-selector-fix.md`
is implemented and unit-tested in `vitpose_job.py` (commit `6445d7a`, seed
diagnostics in `c7afff9`):

- Tap-anchored seeding: with `climber_point.t`, only frames within ±0.75 s are
  searched; containing-box beats nearest-center; **no global fallback**.
  Without `t`: earliest containing frame, then nearest (legacy).
- Crop gates the seed (center inside crop +10% per side), seed only.
- Association slack capped (`min(0.08 + 0.04·gap, 0.18)`), area-ratio band
  [1/3, 3×] on re-acquisition after a gap.
- The silent un-crop fallback in `_largest_track` is removed: crop filtering
  everyone out yields an empty trajectory → all frames `keypoints: []`.

Mark issue 02 done and archive `downloader-selector-fix.md`.

**2. Phase A was not enough, and the "out of scope" escape hatch was used.**
On a real bundle (`planet-x/jGa4kCQkXaQ`), the capped, area-gated stitcher
still hijacked: the climber dropped out of detection for 5 frames, the
gap-widened radius accepted a stationary bystander 0.165 away, and the
trajectory froze on them for the remaining ~75 s. The area band did not help
(bystander was within 3× of the climber's box). This is exactly the residual
error class the PRD said would trigger a revisit of appearance-based re-ID —
so the downloader implemented it (its issue #19, `fix(vitpose): appearance-
anchored climber stitching with backtrack recovery`):

- **Appearance features at track time.** Each tracked box gets two L1-
  normalized HSV hue-sat histograms (16×8) from box sub-regions — shirt
  (center 50% width, 20–55% height) and pants (60–90% height) — computed
  during the existing tracking pass. Not embeddings; cheap color signatures.
- **Scored association.** The motion gate is unchanged (generous, traverse-
  and pan-tolerant) but is now only a candidate pre-filter; among candidates
  the winner minimizes gate-normalized motion distance + Bhattacharyya
  appearance distance against a **rolling EMA reference** (updated only on
  confident accepts; never a frozen seed-time snapshot — a fixed reference
  measurably decays over an ascent). Histories without features (stubs,
  legacy) reduce exactly to the old motion-only behavior.
- **Wrong-person detector with backtrack recovery.** A streak of ≥5 accepted
  frames that (a) mismatch the reference, (b) sit on a foreign ByteTrack id,
  and (c) occur **while a confidently-matching person is visible elsewhere in
  the frame** ⇒ the walk discards the whole contiguous run on the offending
  ids back to the last confident accept, rewinds, and re-associates; during
  recovery, a confident appearance match may be taken from anywhere in the
  frame (appearance strictness + area gate replace the motion gate), so the
  climber high on the wall is reacquirable from a base-level anchor. If the
  walk ends up resuming on the very id it discarded, the alarm is ruled false
  and the frames are restored — this protects single-climber videos, top-lip
  mantles, and exposure shifts, where appearance lurches without any wrong
  person existing.
- Condition (c) is the safety keystone: **a wrong-person claim requires
  positive evidence of the right person.** No other people visible ⇒ the
  detector can never fire.

**3. Validation evidence (downloader repo).** Real tracker histories (boxes +
appearance) of the bad bundle and a known-good bundle
(`planet-x/DEDBeWcqxK8`, two bystanders at the base) are frozen as gzipped
fixtures under `tests/fixtures/`, driving regression tests: the bad run must
stay on the climber for **every** post-gap frame (1913/1913, previously 0);
the good run must keep **exact parity** with motion-only stitching
(1391/1391). A 39-bundle batch validation also surfaced two **latent**
wrong-person bundles Phase A was silently getting wrong — verified visually:

- `planet-x/R0Z6c1zlic0`: old trajectory sat on a bystander at the base;
  new is on the climber.
- `midnight-lightning/Midnight_Lightning_V8___Yosemite__CA`: old sat on a
  spotter standing under the climber with hands up; new is on the climber.

Final batch numbers land in the downloader's
`reports/stitch_batch_validation_v2.json` and on its issue #19.

**4. New observability the scanner can use (contract-safe).** The status
sidecar's `seedDebug` gained a `stitch` object:

```jsonc
"stitch": {
  "stitchedFrames": 2298,
  "idSwitches": [{ "sourceFrame": 390, "from": 25, "to": 29 }],   // capped at 50
  "jumps":      [{ "sourceFrame": 390, "dist": 0.143 }],          // capped at 50
  "reseeds": [{
    "frameIndex": 385, "sourceFrame": 385, "timestamp": 12.83,
    "reason": "appearance-mismatch-streak",
    "discarded": 141,   // frames dropped as wrong-person
    "recovered": 120,   // of those, re-filled with correct-person boxes
    "restored": 0       // >0 ⇒ the alarm was ruled false and undone
  }]
}
```

The artifact itself is **unchanged** (`version: 1`, timestamp echo, setupHash
stamping) — the existing sidecar reader (`status`/`error` only) is untouched.

## PRD edits to make

1. **Status/audit note.** Issue 02 → done. Add a dated note that the
   downloader additionally implemented appearance-anchored stitching
   (its issue #19) after Phase A's residual error was observed on real
   bundles, without waiting for the Phase B gate.
2. **Problem Statement.** Items 1–4 are all fixed. Add the fifth failure mode
   that was actually the hardest: *bounded* slack still hijacks when the
   climber's detection gap coincides with a bystander inside the cap — solved
   by appearance, not tighter geometry (tighter geometry was tried and rejected
   because it breaks traverses/down-climbs).
3. **Out of Scope.** Rewrite the appearance bullet: color-histogram appearance
   re-ID is now **in scope and shipped** in the downloader; what remains out of
   scope is embedding-based re-ID (OSNet-style), which should only be
   considered if color signatures prove insufficient (similarly-dressed
   climbers, grayscale/night footage).
4. **Issue 03 (validation session).** Re-scope: it now validates the
   appearance-anchored stitcher, not bare Phase A. Concretely: recalibrate the
   known-bad videos, then read `seedDebug.stitch` per run — `reseeds` entries
   with `restored: 0` are auto-corrected wrong-person events (count them),
   `jumps` should be empty on healthy runs, and `stitchedFrames`/history gives
   coverage. The residual wrong-person rate that gates Phase B is expected to
   be far lower; issue 03's session should confirm or refute that on the
   scanner's own corpus.
5. **Phase B sizing (issues 04–07).** The swap UI's *value proposition
   shrinks* from "routine correction tool" to "escape hatch for the residual"
   (similar clothing, appearance-blind footage). Keep or shrink accordingly.
   Two technical notes if Phase B proceeds:
   - Artifact v2 (candidates + selectedTrackId) is fully compatible with the
     new stitcher; nothing in #19 blocks it.
   - The PRD's forward-propagation spec says the reviewer bridges id breaks
     "by the same capped nearest-box continuity" — that parity claim is now
     false (the downloader's continuity is scored motion+appearance). Either
     restate propagation as intentionally simpler (motion-only is fine for a
     human-supervised click flow) or drop the parity wording.
6. **Re-tap flow.** No backend work needed: `climber_point.t` is honored
   end-to-end, so a re-tap that writes a new `t` into Scan Setup re-seeds at
   the tapped frame on the next job. Worth an explicit line in the PRD since
   it was the original motivation for issue 01.
7. **Honest-absence UX.** The new stitcher prefers absent over wrong far more
   aggressively (frames where the climber is undetected stay `keypoints: []`
   instead of adopting a bystander). The scanner's existing absent-seed
   affordance will be exercised more; confirm the authoring UI handles longer
   absent stretches gracefully (this was already Phase A's stance — "honest
   failure beats a confidently wrong seed" — it just applies to more frames now).
