# Analyzer handoff doc — video-identity pairing

Status: ready-for-agent
Type: AFK

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
