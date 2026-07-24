# 06 — Forward-propagate a swap along the clicked person's track

Status: wontfix
Gated on: issue 03 outcome (Phase B) — resolved ~zero, Phase B dropped; depended on issue 05 (also wontfix)

> Sequencing note (2026-07-16): if activated, land after
> `.scratch/done/pose-calibration-analyze-split/issues/02-video-keyed-ground-truth.md`
> (see the note on issue 04 — shared carry-forward semantics).
>
> Re-sizing note (2026-07-17): escape-hatch scope only, per the notes on
> issues 04–05. Also: the downloader's stitching is now scored
> motion+appearance (its issue #19), so the original parity claim in the PRD
> is stale — propagation here is **intentionally simpler** (motion-only),
> which is fine for a human-supervised click flow.
>
> Gate resolved (2026-07-17): issue 03 closed on its ~zero exit branch —
> Phase B is **deferred**; stays `needs-triage` as an escape hatch (see the
> gate note on issue 04).
>
> Closed `wontfix` (2026-07-17, user decision): Phase B dropped — see the
> closure note on issue 04.

## Context

Mid-clip hijacks span dozens of Detection Frames; per-frame clicking doesn't
scale. A swap follows the clicked person forward until their trail runs out
(PRD swap semantics).

## Scope

- New framework-agnostic propagation util: starting at the clicked frame's
  candidate, walk subsequent Detection Frames; select the candidate with the
  same `trackId`, bridging id breaks via capped nearest-box continuity
  (`base 0.08`, `per-frame 0.04`, `cap 0.18`, gap measured in video time ×
  nominal fps — the downloader's Phase A constants). This is intentionally
  simpler than the downloader's current scored motion+appearance stitching;
  motion-only suffices for a human-supervised click flow. Stop when no
  candidate qualifies.
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
