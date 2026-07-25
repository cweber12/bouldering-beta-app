# Scan pipeline isolation for testability and maintainability

Status: ready-for-agent
Disposition: actionable

Spec inputs: scan-pipeline modularization review, detector-attempt evidence PRD, glossary terms in CONTEXT, ADRs for motion-adaptive pose quality, predictive tap-seeded Adaptive Crop, and independent Climber/Wall crops.
Glossary anchors: Climber, Adaptive Crop, Climber Crop, Wall Crop, Detection Frame, Detector Attempt, Landmark Flip, Adaptive Refinement, Fixed Capture, Panning Capture.

## Problem Statement

The scan pipeline is directionally well-organized by domain, but one orchestration surface currently owns too many responsibilities at once: crop decisions, frame conditioning, detector calls, acceptance/rejection logic, ORB preview extraction, authoritative ORB matching preparation, and detector-attempt evidence assembly. This concentration makes behavior hard to reason about, slows test authoring, and increases regression risk when changing any single part of the flow.

The product risk is not that the pipeline is conceptually wrong; the risk is that test seams are too coarse. Small changes can unintentionally affect Climber Identity, Adaptive Crop behavior, Detector Attempt semantics, or homography quality gating because those concerns are coupled in one execution loop.

## Solution

Refactor the scan pipeline in low-risk phases that preserve user-visible behavior and existing detector-attempt evidence semantics while isolating deep, stable modules.

The target design keeps orchestration where it is for now, but introduces explicit stage contracts:

1. Crop policy stage
2. Preprocessing policy stage (separate plans for pose and ORB)
3. Detector adapter stage
4. Acceptance policy stage
5. ORB caller stages (preview and authoritative)
6. Homography quality stage with default policy ownership
7. Diagnostics assembler stage

The resulting flow remains:

- crop policy -> preprocessing policy -> detector adapter -> acceptance policy -> diagnostics assembly

with ORB preview and ORB authoritative paths as separate callers into a shared ORB core.

## User Stories

1. As a maintainer, I want crop policy isolated from detector logic, so that Adaptive Crop behavior can be tested without MediaPipe dependencies.
2. As a maintainer, I want crop policy to emit both chosen region and decision metadata, so that Detector Attempt evidence can explain why a region was chosen.
3. As a maintainer, I want Wall Crop fallback derivation in the same crop policy boundary, so that all crop decisions live in one deterministic place.
4. As a maintainer, I want frame conditioning policy separated from pixel execution, so that decision rules can be tested with fixtures instead of canvas plumbing.
5. As a maintainer, I want separate preprocessing plans for pose and ORB, so that tuning one path does not silently change the other.
6. As a maintainer, I want preprocessing policy inputs to explicitly include frame conditions and run context, so that behavior is predictable and auditable.
7. As a maintainer, I want a detector adapter that only owns detector I/O concerns, so that detector backend interactions are isolated and swappable.
8. As a maintainer, I want an acceptance policy that owns climber selection and rejection semantics, so that Climber Identity behavior is testable without video seeks.
9. As a maintainer, I want accepted and raw keypoint outcomes clearly separated in the acceptance contract, so that analyzer evidence remains trustworthy.
10. As a maintainer, I want reacquire semantics explicitly represented by policy outputs, so that miss recovery can be verified independently.
11. As a maintainer, I want Landmark Flip and quality rejection classifications preserved through module boundaries, so that existing error analysis remains valid.
12. As a maintainer, I want ORB extraction to stay a standalone core module, so that feature extraction can evolve without UI coupling.
13. As a maintainer, I want scan-loading ORB preview to be a separate caller path, so that preview optimizations never change authoritative matching outcomes.
14. As a maintainer, I want authoritative ORB caller outputs to include matrix status diagnostics, so that matching failures are debuggable by reason.
15. As a maintainer, I want homography default quality thresholds centrally owned, so that policy does not drift across scan, compare, and analyze paths.
16. As a maintainer, I want caller-level homography overrides to be explicit, so that experiments are controlled and reviewable.
17. As a maintainer, I want detector-attempt diagnostics assembled by a dedicated module, so that evidence generation is decoupled from pipeline execution.
18. As a maintainer, I want evidence contracts to remain backward-compatible with legacy payloads, so that historical runs stay readable.
19. As a maintainer, I want each refactor phase to land independently, so that regressions are easier to isolate and revert.
20. As a maintainer, I want parity gates after each phase, so that behavior-preserving refactor claims are measurable.
21. As a maintainer, I want a clean seam for Fixed Capture and Panning Capture differences, so that capture-mode logic does not leak across unrelated stages.
22. As a maintainer, I want Adaptive Refinement triggers to remain policy-driven and testable, so that scan quality tuning is safer.
23. As a maintainer, I want stage-level contracts to use glossary-aligned terminology, so that domain intent is clear in code reviews.
24. As a maintainer, I want module boundaries that support faster targeted tests, so that development feedback loops are shorter and more accurate.
25. As a reviewer, I want refactor changes to keep user-visible scan output stable, so that quality improvements do not alter expected behavior accidentally.
26. As a reviewer, I want detector-attempt evidence parity checks in the rollout, so that backend analysis continuity is preserved.
27. As a reviewer, I want policy modules to be deterministic and side-effect free, so that failures are reproducible.
28. As a reviewer, I want orchestration to call stage contracts in a fixed sequence, so that dependencies remain explicit.
29. As an analysis author, I want scanner evidence to remain scanner-owned facts rather than inferred backend interpretations, so that scoring authority boundaries stay intact.
30. As an analysis author, I want missing evidence streams treated as unknown rather than success, so that metrics are not biased by absent data.

