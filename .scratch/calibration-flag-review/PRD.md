# Calibration flag-only Ground Truth review + scanner data-contract alignment

Status: ready-for-agent

Spec inputs: `docs/adr/0018` (Ground Truth eval), `docs/adr/0019` (ViTPose scaffold, amended by this PRD), and the harness handoff `scanner-data-contract.md` (Phase 3 + the `analysisInputs` move; Phases 1–2 out of scope).
Glossary: CONTEXT.md — **Ground Truth**, **Detection Frame**, **Scan Setup**, **Test Video**, **Climber**.

## Problem Statement

Authoring Ground Truth today means dragging every core joint of every Detection Frame into place — slow, high-friction work that makes calibrating a corpus of Test Videos impractical. At the same time the analysis harness has moved its data contract: it now distinguishes auto-accepted truth from human-attested truth via a per-frame `review` field, pairs truth to setups via `setupHash`, and reads the manual condition labels only from `setup.json.analysisInputs`. Until the scanner writes these, harness evaluations either stall or silently grade the seed model against itself.

## Solution

Invert the authoring model: every Detection Frame arrives **auto-accepted** from the ViTPose seed, and the human's only job is a fast review pass that *flags exceptions* — "this skeleton is wrong" or "no climber here" — then one **Accept & save Ground Truth** button persists the whole file. Landmark dragging, joint placement, and occlusion toggling are removed. Because auto-accepted truth is only trustworthy when the seed is independent of the detector under test, the MediaPipe seed fallback is removed: ViTPose becomes a hard requirement for Ground Truth authoring. The persisted `ground-truth.json` carries the contract's new provenance fields (`review` per frame, top-level `setupHash`), and the calibration flow writes the condition labels into `setup.json.analysisInputs` where the harness now reads them.

## User Stories

1. As a calibration author, I want every seeded Detection Frame to start accepted, so that reviewing a video costs seconds instead of minutes of dragging.
2. As a calibration author, I want a per-frame three-way control (Auto / Wrong / Absent), so that I can flag a bad seed skeleton or a missing climber without authoring joints.
3. As a calibration author, I want one Accept & save Ground Truth button, so that I commit the whole review pass in a single action instead of validating each frame.
4. As a calibration author, I want to stay on the page after saving, so that I can keep flagging and re-save without re-entering the flow.
5. As a calibration author, I want a read-only Ground Truth review mode showing the paused frame with the ViTPose seed skeleton, so that I attest the seed I'm accepting — not the MediaPipe detection under test.
6. As a calibration author, I want zoom and pan kept in the review viewer, so that I can inspect small joints in portrait video before deciding to flag.
7. As a calibration author, I want occluded joints rendered distinctly (hollow) in the viewer, so that I can see what the seed marked low-confidence even though I can't edit it.
8. As a calibration author, I want the filmstrip stepper to mark flagged and seeded-absent frames distinctly, so that I can navigate straight to the frames that need a second look.
9. As a calibration author, I want a posed / seeded-absent count next to the accept button, so that I notice when the seed left much of the video untracked before I rubber-stamp it.
10. As a calibration author, I want flagging a seeded-absent frame as Wrong to flip it to present-with-no-joints, so that a climber ViTPose missed still counts as presence truth.
11. As a calibration author, I want Ground Truth authoring disabled with a clear message and a retry when the ViTPose job fails, so that I can't unknowingly author self-graded truth.
12. As a calibration author, I want the Detection Preview and diagnostics to keep working when ViTPose is unavailable, so that a seed failure never blocks crop/tier calibration itself.
13. As a calibration author, I want my flags carried forward when I re-scan with an unchanged Scan Setup, so that a re-run doesn't cost me my review pass.
14. As a calibration author, I want stale Ground Truth discarded with a notice when I redraw crops, so that truth authored against different crops never silently pairs with new scans.
15. As a calibration author, I want the metadata modal to keep working as before, so that correcting condition labels stays part of the same calibration visit.
16. As a calibration author, I want label edits to save independently of crop edits, so that fixing a shadows label never requires re-saving or re-hashing my Scan Setup.
17. As the harness pipeline, I want every ground-truth frame to carry a `review` value, so that I can split agreement-tier (auto) from accuracy-tier (human) evidence and never grade ViTPose against itself.
18. As the harness pipeline, I want `human-flagged-wrong` frames to keep `state: "present"` and their seeded joints, so that presence truth survives while the known-bad joints are excluded from joint metrics.
19. As the harness pipeline, I want `human-flagged-absent` frames to have `state: "absent"` with joints cleared, so that a scanner detection there scores as a false positive.
20. As the harness pipeline, I want `ground-truth.json` to carry the `setupHash` of the seed it was built from, so that I refuse to compare truth against runs from a different Scan Setup.
21. As the harness pipeline, I want `groundTruthHash` recomputed on every save over content that includes the new fields, so that a flag edit produces a new evaluation record instead of overwriting history.
22. As the harness pipeline, I want condition labels only in `setup.json.analysisInputs` with snake_case inner keys, so that my `LABEL_KEYS` mapping works without a second read path.
23. As the harness pipeline, I want legacy ground-truth files without `review` treated as all-auto on read, so that old bundles stay loadable without migration.
24. As a developer, I want the flag/seed/carry-forward logic in framework-agnostic utils, so that the behavior is unit-testable without mounting the calibration page.
25. As a developer, I want the server to recompute both hashes and validate the new fields on write, so that a buggy client can never persist malformed or mis-hashed truth.
26. As a developer, I want the dead editing code (drag/place/translate geometry, occlusion toggles, the MediaPipe seed fallback) deleted rather than disabled, so that the review surface stays as small as the new interaction model.
27. As a developer, I want ADR 0018/0019 amended in the same change, so that the documented authoring model matches the shipped one.

