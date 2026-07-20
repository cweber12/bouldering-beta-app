# Forward-fill Wrong/Auto Ground Truth review + ADR 0005 absent deprecation

Status: done

Spec inputs: amends `.scratch/calibration-flag-review/PRD.md` (the flag-only review this builds on), `docs/adr/0018` (Ground Truth eval), `docs/adr/0020` (calibration freshness / setupHash pairing), and the harness handoffs `scanner-data-contract.md` (Phase 3 review contract) + `scanner-review-provenance-adr0005.md` (manual-absent deprecation). Phases 1–2 of the data contract are out of scope.
Glossary: CONTEXT.md — **Ground Truth**, **Detection Frame**, **Scan Setup**, **Test Video**, **Climber**, **ViTPose scaffold (seed)**. New terms introduced here: **control point**, **Wrong stretch**, **forward-fill**.

## Problem Statement

Reviewing Ground Truth for a Test Video means walking a uniform Detection Frame grid that runs to 1000+ frames. When ViTPose seeds the wrong person, that wrong track persists across a long, contiguous stretch of frames until a different person is detected — yet the current reviewer only lets the author flag **one frame at a time**. Marking a wrong-person episode therefore means hundreds of identical clicks, which makes the review pass impractical on real videos. The author's judgement is never "this single frame is wrong"; it is always "the wrong person was in focus from here until there." The tool doesn't speak that language.

Separately, harness ADR 0005 deprecated the manual **Absent** flag: presence is now taken from the frame `state` (which follows the seed), and `human-flagged-absent` must no longer be written on new saves. The scanner's current carry-forward code actually **re-emits** `human-flagged-absent` on every re-calibration, violating that contract, and some existing videos still carry stale absent flags from an older workflow.

## Solution

Turn the per-frame flag into a **forward-fill over a segment model**. Marking a frame **Wrong** plants a control point that paints every following frame Wrong until the next control point; marking a frame **Auto** plants a control point that carries Auto forward until the next Wrong. The author flags a wrong-person episode by marking Wrong at its start, scrolling forward to where the real Climber returns, and marking Auto there — two clicks for a stretch of any length. Each frame's flag is _derived_ from the nearest preceding control point, so out-of-order corrections never wipe boundaries the author already set. Frames the seed posed nobody at (zero core joints) stay **seeded-absent** and are transparent: a Wrong stretch bridges across them rather than recoloring or terminating on them.

At the same time, the manual **Absent** control is removed (its only job — absence — is already decided by the seed), `human-flagged-absent` is soft-retired to `auto` on carry-forward, and presence follows `state` exactly as ADR 0005 requires. The filmstrip draws a continuous bar over each Wrong stretch so the structure is eyeball-able across a long video, and a Jump control walks the author to each wrong-person episode — including stale flags carried from the old implementation, which a "Discard flags — reset to seed" button can clear wholesale.

## User Stories

