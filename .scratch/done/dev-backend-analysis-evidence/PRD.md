# Backend Analysis Evidence Payload

Status: done
Disposition: done

Spec inputs: GitHub issue comment `cweber12/beta-scan-analysis#68` comment `5071900098`; grilled decisions from 2026-07-24; `beta-scan-analysis/docs/handoffs/scanner-detector-attempt-evidence.md`.
Glossary: CONTEXT.md - **Detection Frame**, **Climber**, **Adaptive Crop**, **Adaptive Refinement**, **Ground Truth**, **Detection Error**, **Scan Setup**, **Test Video**.

## Problem Statement

The scanner can now export frame source provenance, but the backend still lacks enough scanner-side evidence to explain detection failures well. Dense playback frames (`interpolated`, `filled`, smoothed, constrained) are useful for the user-visible skeleton, but they are not direct detector evidence. The backend needs richer inputs from the browser run so it can compare scanner decisions against Ground Truth: whether a rejected raw pose should have been rejected, whether an adaptive crop was misplaced or too tight, whether reacquire rescued an initial crop failure, and whether frame conditions correlate with measured Detection Errors.

## Solution

Enhance the backend analysis payload with one canonical **detector attempt** stream from dev Analyze. Each detector attempt represents a MediaPipe attempt on the scanner's sampled 100 ms timeline, with the scanner's crop decision, raw selected keypoints when present, acceptance/rejection status, compact candidate-selection metadata, and scanner-observed frame conditions. Backend analysis semantics stay backend-owned: the scanner only supplies evidence; the backend compares it with Ground Truth and produces recommendations.

User-facing scanning remains unchanged. The dev Analyze path uses `frameStep = 1`, keeps the same adaptive crop logic, disables Adaptive Refinement at that stride, and excludes interpolated/filled/smoothed/constrained playback frames from the current backend evidence payload.

## User Stories

1. As a backend analysis author, I want every scanner detector attempt exported with its outcome, so that backend metrics can distinguish misses, accepted poses, flip rejections, and quality rejections.
2. As a backend analysis author, I want rejected raw keypoints sent before scanner-side mutation, so that the backend can compare them with Ground Truth and decide whether the rejection was correct.
3. As a backend analysis author, I want accepted detector keypoints sent separately from raw rejected evidence, so that final pose success is not confused with discarded detector output.
4. As a backend analysis author, I want crop rectangles for each detector attempt, so that I can measure whether crop size or placement caused failures.
5. As a backend analysis author, I want reacquire frames marked as accepted-but-rescued when applicable, so that crop quality and pose quality can be analyzed separately.
6. As a backend analysis author, I want scanner-observed condition stats for each attempted region, so that failure correlations no longer require decode-time frame reprocessing.
7. As a backend analysis author, I want compact candidate metadata, so that climber-selection failures can be investigated without bloating the payload with every MediaPipe candidate pose.
8. As a harness user, I want dev Analyze to keep the scanner's current adaptive crop behavior, so that backend evidence reflects the detection path users rely on.
9. As a harness user, I want dev Analyze to sample every 100 ms frame for analysis, so that the backend sees direct detector evidence instead of interpolation filling the gaps.
10. As a developer, I want dense playback frames kept out of the current backend evidence payload, so that detector and reconstruction signals stay separable.
11. As a developer, I want normalized crop rectangles only, so that backend comparisons against normalized Ground Truth boxes are simple and resolution-independent.
12. As a developer, I want Ground Truth-derived bbox and condition comparisons computed backend-side, so that scanner artifacts never leak evaluation truth into run data.

## Implementation Decisions