## Implementation Decisions

- **Auto-accept inversion.** The Ground Truth scaffold seeds every Detection Frame from the ViTPose poses with `review: "auto"`; `verified` becomes "nobody objected" and is written `true` on every frame at save time. The per-frame "verify by touching" model and the per-frame Accept-as-is button are removed.
- **Flag vocabulary and state mapping.** Human input is a per-frame three-way toggle: unflagged (`review: "auto"`, state as seeded — present, or absent when ViTPose tracked nothing), **Wrong** (`review: "human-flagged-wrong"`, `state: "present"`, seeded joints kept as known-bad), **Absent** (`review: "human-flagged-absent"`, `state: "absent"`, joints cleared). Flagging a seeded-absent frame Wrong sets `state: "present"` with empty joints. The `skip` state remains parseable for old files but the UI no longer produces it. The parser accepts all four contract `review` values (including `"human"`) but the UI emits only three.
- **ViTPose is a hard requirement for authoring.** The MediaPipe GT-seed fallback is removed. On ViTPose failure (job error, timeout, no climber tracked, downloader absent) the review mode is disabled with a message and a retry affordance; Detection Preview and diagnostics remain available. This closes the circularity where auto-accepted MediaPipe seeds would grade MediaPipe against itself (the risk ADR 0019 exists to prevent).
- **Review UI.** The Edit-Ground-Truth mode toggle survives, but the landmark editor is replaced by a read-only reviewer: paused video frame + ViTPose seed skeleton with core joints highlighted and occluded joints hollow, zoom/pan retained, the three-way flag control, and the single accept button. Preview mode continues to show the detection under test; review mode shows the seed being attested. The filmstrip stepper marks flagged and seeded-absent frames distinctly; the accept button surfaces "N posed · M seeded absent" (surfaced, never blocked or double-confirmed).
- **Accept semantics.** Accept & save persists `ground-truth.json` and stays on the page with a saved confirmation; re-flagging and re-saving is allowed and produces a new `groundTruthHash`.
- **Schema additions.** `ground-truth.json` gains a required top-level `setupHash` (copied from the `vitpose.json` seeded from; legacy ViTPose artifacts without one fall back to the hash returned by the setup save in the same flow) and a required per-frame `review`. Both join the canonical hash pre-image. `GROUND_TRUTH_VERSION` stays 1 — the harness treats missing `review` as all-auto, so the shape change is back-compatible. Server-side validation requires `review` on write and enforces flagged-absent ⇒ `state: "absent"`; the hash and timestamp remain server-authoritative.
- **Staleness rule.** On re-calibration, prior human flags carry forward onto the fresh seed only when the saved truth's `setupHash` matches the new one; joints always come from the new seed. On mismatch — or legacy truth without a `setupHash` — the review starts clean and the UI shows a "prior truth discarded (setup changed)" notice.
- **Labels move into the Scan Setup.** The metadata modal keeps its UI but persists to `setup.json.analysisInputs` (snake_case inner keys, `"unknown"` for undecided values) through a merging setup write: a labels-only save preserves crops, a crops-only save preserves labels. `setupHash` continues to cover only scan-affecting inputs (crops, point, panning, tier) — never the labels — so label edits never orphan Ground Truth or prior runs. The metadata.json label-write path is retired.
- **Code removal.** The drag/place/translate/occlusion-toggle geometry helpers, their component wiring, and the MediaPipe seed-fallback path are deleted with their tests. Page-level decisions (seed gating, carry-forward, absent counting) are extracted into the framework-agnostic Ground Truth utils.
- **Docs.** ADR 0018 §2/§3 and ADR 0019 are amended to describe flag-only review, the ViTPose hard requirement, and the review/setupHash provenance fields.

