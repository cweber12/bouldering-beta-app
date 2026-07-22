# Ground-truth-scored detection eval over the test corpus

## Status

accepted

Extends and amends ADR 0017 (external detection eval harness). ADR 0017's
calibration pass "also fires a first detection run" and relays it as a scored
run; this ADR removes that — calibration now authors per-video **Ground Truth**,
its detection pass is a discarded scaffold, and scored runs come only from a
separate headless pass.

Amended by ADR 0019: §1's scaffold *poses* now come from ViTPose++ run on the
downloader; the human stays the truth authority. §Considered-Options #4's
circularity premise is superseded — seeding from a different model breaks the
self-reference on unverified frames.

Amended by `.scratch/calibration-analyze-split/PRD.md` and ADR 0020
(calibration freshness): calibration no longer runs a throwaway MediaPipe pass;
the Detection Frame set is a uniform 100 ms arithmetic grid keyed to video
duration and sent directly to ViTPose at setup-confirm time. Detection + scoring
run in the explicit Analyze step (manual and batch), scoring only the GT frames
the run actually probed (1 ms timestamp match), with `probeCoverage` and
`detectionRateVsGT` computed over probed present frames. Ground Truth remains
video-keyed in carry-forward semantics, while freshness/pairing is hash-chained
and surfaced (stale + re-seed), not silently discarded.

Amended by the calibration flag-only review change
(`.scratch/calibration-flag-review/PRD.md`): authoring is inverted from *dragging
every joint* to a *flag-only review* pass. Every **Detection Frame** arrives
**auto-accepted** from the ViTPose seed (`review: "auto"`); the human's only input
is a per-frame three-way flag (Auto / Wrong / Absent), and one **Accept & save
Ground Truth** button persists the file. Landmark dragging, whole-skeleton
translate, per-joint occlusion toggling, and the per-frame accept-as-is button are
removed; the reviewer is read-only over the seed. `verified` is redefined as
"nobody objected" (written `true` on every frame at save). ViTPose becomes a
**hard requirement** — the MediaPipe seed fallback (ADR 0019 §Consequences) is
removed, because auto-accepting a MediaPipe seed would grade MediaPipe against
itself. `ground-truth.json` gains a required per-frame **`review`** and a top-level
**`setupHash`**, both in the hash pre-image; condition labels move from
`metadata.json` into `setup.json.analysisInputs`. §1, §4, §5, and the amended
Considered-Options / Consequences notes below reflect the shipped model.

Amended by the forward-fill review change
(`.scratch/calibration-wrong-forward-fill/PRD.md`): the per-frame flag becomes a
**forward-fill over a segment model**, and the manual **Absent** flag is retired.
Working review state is now a set of **control points** (Detection Frame index →
`Wrong | Auto`); each frame's effective flag is *derived* as the value of the
nearest preceding control point (default `auto`), so marking a frame Wrong paints
every following frame Wrong until the next Auto control point — a wrong-person
stretch of any length is flagged in two clicks, and an out-of-order edit
re-derives the fill without clobbering later boundaries. Flat per-frame `review`
values are materialized only at **Accept & save**: each seeded frame in a derived
Wrong segment → `human-flagged-wrong` (present, seed joints kept); every other
frame → `auto` with `state` from the seed. The **empty-joint exception**: a frame
the seed posed nobody at (0 core joints) is always `state: "absent"` /
`review: "auto"` regardless of any Wrong segment, and a Wrong stretch *bridges
across* it rather than terminating — so the reviewer disables the Wrong control on
a zero-joint frame. The `ReviewFlag` vocabulary drops to `"auto" | "wrong"`; the
`applyReviewFlag` absent case is deleted; `reviewToFlag` soft-retires the legacy
`human-flagged-absent` and forward-compat `human` to `"auto"`. The scanner never
emits `human-flagged-absent` on new saves — presence follows `state`, never a
human flag (aligning with harness **ADR 0005**, the manual-absent deprecation).
The persisted schema, `GROUND_TRUTH_VERSION`, and the canonical hash pre-image are
unchanged; the parser still reads legacy `human-flagged-absent` files. §1's
Absent bullet and §5's `review` enumeration below are superseded by this note for
the values the UI now produces.

The forward-fill structure survives reopening and re-seeding a Test Video. On
re-seed, `buildGroundTruthScaffold` carries a prior **Wrong** forward by timestamp
**only when the new seed frame has joints** — a carried Wrong onto a now-empty
seed reverts to seeded-absent `auto` (never present-with-empty-joints), and a
carried legacy `human-flagged-absent` maps to `auto` taking `state` from the seed,
which delivers ADR 0005's optional `absent → auto` migration automatically on the
next save (no bulk script). Working control points are **reconstructed** from the
loaded/carried frames by comparing each seeded frame to the *previous seeded*
frame (absent frames skipped), so a Wrong stretch that spanned an absent gap comes
back as one stretch — the gap fabricates no boundary. A **"Discard flags — reset
to seed"** control resets the working copy to the pure scaffold; it is un-saved
until Accept, so leaving the review reverts it. `groundTruthHash` is still
recomputed on every save over the materialized review values.