- **Canonical evidence stream.** Replace the current dense `pose.frames` export for backend analysis with a single `detectorAttempts` evidence stream. It includes accepted, rejected, and missing detector attempts in one shape.
- **Payload authority.** Ground Truth owns expected Climber presence and pose. `detectorAttempts[]` owns scanner detector evidence: MediaPipe attempts, selected raw keypoints, accepted keypoints, crop/reacquire behavior, candidate metadata, and scanner-observed search conditions.
- **Setup metadata is advisory.** Keep `setup.json.analysisInputs` entry UI and payload fields, but treat those labels as provenance metadata only. Backend scoring should use Ground Truth and detector-attempt evidence for main evaluation.
- **Analysis-only execution knobs.** Dev Analyze runs with `frameStep = 1`, keeps the same adaptive crop logic as the scanner, and disables Adaptive Refinement because stride 1 already visits the sampled frame grid directly.
- **Attempt statuses.** Export statuses as `accepted`, `missing`, `flipRejected`, and `qualityRejected`. `limbExpanded` is not a rejection; it is an accepted detector output source.
- **Raw evidence.** For rejected poses, export the selected climber pose exactly as MediaPipe returned it after mapping to full-frame coordinates, before filtering, flip rejection, interpolation, smoothing, or constraints.
- **Accepted evidence.** Export `acceptedKeypoints` only for accepted detector attempts. Export `rawKeypoints` whenever MediaPipe returned a selected climber pose, including rejected attempts.
- **Quality rejection derivation.** Since filtering happens after the sparse detected sequence is assembled, classify `qualityRejected` after the loop by comparing flip-kept detected frames against `goodFrames`.
- **Crop fields.** Export normalized rects only, with video dimensions already available once in diagnostics. Full-frame is represented explicitly as `{ x: 0, y: 0, w: 1, h: 1 }`; `null` means unknown or not applicable.
- **Reacquire semantics.** Keep pose outcome and crop outcome separate. A frame can be `accepted` and also `reacquired: true` when the initial adaptive crop failed but full-frame reacquire found the Climber.
- **Crop field names.** Use `initialSearchRegion` for the scanner's first attempted crop and `detectionRegion` for the region that produced the raw selected pose. On a miss, `detectionRegion` is `null`.
- **Frame conditions.** Every attempt carries `searchConditions` for the initial region. Reacquire attempts add `reacquireConditions` only when the successful region differs.
- **Candidate metadata.** Export only `candidateCount`, `rejectedCandidateCount`, and `selectionMethod` (`tap`, `tracked`, `strongest`). Reacquire is represented by `reacquired`, not as a selection method. Do not add `selectionDistance` in this iteration.
- **Continuity outputs deferred.** Interpolated, filled, smoothed, and constrained landmarks remain useful for future continuity analysis and user-visible playback evaluation, but are out of the current backend evidence payload.
- **Backend compatibility.** The harness should prefer `data.detectorAttempts[]` when present. Older runs with only `data.frames[]` remain readable as legacy/proxy evidence. Missing `detectorAttempts[]` means the attempt stream is unknown; it must not be inferred as raw detector success.

## Testing Decisions

- Good tests should assert payload behavior and scoring inputs at public seams, not internal loop mechanics.
- Processor-level tests should cover attempt classification, raw rejected keypoint preservation, normalized crop export, reacquire crop semantics, and condition attachment with OpenCV mocked at the module boundary.
- Harness payload tests should confirm `detectorAttempts` are posted without schema stripping and dense playback frames are not used as detector evidence.
- Scoring tests should continue proving that only detector evidence participates in current Ground Truth scoring, not interpolated or filled continuity frames.
- Existing source provenance tests should be updated rather than duplicated where they already cover accepted `raw` and `limbExpanded` frames.
- Compatibility tests should assert that legacy `frames[]` runs remain readable while current detector scoring prefers `detectorAttempts[]` and treats a missing attempt stream as unknown.

## Out of Scope

- Changing user-facing scan behavior, quality tier defaults, or Detection Preview playback.
- Sending all MediaPipe candidate poses.
- Sending pixel crop rects in addition to normalized rects.
- Computing Ground Truth bbox comparisons in the scanner.
- Adding a full interpolation/reconstruction analysis stream.
- Backend recommendation logic changes beyond consuming the enhanced payload.

## Further Notes

- The linked issue comment showed complete source coverage but zero per-frame `climber`/`wall` region-stat objects in newly posted pose frames. This PRD addresses that missing scanner-side evidence without moving interpretation out of the backend.
- If a glossary term is added, prefer **Detector Attempt** for the exported evidence row: a scanner-owned record of one MediaPipe attempt and the scanner decisions around it.
- Computed pixel conditions are primary predictors for analysis and should describe the region searched on that detector attempt.

