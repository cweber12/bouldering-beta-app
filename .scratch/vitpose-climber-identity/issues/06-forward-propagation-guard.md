# 06 — Forward-propagate a swap along the clicked person's track

Status: needs-triage
Gated on: issue 03 outcome (Phase B); depends on issue 05

## Context

Mid-clip hijacks span dozens of Detection Frames; per-frame clicking doesn't
scale. A swap follows the clicked person forward until their trail runs out
(PRD swap semantics).

## Scope

- New framework-agnostic propagation util: starting at the clicked frame's
  candidate, walk subsequent Detection Frames; select the candidate with the
  same `trackId`, bridging id breaks via nearest-box continuity with the same
  capped threshold constants as the downloader (`base 0.08`, `per-frame 0.04`,
  `cap 0.18`, gap measured in video time × nominal fps). Stop when no candidate
  qualifies.
- Review guard per reached frame: `auto` → replaced; `human-flagged-wrong` →
  replaced and reset to `auto`; `human-flagged-absent` → skipped (trail
  continues past it); `"human"` → skipped. The clicked frame itself follows
  issue 05's always-replace rule.
- Propagation is silent-forward (no confirm batch); the filmstrip stepper marks
  re-assigned frames distinctly until the next save.

## Acceptance

- Util tests: id-follow, bridge across an id break, stop at trail end, the full
  review-guard matrix, skipped-absent frame does not sever the trail.
- Component/stepper test: re-assigned frames marked.
- Manual: one click at the start of a known hijack segment fixes the rest of it.