## Testing Decisions

Good tests here exercise external behavior at module and route seams — canonical strings, hashes, parsed results, HTTP responses, rendered controls — never internal helpers or component state. All seams except one already exist:

- **Ground Truth schema module** (existing tests): `review` and `setupHash` in the canonical pre-image change the hash; parser rejects missing `review` on write, accepts all four contract values, enforces flagged-absent ⇒ absent, and reads legacy files as all-auto.
- **Ground Truth scaffold module** (existing tests): auto-accept seeding, flag application, carry-forward iff `setupHash` matches (clean start + discard signal on mismatch), seeded-absent counting, and the seed-gating decision extracted from the page.
- **Ground Truth API route** (existing tests): PUT validation of the new required fields; server-recomputed hash remains authoritative.
- **Setup API route** (new test file, following the existing dev-route test pattern): merge semantics — labels-only PUT preserves crops, crops-only PUT preserves labels, `setupHash` excludes `analysisInputs`, snake_case label validation.
- **Reviewer component** (replaces the landmark-editor component test, same jsdom + Testing Library pattern): flag control renders and fires callbacks, occluded joints render distinctly, no pointer-editing surface remains.

The calibration page itself stays untested, as today; everything decision-bearing lives below it.

## Out of Scope

- **Contract Phase 1** — the headless all-pairs ORB cross-match batch script and `orb_match_matrix.json` (needs its own headless-CV-runtime decision; separate PRD).
- **Contract Phase 2** — per-frame `source`/condition enrichment of scan exports, `overlayQuality`/`badStretches`, `reference_frame.png` (separate PRD; requires re-scanning).
- A `review: "human"` authoring path — with editing removed, the scanner never emits it; the accuracy tier populates from the harness's future cross-model agreement work.
- Migration of previously saved ground-truth files — they read as all-auto per the contract; the small existing corpus is re-reviewed under the new flow.
- Any change to the headless scoring pass or batch runner beyond what the schema additions require.

## Further Notes

- The contract's rule "do not thin frames" is honoured: flagged frames keep their record (and, for Wrong, their joints) in the file.
- The seeded `occluded` flags (from ViTPose confidence) persist unchanged; they are display-only in the reviewer.
- The one-off harness-side backfill already moved old bundles' labels into `setup.json.analysisInputs`, so no scanner-side migration is needed for labels either.