## Context

ADR 0017 gave us a labelled corpus and a self-contained **Scan Diagnostics**
record per run. But its signal is _aggregate_: `detectionRate: 0.82`,
`flippedFrames: 6`. It cannot say **which** frames failed, **how far** the pose
was off, or **why** — and the human labels it carries (`shadows`,
`climber_contrast`, …) are _video-level_, one value for the whole clip. To steer
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

1. **Calibration authors per-video Ground Truth by flag-only review.** The
   calibration pass seeds every **Detection Frame** from the ViTPose scaffold
   (ADR 0019) **auto-accepted** — `review: "auto"`, state as seeded (present, or
   absent when ViTPose tracked nothing). Only per-video data persists — the
   scaffold run is discarded, and calibration saves **no scored run**. The
   **User**'s only job is a fast review pass that *flags exceptions* via a
   per-frame three-way control:
   - **Auto** (unflagged) — keep the seed as-is.
   - **Wrong** (`review: "human-flagged-wrong"`) — the seed skeleton is bad; the
     frame stays `state: "present"` and keeps its seeded joints as known-bad (kept
     as presence truth, excluded from joint metrics). Flagging a seeded-absent
     frame Wrong flips it to present with empty joints.
   - **Absent** (`review: "human-flagged-absent"`) — no Climber here; `state:
     "absent"`, joints cleared.

   One **Accept & save Ground Truth** button persists the whole file and stays on
   the page for further flagging. The full 33 BlazePose points are neither authored
   nor scored — the scaffold carries a **core body-joint set** (~13: shoulders,
   elbows, wrists, hips, knees, ankles, a head anchor). Each frame keeps a
   per-joint **occluded** flag (seeded from ViTPose confidence, display-only in the
   read-only reviewer) and a **verified** flag redefined as "nobody objected" —
   written `true` on every frame at save. Landmark dragging, whole-skeleton
   translate, per-joint occlusion toggling, and the per-frame accept-as-is button
   are gone. The legacy `skip` state stays parseable for old files, but the UI no
   longer produces it.

2. **Errors are derived, not tagged.** A scored run compares its pose to Ground
   Truth per scored frame (skip excluded) into **one per-frame verdict** carrying
   embedded per-joint drift magnitudes. The verdict resolves in fixed precedence,
   keyed off the **max** displacement over non-occluded core joints —
   **missing > unscored > extreme > wrong > drift > good**: no accepted pose (or a
   partial pose below a joint-coverage floor) over a present frame is `missing`; a
   frame whose GT torso is too degraded to yield a body scale is `unscored`
   (measured coverage denominator, no drift verdict); an anatomically implausible
   pose (bone-length deviation, ADR 0015) is `extreme`; a pose far from GT (or any
   pose over an `absent` frame) is `wrong`; otherwise displacement over
   non-occluded core joints is `drift`, carrying its magnitude. All distances are
   normalised by GT **body scale** — the mean of the resolvable torso segments
   (shoulder-width, hip-width, the two shoulder↔hip sides), which degrades
   gracefully when a torso joint is occluded — so thresholds are resolution- and
   scale-free. Verified frames are the true reference; unverified frames are a
   weaker signal, scored identically but flagged so downstream analysis (not the
   scoring module) sets the trust policy. Threshold constants (`DRIFT_MIN`,
   `WRONG_MAX`, `MIN_JOINT_COVERAGE`) are named starters, tuned against the corpus
   drift histogram.

3. **Flow splits into calibrate vs score.** Calibration mode authors Ground Truth
    - crops + metadata and posts nothing. A separate **Analyze** action (per-video
       plus the batch runner) runs detection with the frozen **Scan Setup**, scores
       in-browser against the bundle's Ground Truth, and folds the per-frame errors
       + per-run rollup into the run's `pose` payload posted through the existing
       `POST /api/detections` — one append-only, self-attributing record per run.
       Each score is stamped with a **`groundTruthHash`** alongside `appVersion` +
       `setupHash`, so a score is always tied to the exact Ground Truth version it
       was measured against. The Analyze pass skips any video without a
       `ground-truth.json`. `ScanDiagnostics` still rides along, GT-free.