1. As a calibration author, I want marking a frame Wrong to paint every following frame Wrong until I mark one Auto, so that I flag a wrong-person stretch in two clicks instead of hundreds.
2. As a calibration author reviewing 1000+ Detection Frames, I want the wrong-person stretch to fill forward automatically, so that I never step through each frame individually.
3. As a calibration author, I want marking a frame Auto to carry Auto forward to all following frames until the next Wrong, so that I close a wrong-person stretch by marking the frame where the real Climber returns.
4. As a calibration author, I want to scroll forward from a Wrong mark to find the first correct frame, so that I can place the Auto boundary exactly where detection recovers.
5. As a calibration author, I want out-of-order edits to preserve boundaries I already set, so that correcting an earlier mark never silently wipes a later Auto or Wrong boundary.
6. As a calibration author, I want frames with zero seeded landmarks to stay seeded-absent even inside a Wrong stretch, so that a no-detection gap is never mislabeled as a wrong-person pose.
7. As a calibration author, I want a Wrong stretch to bridge across seeded-absent gaps, so that a single wrong-person episode reads as one continuous span even when detection briefly drops.
8. As a calibration author, I want the Wrong button disabled on a zero-landmark frame, so that I can't plant a meaningless "wrong pose with no joints."
9. As a calibration author, I want only two controls (Auto / Wrong) in the reviewer, so that the interaction matches the only judgement I actually make.
10. As a calibration author parked on a derived frame, I want the active flag shown with an "inherited from mm:ss" hint, so that I can find the boundary that governs a frame deep inside a stretch.
11. As a calibration author, I want the filmstrip to draw a continuous bar over each Wrong stretch, so that I can eyeball the stretch structure across a long video at a glance.
12. As a calibration author, I want seeded-absent gaps still individually legible in the filmstrip, so that I can tell a no-detection gap from a posed frame even under a Wrong bar.
13. As a calibration author, I want a Jump control that lands on the start of the next Wrong stretch, so that I can walk through each wrong-person episode to judge it.
14. As a calibration author re-calibrating a video, I want my Wrong/Auto structure to survive re-seeding, so that a fresh ViTPose run doesn't cost me my review pass.
15. As a calibration author re-calibrating, I want carried-forward Wrong flags surfaced as Wrong stretches I can jump to, so that I can re-judge old flags against the new seed.
16. As a calibration author, I want previously flagged-wrong frames easy to find in the filmstrip, so that I can identify and overwrite stale flags from the old implementation.
17. As a calibration author, I want a "Discard flags — reset to seed" button, so that I can clear wholesale-garbage old flags in one action instead of clearing each stretch.
18. As a calibration author, I want the reset to be un-saved until I Accept, so that I can back out of a reset that was a mistake.
19. As a calibration author, I want to clear a single Wrong stretch by marking Auto at its start, so that I can remove one stretch without touching the rest.
20. As a calibration author, I want no manual Absent control, so that absence is decided by the seed and I never author a stale absent flag.
21. As a calibration author, I want reopening a saved video to restore the exact editable Wrong/Auto structure, so that a later session continues where I left off.
22. As a calibration author, I want absent gaps never to fabricate a boundary on reload, so that a Wrong stretch that spanned a gap comes back as one stretch.
23. As the harness pipeline, I want the scanner never to emit `human-flagged-absent` on new saves, so that ADR 0005's presence-from-state contract holds.
24. As the harness pipeline, I want legacy `human-flagged-absent` frames rewritten to `auto` on the next save, so that genuinely-absent frames re-count as presence-negative evidence.
25. As the harness pipeline, I want presence taken from `state` (absent when the seed had no landmarks), so that I never infer presence from a human flag.
26. As the harness pipeline, I want `human-flagged-wrong` frames to keep `state: "present"` with their seeded joints, so that they are excluded from scoring as known-bad while presence survives.
27. As the harness pipeline, I want a carried-forward Wrong dropped to seeded-absent when the new seed has no joints, so that no present-with-empty-joints frame ever reaches the file.
28. As the harness pipeline, I want `groundTruthHash` recomputed on every save over the materialized review values, so that a re-review produces a new evaluation record instead of overwriting history.
29. As the harness pipeline, I want the parser to still read legacy `human-flagged-absent` files, so that old bundles stay loadable without a migration script.
30. As a developer, I want the segment derivation, control-point reconstruction, empty-joint exception, and carry-forward guard in framework-agnostic utils, so that the behavior is unit-testable without mounting the calibration page.
31. As a developer, I want the reviewer, filmstrip, and page to stay thin over those utils, so that the decision-bearing logic lives below the untested page.
32. As a developer, I want the dead absent-flag code removed (the `ReviewFlag` `absent` member, the `applyReviewFlag` absent case, the Absent button), so that no code path can produce the deprecated flag.
33. As a developer, I want ADR 0018 amended and harness ADR 0005 referenced, so that the documented review model matches the shipped forward-fill.

