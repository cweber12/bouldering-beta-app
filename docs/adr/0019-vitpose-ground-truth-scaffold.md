# ViTPose++ scaffold for Ground Truth authoring

## Status

accepted

Amends ADR 0018 (ground-truth-scored detection eval). ADR 0018 §1 seeds the
calibration authoring scaffold from a *throwaway MediaPipe detection run*; this
ADR replaces that seed's **poses** with **ViTPose++** run on the downloader, and
supersedes ADR 0018 §Considered-Options #4's premise about circularity. The rest
of ADR 0018 — human-authored Ground Truth, per-Detection-Frame records, the
headless scoring pass, `groundTruthHash` stamping — is unchanged.

## Context

Under ADR 0018 the **User** authors per-video **Ground Truth** by dragging the
wrong landmarks of a throwaway **MediaPipe** scaffold into place. Two weaknesses
follow from seeding the scaffold with the very detector under test:

1. **Heavy authoring.** MediaPipe's guess on out-of-distribution climbing poses
   (inverted bodies, extreme abduction, wall/self-occlusion) is often far off, so
   the human drags a lot.
2. **Circular unverified truth.** On frames the human never touches, Ground Truth
   is just MediaPipe's own detection. A later MediaPipe run scored against it
   measures run-to-run drift, not run-to-truth — the scaffold flatters itself.
   ADR 0018 §Considered-Options #4 rejected *scoring during calibration* for
   exactly this reason, but the same circularity leaks into every unverified
   frame regardless of when scoring happens.

The pipeline is browser-bound (MediaPipe + OpenCV WASM, main thread), so a second
heavy model cannot run in-browser without dragging a large network and a person
detector onto the main thread. But the **Test Video** bundle is already produced
by a separate downloader program that runs offline per video — a natural host for
a stronger reference model.

## Decision

1. **The authoring scaffold's poses come from ViTPose++, run on the downloader.**
   During calibration, after the **Scan Setup** (Climber selection) is frozen,
   beta-scanner makes a dev-only async API call to the downloader. The downloader
   detects and **tracks** people (holding **Climber Identity** from the
   `climberPoint` seed, e.g. ByteTrack), runs ViTPose++ top-down on the selected
   Climber track's box, and writes **`vitpose.json`** into the bundle:
   per-Detection-Frame Climber keypoints with per-keypoint confidence,
   video-normalized. beta-scanner polls for that file, then seeds the draggable
   scaffold from it.

2. **ViTPose is a scaffold, not the truth.** The human remains the truth
   authority; `verified` still means a human corrected or confirmed the frame.
   "Unverified" now means "left as a ViTPose guess" — a stronger soft-truth than
   MediaPipe's, and crucially from a *different* model than the one under test, so
   an unverified frame no longer measures MediaPipe grading itself. Ground Truth's
   quality ceiling is the human's review, not ViTPose's accuracy on hard poses.

3. **MediaPipe still defines the Detection Frame set.** Calibration keeps running
   the MediaPipe pass to establish which frames are **Detection Frames** (base
   grid + **Adaptive Refinement**), their timestamps, and present/absent status.
   ViTPose supplies only the *pose landmarks* overlaid on those frames. Division
   of labour: MediaPipe owns "which frames," ViTPose owns "where the joints are."
   A frame MediaPipe missed but ViTPose posed is authored `present` (the Climber
   is there) — the seed no longer inherits MediaPipe's misses.

4. **Confidence gates review effort, never inclusion.** ViTPose per-keypoint
   confidence feeds the existing occluded/needs-review seed (replacing MediaPipe
   visibility). Low-confidence joints start occluded/flagged for the human to
   check; **no frame or joint is dropped for low confidence.** Ground Truth is
   authored on every present Detection Frame — thinning to "best-detected" frames
   would bias the eval set toward easy poses, going blind exactly where detection
   fails.

5. **Ground Truth stays one record per Detection Frame.** `ground-truth.json`'s
   schema (ADR 0018 §5, issue 03) and the headless scoring contract (issue 08) are
   untouched. ViTPose runs on exactly the Detection Frames the stepper shows — no
   denser reference grid. `vitpose.json` is a transient seed source, not persisted
   Ground Truth.

## Considered options

1. **ViTPose++ as the scaffold seed, human stays truth** (chosen) — less
   dragging, breaks circularity (seed is a different model), better occlusion
   pre-seed; Ground Truth stays genuine human-verified truth.
2. **ViTPose++ as Ground Truth directly (auto GT, human spot-checks)** — rejected:
   turns Detection Error into MediaPipe-vs-ViTPose divergence, not
   detection-vs-reality; ViTPose is unproven on out-of-distribution climbing
   poses, so it would cap Ground Truth quality at a second model's errors.
3. **Run ViTPose in-browser via ONNX** — rejected: top-down ViTPose also needs a
   person detector, and a large model on the main thread fights the browser-bound
   architecture (AGENTS.md forbids new WASM runtimes in workers) for a dev-only
   tool. The downloader already runs offline per video.
4. **Denser-than-run ViTPose grid / keep only best-detected frames** — rejected:
   GT denser than the scored run buys no scoring resolution (extra frames have no
   run pose to compare), and keeping only confident frames biases the corpus
   toward easy poses.

## Consequences

- **The downloader gains a pose pipeline.** It must detect + track + select the
  Climber from the seed tap and run ViTPose per track box, exposed as an async
  job endpoint that writes `vitpose.json`. That work lives in the downloader
  program, not beta-scanner; this ADR fixes only the contract (request = Climber
  selection + video path + the exact Detection Frame timestamps to pose; artifact
  = `vitpose.json`, one frame per requested timestamp, **echoing that timestamp
  verbatim** so beta-scanner's 1 ms seed-match aligns frame-for-frame — the
  ViTPose run is not a denser grid). Full handoff spec:
  `.scratch/ground-truth-detection-eval/downloader-vitpose-contract.md`.
- **Calibration runs two models.** MediaPipe (to define Detection Frames) and
  ViTPose (to seed poses). Acceptable: calibration is the dev-only heavy step
  already, and the payoff is far less manual dragging.
- **Scaffold quality now depends on the tracker.** If the tracker follows a
  **Bystander**, the seed is wrong on those frames — caught by the human in the
  stepper, since ViTPose is only a scaffold. A lost track just means more dragging.
- **Circularity is broken for unverified frames.** Unverified Ground Truth is a
  ViTPose guess, so a scored MediaPipe run there measures divergence from an
  independent model rather than from itself — still soft, but no longer
  self-referential.
- **No change downstream.** Issue 03's GT schema, issue 08's scoring, the
  `groundTruthHash` stamp, and the prod / S3 pipeline are untouched.
