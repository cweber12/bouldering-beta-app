# Docs: CONTEXT glossary + ADR for detectionAnnotations on Ground Truth

Status: ready-for-agent
Type: AFK

## Parent

- `.scratch/actionable/dev-detection-annotation-ui/PRD.md`

## What to build

Record the new field and its contract so it is discoverable without reading the harness
repo:

- Add a **Detection Annotation** glossary entry to `CONTEXT.md` (alongside Ground Truth /
  Detection Frame / Detection Error), noting it is a `detectionAnnotations` field *inside*
  `ground-truth.json`, plus short definitions of **failure class** (5 values) and
  **distractor** (9 values) with the enum vocabulary.
- Add a short ADR under `docs/adr/` (next number after 0020), or extend an existing
  detection-eval ADR (0017–0020), recording: `detectionAnnotations` as an **off-hash** field
  on the persisted Ground Truth (persisted but excluded from `canonicalGroundTruthInput`,
  so it never changes `groundTruthHash`), staleness governed by the GT's own `setupHash`,
  and the cross-repo split (scanner writes, beta-scan-analysis#45 ingests). Reference the
  harness handoff doc `docs/handoffs/scanner-detection-annotations.md` (PR #62).
- Update `README.md` only if warranted — dev-only, so a note in any harness section rather
  than the Pages table.

## Acceptance criteria

- [ ] CONTEXT.md carries a Detection Annotation glossary entry with the enum vocabulary and
      the "inside ground-truth.json" location.
- [ ] An ADR records the off-hash persistence, `setupHash`-governed staleness, and the
      cross-repo split, referencing the handoff doc.
- [ ] README updated only where a dev-visible reference is warranted.
- [ ] Lint/format clean.

## Blocked by

- Best landed with or after Issue 02 so the docs describe shipped behavior; can batch with
  02's merge.
