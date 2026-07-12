# Ground-truth-scored detection eval

Spec: `docs/adr/0018-ground-truth-scored-detection-eval.md` (extends ADR 0017).
Glossary: CONTEXT.md — **Ground Truth**, **Detection Error**, **Detection Frame**, **Scan Setup**, **Test Video**.

## Problem

ADR 0017's harness gives aggregate per-run diagnostics (`detectionRate`, `flippedFrames`) but no per-frame reference: it cannot say **which** frames failed, **how far** the pose was off, or **why**. Its human labels are video-level, one value per clip.

## Approach

Calibration authors per-video **Ground Truth** once, by correcting a throwaway detection scaffold. Every later run is scored **headlessly** against it into **Detection Errors** (missing / wrong / extreme / drift). All manual input — crops, Ground-Truth Landmarks, video metadata — is frozen per-video; no human is in the loop per run. Causes are found by correlating the auto per-frame conditions + video-level metadata against measured errors across the corpus.

## Slices

01 stepper+filmstrip · 02 auto per-frame conditions · 03 GT model+proxy · 04 landmark editor (HITL) · 05 frame states+occluded · 06 editable metadata · 07 calibration flow split · 08 headless scoring · 09 batch GT gate.

## Out of scope

- Cross-video route-photo matching (ADR 0017 §6, still deferred).
- Full 33-joint dense ground truth (core body-joint set only).
- A scores dashboard — trend analysis reads the corpus; this feature produces the records.
