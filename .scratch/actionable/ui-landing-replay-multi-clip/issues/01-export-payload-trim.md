# 01 - Export payload trim

Status: in-progress
Branch: feat/landing-replay-payload-trim

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

- [x] Cap the exported starfield to the strongest ORB responses (~800), selected
      by `response`, not by array order — a first-N slice would take an arbitrary
      corner of the wall.
- [x] Round exported coordinates to 3 dp (≈2 px at 1080), pose and starfield
      alike. Clip-relative times keep millisecond resolution.
- [x] Compress both embedded images at a lower quality/dimension budget, and
      verify by eye that the Route Photo still reads as the payoff frame — it is
      the last thing on screen and the only lever here with a visible cost.
- [x] A freshly exported clip is ≤ ~420 KB, with the geometry portion under
      ~120 KB. (Clip 348 KB; geometry 150 KB — see Comments.)
- [x] Re-export the checked-in clip with the trimmed serializer and replace
      `public/landing-replay.json`, so the shipped asset matches the format.
      (Retrofitted rather than re-authored — see Comments.)
- [x] The asset gate still passes, including the privacy scan.
- [x] Tests cover the starfield cap's selection rule and the coordinate
      precision.

## Blocked by

None - can start immediately

## Comments

**Measured result.** The checked-in clip went from 684 KB to **348 KB**, under the
~420 KB target: the wall still 237 KB → 82 KB, the Route Photo 230 KB → 66 KB
(both at q0.6 / longest edge 960), and geometry 217 KB → 150 KB.

**The ~120 KB geometry sub-target was not reachable from the three levers in this
issue,** and the PRD's own table says so: it books ~40 KB for the starfield cap
and ~15 KB for precision against a 248 KB baseline, which lands at ~193 KB. The
levers actually did better than that — the starfield cap took 71 KB → 17 KB and
3 dp took the poses 143 KB → 130 KB — but poses alone are 130 KB of the 150 KB,
and nothing in this issue touches pose count, landmark count, or the two baked
coordinate spaces. Getting under 120 KB means reopening one of those, which is a
contract change and a separate decision.

**The checked-in asset was retrofitted, not re-authored.** A true re-export needs
the authoring route's S3 Run in a signed-in browser, and the exported item no
longer carries ORB `response` values, so the strongest-800 rule cannot be applied
after the fact. The shipped asset was instead brought to the trimmed format by a
one-off script: images re-encoded at the new budget with `sharp`, all coordinates
re-rounded to 3 dp, and the starfield thinned to 800 by an even stride through
extraction order (ORB detection order is not spatial, so a stride is unbiased —
it is simply not response-ranked). Issue 04 re-authors the curated set through
the serializer proper, at which point the shipped starfield becomes the
response-ranked one. The script is not checked in; it would be dead code after 04.

**Route Photo checked by eye** at the new budget: rock texture, chalk, and the
snowline all read; the softening is confined to sky and distant foliage. The wall
still — which the starfield ignites on — holds its texture too.
