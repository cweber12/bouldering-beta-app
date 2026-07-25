# 04 - Curate the set and run playlist QA

Status: ready-for-agent

## Parent

- .scratch/actionable/ui-landing-replay-multi-clip/PRD.md

## What to build

Curate two more clips, assemble the three-clip playlist, and run the QA that has
never been possible with a single item.

This is the slice that needs the maintainer's browser and their own Runs — the
code is done by the time it starts. It also carries the regression criterion that
transferred unticked from the curation PRD's issue 17, because cycling and
handoff cannot be observed until a playlist has more than one clip in it.

## User stories covered

- A landing hero that shows range: different Routes, areas and grades.
- Cycling, handoff and wrap verified against the real thing.

## Acceptance criteria

- [ ] Author two more clips on `/dev/landing-clip`, each with a wall still
      attached, from Runs on different Routes — the playlist should read as a
      body of work, not one climb three ways.
- [ ] Prefer clips whose source video shares an aspect ratio with item 0; if one
      does not, confirm its letterboxing is acceptable rather than accidental.
- [ ] Assemble with the merge script and check the asset in. Total playlist
      ≤ 1.2 MB.
- [ ] Verify in a browser: items play in file order, each hands off with the
      ~300 ms crossfade, and the cycle wraps from the last item to the first.
- [ ] Verify pause during a handoff freezes the crossfade mid-dissolve and
      resuming continues it, rather than snapping to either item.
- [ ] Verify the four-phase behaviour holds for every clip, not just item 0 —
      each one's own wall still, starfield, morph and overlay.
- [ ] Re-confirm reduced motion parks on the first clip's finished Route Overlay
      and stays there until play, and that the pause control is keyboard
      reachable and operable.
- [ ] Re-confirm graceful degradation: temporarily move the asset aside and
      confirm the hero renders nothing and the page keeps its text content.
- [ ] Close out the transferred criterion in
      `.scratch/done/ui-public-landing-replay-curation/issues/17-playlist-cycling-curated-assets-and-docs.md`
      by noting where it was satisfied.

## Blocked by

- .scratch/actionable/ui-landing-replay-multi-clip/issues/01-export-payload-trim.md
- .scratch/actionable/ui-landing-replay-multi-clip/issues/02-playlist-assembly-and-asset-gate.md
- .scratch/actionable/ui-landing-replay-multi-clip/issues/03-deferred-decode-for-later-clips.md