## Implementation Decisions

- Keep scan behavior and sequencing stable during the refactor; this is a behavior-preserving modularization effort, not an algorithm rewrite.
- Adopt low-risk phased extraction rather than a one-pass rewrite.
- Introduce explicit typed contracts between stages before moving logic.
- Define a deep crop policy module that owns:
  - Adaptive Crop region selection strategy
  - Climber/Wall crop policy interactions
  - decision metadata for each Detection Frame
  - deterministic clamping and normalization
- Define a preprocessing policy planner module that:
  - takes explicit inputs (frame conditions, crop metadata, run context, detector context)
  - emits two deterministic plans: pose plan and ORB plan
  - does not execute pixel operations itself
- Split pose detection responsibilities into two deep modules:
  - detector adapter: backend I/O and coordinate-mapping responsibilities
  - acceptance policy: selection, gating, reacquire outcomes, accepted/raw output shaping
- Preserve Detector Attempt status semantics (`accepted`, `missing`, `flipRejected`, `qualityRejected`) as compatibility constraints during extraction.
- Keep ORB extraction and matching primitives isolated from UI/runtime orchestration concerns.
- Formalize two ORB caller pipelines:
  - preview caller for Scan Loading View behavior
  - authoritative caller for route-photo alignment behavior
- Keep homography default quality gating policy in the homography layer, with explicit caller override hooks.
- Add a dedicated diagnostics assembler that consumes typed outputs from crop, preprocessing, detector, and acceptance stages.
- Keep evidence-shape compatibility requirements explicit:
  - detector-attempt stream remains canonical when present
  - legacy frame-only evidence remains readable
  - missing attempt stream remains unknown, not inferred success
- Keep capture-mode differences explicit in contracts where needed (Fixed Capture vs Panning Capture) rather than hidden branching.
- Align contract naming and result types with glossary language to reduce ambiguous terms.

## Testing Decisions

- Good tests assert external behavior and contract outputs, not internal implementation details.
- Good tests use deterministic fixtures for stage policy modules and avoid fragile dependencies on browser timing where possible.
- Good tests verify parity against current semantics before and after each extraction phase.
- Good tests include explicit compatibility cases for evidence ingestion behavior.

Modules selected for direct tests:

- crop policy stage
- preprocessing policy planner (pose plan and ORB plan outputs)
- detector adapter stage
- acceptance policy stage
- diagnostics assembler stage
- ORB authoritative caller contract behavior
- homography policy default-and-override behavior

Integration seams selected for focused tests:

- scan orchestration sequencing across extracted stages
- abort/cancel behavior while preserving partial progress correctness
- reacquire path correctness under missed detections
- detector-attempt evidence parity and compatibility semantics

Prior art to follow:

- existing pure utility/pipeline contract tests that rely on deterministic fixtures
- existing OpenCV-boundary mocking patterns where CV behavior is isolated at module boundaries
- existing harness payload and scoring compatibility tests for evidence precedence and legacy fallback

## Out of Scope

- Changing user-facing scan flow or interaction design.
- Replacing current detector backend choices.
- Re-tuning quality tiers as a primary objective.
- Redefining Detector Attempt scoring semantics owned by backend analysis.
- Introducing new storage artifacts solely for this refactor.
- One-pass rewrite of scan orchestration lifecycle management.
- Broad redesign of compare or replay systems unrelated to this scan modularization.

## Further Notes

- This work should be tracked and shipped as vertical slices that each preserve behavior and pass parity gates before proceeding.
- If parity fails in any phase, stop and resolve contract drift before additional extraction.
- The architecture already has many strong domain boundaries; the goal is to complete those boundaries around scan orchestration and evidence assembly.
- This PRD intentionally preserves authority boundaries: scanner emits evidence, backend analysis interprets it.