4. **Video condition labels live in the Scan Setup.** The condition labels
   (`route_orientation`, `camera_angle`, `shadows`, `climber_contrast`,
   `wall_contrast`, `motion_blur`, `occlusion`, `camera_stability`, `notes`) are
   edited in calibration through the metadata modal, but persist to
   **`setup.json.analysisInputs`** (snake_case inner keys, `"unknown"` for
   undecided) via a **merging setup write**: a labels-only save preserves the
   crops/point/panning/tier, and a crops-only save preserves the labels. This is
   where the harness now reads them (its `LABEL_KEYS` mapping), so there is no
   second read path. `setupHash` covers only the scan-affecting inputs (crops,
   point, panning, tier) — never the labels — so a label edit never re-hashes the
   Setup or orphans saved Ground Truth or prior runs. The old field-level merge
   into the downloader-owned `metadata.json` is retired; `route_folder` stays
   structural and harness-owned and is never written by this path. Amount fields
   use an `unknown/none/low/medium/high` scale; the editor keeps an existing
   off-scale value rather than dropping it.

5. **Storage layout and provenance.** Calibration writes two beta-scanner-owned
   files into the bundle — `setup.json` (detection inputs from ADR 0017, plus the
   `analysisInputs` condition labels per §4) and the sibling **`ground-truth.json`**
   (the eval reference: per-Detection-Frame state, core-joint positions, occluded
   flags, verified flag). Ground Truth is kept separate from Setup because they are
   different kinds of thing (reference vs input) with very different sizes.

   `ground-truth.json` carries a required per-frame **`review`** (`"auto"` /
   `"human-flagged-wrong"` / `"human-flagged-absent"`; the parser also accepts the
   contract's `"human"`) and a required top-level **`setupHash`** copied from the
   `vitpose.json` it was seeded from (legacy ViTPose artifacts without one fall back
   to the hash returned by the setup save in the same flow). Both join the canonical
   hash pre-image, so a flag edit produces a new `groundTruthHash` instead of
   overwriting history. `GROUND_TRUTH_VERSION` stays 1 — the harness reads legacy
   files without `review` as all-auto, so the shape change is back-compatible. The
   server recomputes both hashes on write, requires `review`, and enforces
   flagged-absent ⇒ `state: "absent"`.

   **Staleness rule (ADR 0020).** Freshness is hash-chained and surfaced, not
   discard-based. On re-calibration, prior human flags carry forward by timestamp
   onto the re-seed scaffold; if the persisted truth's `setupHash` does not match
   the current setup, the truth is marked stale and must be re-seeded under the
   current setup before export/evaluation as current-state evidence. Historical
   truth and runs remain intact and attributable by hashes.

## Considered options

1. **Author ground truth once, derive errors headlessly** (chosen) — one-time
   manual cost, objective per-frame errors, unlimited attributable re-runs.
2. **Hand-tag per-frame faults each run** — rejected: per-run subjective labels,
   re-annotated every run, not attributable to code vs conditions.
3. **Dense 33-joint ground truth** — rejected: roughly triples authoring cost for
   precision nothing scores on; the core body joints carry the signal.
4. **Score during calibration for instant feedback** — rejected: scoring the
   scaffold-seeded run against Ground Truth derived from that same run is circular
   and flatters the numbers. This circularity is now also why ViTPose is a **hard
   requirement** (§1, ADR 0019): an auto-accepted MediaPipe seed would grade
   MediaPipe against itself.
5. **Write condition labels to a downloader-owned file** — the labels now live in
   `setup.json.analysisInputs`, a beta-scanner-owned file the harness reads
   directly (§4), superseding the earlier plan of a field-level merge into the
   downloader's `metadata.json`. The Setup is the canonical home for every manual
   calibration input, so labels and crops travel together and the downloader's
   bundle stays its own.

## Consequences

- **Calibration is now a fast review, not heavy authoring.** With auto-accept
  inversion the per-video cost collapses from dragging every joint to a
  flag-exceptions pass, and every subsequent re-run stays free and human-free. The
  corpus is only as good as its Ground Truth, as it was only as good as its
  Setups under ADR 0017.
- **Auto frames are soft truth.** On frames the human never flagged (`review:
  "auto"`), Ground Truth is the ViTPose seed, so a score there measures divergence
  from an independent model, not from human-attested truth. The `review` field
  lets scoring split agreement-tier (auto) from accuracy-tier (human-flagged)
  evidence; trend analysis should lead with human-reviewed coverage.
- **Ground Truth can be re-flagged, so scores carry `groundTruthHash`.** Re-flagging
  GT does not silently invalidate old numbers — a score names the GT version it
  used (over content that now includes `review` + `setupHash`), and stale scores
  are detectable rather than misleading.
- **Condition labels live in `setup.json`, not `metadata.json`.** beta-scanner no
  longer mutates the downloader-owned `metadata.json`; the labels persist to
  `setup.json.analysisInputs` through the merging setup write, so a re-download can
  never clobber them. The whole calibration path stays `NODE_ENV`-gated dev-only.
- **The batch runner gains a Ground-Truth gate.** `harness:batch` now skips videos
  without `ground-truth.json` (not just without `setup.json`) and must load GT and
  score in the browser before posting.
- **Cross-video route matching is still deferred** (ADR 0017 §6) — this ADR is
  about single-video pose ground truth, not route-photo matching.