## Implementation Decisions

- **Segment / boundary model.** Working state is a set of **control points** (Detection Frame index → `Wrong | Auto`), created by explicit clicks. Each frame's effective flag is _derived_ as the value of the nearest preceding control point (default `Auto` when none precedes), then the empty-joint exception forces zero-landmark frames to seeded-absent `Auto`. Flat per-frame `review` values are materialized only at save. This replaces today's independent per-frame flag setting, so an out-of-order edit re-derives the fill without clobbering later boundaries.
- **Two-state flag vocabulary.** `ReviewFlag` becomes `"auto" | "wrong"`; the `"absent"` member and the `absent` case of `applyReviewFlag` are deleted. `reviewToFlag` maps `human-flagged-absent` and `human` → `"auto"` (soft-retire). The persisted `GroundTruthReview` union, `GROUND_TRUTH_VERSION`, and the canonical hash pre-image are all unchanged — only the values the UI produces change; the parser keeps accepting `human-flagged-absent` on read for legacy files.
- **Empty-joint (seeded-absent) exception.** A Detection Frame the seed posed nobody at (0 core joints) is always `state: "absent"` / `review: "auto"`, regardless of any Wrong segment covering it. Wrong stretches bridge across such frames (transparent, never terminating). The Wrong control is disabled on zero-joint frames, so control points only ever land on seeded frames. This is total, not heuristic: `coreJointsFromKeypoints` keeps every core keypoint (occlusion-flagging low-confidence ones), so a "wrong person" always seeds joints and 0 joints ⟺ ViTPose posed nobody.
- **Interaction.** Plant a control point with the reviewer's Wrong/Auto buttons on the seeked frame; the derived fill recomputes live. There is **no Clear control** — two-state overwrite covers every edit, and redundant same-value control points are semantic no-ops (they never create a boundary because the derivation compares against the previous _seeded_ frame). On a derived frame the active flag is shown with an "inherited from mm:ss.s" caption naming the governing boundary.
- **Filmstrip.** A continuous caution bar spans each derived Wrong stretch, **bridging seeded-absent gaps** (matching the transparent-gap semantics). The redundant per-frame Wrong dot is dropped; the seeded-absent dot is kept so gaps stay individually legible. The former "Jump to next flagged stretch" control is repurposed to **"jump to the start of the next Wrong stretch."**
- **Persistence / reconstruction.** Accept & save materializes segments → flat per-frame `review` (each seeded frame in a Wrong segment → `human-flagged-wrong` with `state: "present"` and its seed joints kept; every other frame → `auto` with `state` from the seed) and stamps `verified: true`. On load and on re-seed, control points are reconstructed by comparing each seeded frame to the **previous _seeded_ frame** (absent frames skipped), so absent gaps never fabricate a boundary and the structure round-trips editable-as-left.
- **Carry-forward guard.** `buildGroundTruthScaffold` carries a prior Wrong forward by timestamp **only when the new seed frame has joints**; a carried Wrong onto a now-empty seed reverts to seeded-absent `auto`. A carried (legacy) absent maps to `auto`, which is already a no-op against the seed. This single change delivers ADR 0005's optional legacy `absent → auto` migration automatically on the next save — no bulk script.
- **Reset.** A "Discard flags — reset to seed" action in the review header resets the working copy to the pure ViTPose scaffold (`gtSeed`: all `auto`, `state` from seed). Un-saved until Accept, so backing out of the review discards the reset.
- **ADR 0005 alignment.** Presence is `state`, never a flag; `state` follows the seed's landmark presence; the scanner emits only `auto` and `human-flagged-wrong`. The current carry-forward re-emit of `human-flagged-absent` is fixed by the `reviewToFlag` change. No new `human-flagged-absent` is ever written.
- **Code removal.** The Absent `REVIEW_OPTION`, the `absent` case in `applyReviewFlag`, and the `"absent"` member of `ReviewFlag` are deleted with their tests. Page-level segment logic is pushed down into the framework-agnostic Ground Truth scaffold utils.
- **Docs.** ADR 0018 is amended to describe forward-fill review; a note references harness ADR 0005 for the absent deprecation and presence-from-state rule.

