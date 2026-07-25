# 01 - Export payload trim

Status: ready-for-agent

## Parent

- .scratch/actionable/ui-landing-replay-multi-clip/PRD.md

## What to build

Cut an exported clip from ~684 KB to ~400 KB, so a three-clip playlist fits the
PRD's 1.2 MB budget.

This lands **first** because it changes the export format: trimming after clips
are curated means re-authoring every one of them.

All three levers are in code the curator never sees — the serializer and the
WebP compression helper. No authoring UI changes, no contract changes.

## User stories covered

- Portfolio-grade landing page that is not multiple megabytes.
- Curation that does not have to be redone when the format tightens.

## Acceptance criteria

- [ ] Cap the exported starfield to the strongest ORB responses (~800), selected
      by `response`, not by array order — a first-N slice would take an arbitrary
      corner of the wall.
- [ ] Round exported coordinates to 3 dp (≈2 px at 1080), pose and starfield
      alike. Clip-relative times keep millisecond resolution.
- [ ] Compress both embedded images at a lower quality/dimension budget, and
      verify by eye that the Route Photo still reads as the payoff frame — it is
      the last thing on screen and the only lever here with a visible cost.
- [ ] A freshly exported clip is ≤ ~420 KB, with the geometry portion under
      ~120 KB.
- [ ] Re-export the checked-in clip with the trimmed serializer and replace
      `public/landing-replay.json`, so the shipped asset matches the format.
- [ ] The asset gate still passes, including the privacy scan.
- [ ] Tests cover the starfield cap's selection rule and the coordinate
      precision.

## Blocked by

None - can start immediately
