# Analyzer handoff doc — video-identity pairing

Status: wontfix
Type: AFK
Superseded-by: .scratch/calibration-freshness/scanner-calibration-freshness.md

## Parent

- `.scratch/calibration-analyze-split/PRD.md`

## What to build

A handoff doc for the beta-scan-analysis repo, in the same format as the established downloader contract (`.scratch/ground-truth-detection-eval/downloader-vitpose-contract.md`), specifying the analyzer's single required change: the evaluation pairing gate relaxes from setupHash equality to **video-identity pairing** — truth authored once grades runs made under any Scan Setup — with each run's `setupHash` carried as a reported dimension on evaluation records instead of a filter. Include: why (Ground Truth is now video-keyed; landmarks are full-frame normalized so setups cannot invalidate them), the legacy-truth note (sparse-grid files stay valid, no migration), a perf note that ViTPose jobs now carry ~5× more frames per job (contract unchanged), and a validation target against the analyzer's existing pytest suite.

## Acceptance criteria

- [ ] Handoff doc exists in this feature's directory, self-contained enough to execute in the analyzer repo without this conversation.
- [ ] Specifies the gate relaxation, the setupHash-as-dimension reporting, legacy-truth compatibility, and the ViTPose volume note.
- [ ] Names the analyzer-side test expectation (pairing across differing setupHashes yields evaluations; the mismatch-skip path is gone).

## Blocked by

None - can start immediately.

## Comments

- 2026-07-18: closed wontfix. Before this doc was written, the analyzer repo
  sent the opposite handoff (`.scratch/calibration-freshness/`, harness issue
  #21): it will **not** relax the pairing gate — truth corrected against one
  calibration's scaffold is only attested evidence under that calibration, and
  22 run/truth pairs were already skipping on setupHash mismatch while the
  scanner UI showed them healthy. The scanner now matches the hash contract
  instead (ADR 0020, commit 65d35ba): truth keeps the timestamp-keyed flag
  carry-forward from issue 02, but freshness/pairing is hash-chained and stale
  truth is surfaced, gated, and re-seeded rather than re-paired by video
  identity.