## Testing Decisions

Good tests exercise external behavior at the module and component seams — derived fills, reconstructed control points, materialized review values, rendered controls and bars — never internal state. Every seam already exists; this feature adds cases to them rather than new seams.

- **Ground Truth scaffold module** (existing tests, `__tests__/utils/harnessGroundTruthScaffold.test.ts`): derive-fill from control points including the empty-joint exception and gap-bridging; control-point reconstruction that skips absent frames (an absent gap inside a Wrong stretch adds no boundary); Wrong-stretch enumeration (start indices for the jump target and the bar); `reviewToFlag` mapping `human-flagged-absent`/`human` → `auto`; two-state `applyReviewFlag`; and the `buildGroundTruthScaffold` carry-forward guard across all three cases (Wrong onto empty seed → seeded-absent auto; legacy absent → auto with `state` from the seed; Wrong onto a posed seed kept). A round-trip property test: `reconstruct(materialize(derive(controlPoints)))` yields the same effective fill.
- **DetectionFrameStepper component** (existing test, `__tests__/components/dev/DetectionFrameStepper.test.tsx`): a continuous Wrong-stretch bar renders and bridges an absent gap; the seeded-absent dot is retained and the Wrong dot dropped; the Jump control lands on the next Wrong-stretch start.
- **GroundTruthReviewer component** (existing test, `__tests__/components/dev/GroundTruthReviewer.test.tsx`): only Auto and Wrong controls render (no Absent); Wrong is disabled on a zero-joint frame; the inherited-source hint shows on a derived frame.

Prior art: these three test files were written for the `calibration-flag-review` PRD and are the direct templates. The calibration page (`app/dev/harness/page.tsx`) stays untested, as today — everything decision-bearing lives below it in the scaffold utils.

## Out of Scope

- **Contract Phase 1** — the headless all-pairs ORB cross-match batch and `orb_match_matrix.json`.
- **Contract Phase 2** — per-frame `source`/region-stat enrichment, `overlayQuality`/`badStretches`, `reference_frame.png`, and the `/api/contract` startup probe.
- A `review: "human"` joint-editing authoring path — editing stays removed; the accuracy tier populates from the harness's future cross-model work.
- Distinguishing carried-forward Wrong from session-set Wrong with a separate marker or session state — after a re-seed every Wrong stretch is equally "please re-judge me."
- Reconciling the scanner's local `harnessScoring.ts` (which scores `human-flagged-wrong` as `unscored`-but-counted) with the backend evaluator (which excludes it from all denominators) — a pre-existing divergence between the two scorers, unaffected by the review UI.
- A bulk migration script for legacy `human-flagged-absent` files — handled on next save via the carry-forward guard.
- Filmstrip range-paint gestures (e.g. shift-click a span) — deferred; two-button forward-fill is the shipped interaction.

## Further Notes

- The empty-joint exception is exact, not a heuristic: a wrong-person track always seeds joints, so a zero-joint frame can only mean ViTPose posed nobody — which is why disabling Wrong there costs nothing.
- The backend **excludes** `human-flagged-wrong` frames from scoring entirely, so painting a wrong-person stretch removes it from the detection metrics — precisely the intended outcome of the feature.
- Carry-forward preserves human labels but does not re-judge them: a re-seed that _fixes_ a previously wrong detection still returns the frame flagged Wrong, so the author re-reviews that stretch and marks it Auto. This is the ADR 0020 carry-forward tradeoff, unchanged.
- `setupHash` pairing (ADR 0020) is untouched; a crop/tier/panning edit that changes the hash still surfaces the truth as stale via `utils/harnessFreshness`.
