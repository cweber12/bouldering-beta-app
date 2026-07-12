# Ground-truth-scored detection eval over the test corpus

## Status

accepted

Extends and amends ADR 0017 (external detection eval harness). ADR 0017's
calibration pass "also fires a first detection run" and relays it as a scored
run; this ADR removes that — calibration now authors per-video **Ground Truth**,
its detection pass is a discarded scaffold, and scored runs come only from a
separate headless pass.

## Context

ADR 0017 gave us a labelled corpus and a self-contained **Scan Diagnostics**
record per run. But its signal is *aggregate*: `detectionRate: 0.82`,
`flippedFrames: 6`. It cannot say **which** frames failed, **how far** the pose
was off, or **why** — and the human labels it carries (`shadows`,
`climber_contrast`, …) are *video-level*, one value for the whole clip. To steer
tuning we need per-frame truth: "frames 40–70 drifted, the joints were off by
0.4 body-lengths, and those frames were low-contrast + motion-blurred."

The obvious way to get that is to have a human step through each run and tag the
bad stretches by hand. We rejected it: a tag is a per-run judgement, so every
re-run re-annotates, and the labels are subjective and unattributable.

The insight that reshapes the design: if a human authors the **correct** pose
**once per video**, every future run can be scored against it **automatically and
headlessly**, forever. Manual effort collapses to a one-time calibration; run
quality becomes a derived, objective measurement. Three forces then apply, all
inherited from ADR 0017: the pipeline is browser-bound, a scan needs frozen
manual inputs, and the bundle is the corpus of record.

## Decision

1. **Calibration authors per-video Ground Truth.** The calibration pass runs a
   **throwaway detection scaffold** purely so the **User** has landmarks to drag
   into place. Only per-video data persists — the scaffold run is discarded, and
   calibration saves **no scored run**. The User corrects a **core body-joint
   set** (~13: shoulders, elbows, wrists, hips, knees, ankles, a head anchor) via
   drag + whole-skeleton translate + accept-as-is; the full 33 BlazePose points
   are neither authored nor scored. Each **Detection Frame** carries a GT state —
   **present** / **absent** / **skip** — with a per-joint **occluded** flag
   (pre-seeded from MediaPipe visibility) and a **verified** / **unverified** flag
   (verified once a human touches or accepts it). Authoring is sparse-by-effort:
   every frame's landmarks are GT by default; the human touches only the wrong
   ones.

2. **Errors are derived, not tagged.** A scored run compares its pose to Ground
   Truth per scored frame (skip excluded) in fixed precedence —
   **missing > wrong > extreme > drift > good**: no accepted pose over a present
   frame is `missing`; a pose far from GT (or any pose over an `absent` frame) is
   `wrong`; an anatomically implausible pose (bone-length deviation, ADR 0015) is
   `extreme`; otherwise per-joint displacement over non-occluded core joints is
   `drift`, carrying its magnitude. All distances are normalised by GT **body
   scale** (torso diagonal) so thresholds are resolution- and scale-free.
   Verified frames are the true reference; unverified frames are a weaker signal.

3. **Flow splits into calibrate vs score.** Calibration mode authors Ground Truth
   + crops + metadata and posts nothing. A separate **headless scoring pass** (the
   ADR 0017 batch runner, or a "Score now" action) runs detection with the frozen
   **Scan Setup**, scores in-browser against the bundle's Ground Truth, and folds
   the per-frame errors + per-run rollup into the run's `pose` payload posted
   through the existing `POST /api/detections` — one append-only, self-attributing
   record per run. Each score is stamped with a **`groundTruthHash`** alongside
   `appVersion` + `setupHash`, so a score is always tied to the exact Ground Truth
   version it was measured against. The scoring pass skips any video without a
   `ground-truth.json`. `ScanDiagnostics` still rides along, GT-free.

4. **Video metadata is edited in place.** The `analysis_inputs` block (the
   video-level condition labels — `shadows`, `climber_contrast`, `wall_contrast`,
   `motion_blur`, `occlusion`, `camera_stability`, `route_orientation`,
   `camera_angle`, `notes`) is editable in calibration via a **field-level strict
   merge** into the downloader-owned `metadata.json`: only the changed fields are
   overwritten, every other key (including `route_folder` / `imported_from`,
   which the downloader owns and is migrating to a separate file) is preserved
   verbatim. This crosses ADR 0017's "downloader owns its bundle" line
   deliberately — the corrections are the video's canonical labels and belong in
   the canonical file. Amount fields use an `unknown/none/low/medium/high` scale;
   the editor always keeps an existing off-scale value rather than dropping it.

5. **Storage layout.** Calibration writes two beta-scanner-owned files into the
   bundle — `setup.json` (detection inputs, unchanged from ADR 0017) and a new
   sibling **`ground-truth.json`** (the eval reference: per-Detection-Frame state,
   core-joint positions, occluded flags, verified flag) — plus the in-place
   `analysis_inputs` edit. Ground Truth is kept separate from Setup because they
   are different kinds of thing (reference vs input) with very different sizes.

## Considered options

1. **Author ground truth once, derive errors headlessly** (chosen) — one-time
   manual cost, objective per-frame errors, unlimited attributable re-runs.
2. **Hand-tag per-frame faults each run** — rejected: per-run subjective labels,
   re-annotated every run, not attributable to code vs conditions.
3. **Dense 33-joint ground truth** — rejected: roughly triples authoring cost for
   precision nothing scores on; the core body joints carry the signal.
4. **Score during calibration for instant feedback** — rejected: scoring the
   scaffold-seeded run against Ground Truth derived from that same run is circular
   and flatters the numbers. A live *edit* readout (drag distance) is authoring
   feedback, not a score.
5. **Write metadata edits to a harness-owned override file** — rejected: keeps
   `metadata.json` pristine but forks the source of truth, so the downloader's own
   consumers never see the corrections. The intent is to correct the canonical
   labels.

## Consequences

- **Calibration is now the heavy step.** Authoring Ground Truth per video is real
  work; the payoff is that every subsequent re-run is free and human-free. The
  corpus is only as good as its Ground Truth, as it was only as good as its
  Setups under ADR 0017.
- **Unverified frames are soft truth.** On frames the human never touched, Ground
  Truth is just the scaffold's own detection, so a score there measures run-to-run
  drift, not run-to-truth. The verified flag lets scoring weight or filter to true
  reference; trend analysis should lead with verified coverage.
- **Ground Truth can be re-edited, so scores carry `groundTruthHash`.** Re-editing
  GT does not silently invalidate old numbers — a score names the GT version it
  used, and stale scores are detectable rather than misleading.
- **beta-scanner now mutates `metadata.json`.** A re-download of a video would
  clobber the human's `analysis_inputs` edits; acceptable because the downloader
  writes the file once and only a deliberate re-download rewrites it, and the
  whole path stays `NODE_ENV`-gated dev-only.
- **The batch runner gains a Ground-Truth gate.** `harness:batch` now skips videos
  without `ground-truth.json` (not just without `setup.json`) and must load GT and
  score in the browser before posting.
- **Cross-video route matching is still deferred** (ADR 0017 §6) — this ADR is
  about single-video pose ground truth, not route-photo matching.
