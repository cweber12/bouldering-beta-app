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

## Comments

**The code half is verified; the curation half is the maintainer's.** Authoring
needs a signed-in browser and the maintainer's own S3 Runs, so nothing in this
issue can be closed from an agent session. What _was_ verifiable without them is
below, so the maintainer's sitting takes one pass rather than several.

The status stays `ready-for-agent` on purpose: this note is preparation, not the
issue's work, and the work still starts from `main` on its own branch.

### Verified ahead of the sitting

**Assembly and the payload budget, at three clips.** The merge script was run on
a synthetic three-item playlist built from the checked-in clip, to spend the
budget at the real per-clip weight before any curation time is:

```text
3 items, 1018.3 KB total
  0  run-…-maze-of-death   339.4 KB  (193.1 KB images)  Bishop / Maze of Death / V12
  1  …                     339.4 KB  (193.1 KB images)  …
  2  …                     339.4 KB  (193.1 KB images)  …
```

**1018 KB against the 1.2 MB ceiling — ~200 KB of headroom.** Issue 01's trim
carries the set: three clips at the pre-trim 684 KB would have been 2.05 MB. The
budget criterion is therefore not at risk from curation choices, and a fourth
clip would still fit if one of the three does not earn its place.

The mixed-aspect path was exercised too, with a portrait clip behind a landscape
item 0 — it names the offender and writes anyway, as issue 02 specified:

```text
warning: item 1 (…-portrait) is 720x1280 (0.563) but item 0 sets the stage at
1280x720 (1.778), so item 1 will letterbox.
```

The duplicate-id refusal exits 1 with a readable message. Note that item 0 today
is **1280×720 landscape**, so the second and third clips want landscape sources.

**The mechanical playlist behaviour is already under test.** Four suites, 50
tests, all passing — cycling in file order, the wrap back to item 0, the handoff
compositing two whole clips at complementary alphas, pause freezing the cycling
and resuming from the same point, the five-item cap, deferred decode of later
clips, reduced motion parking on the static final frame, the pause control's
keyboard reachability, and the three degradation paths (missing asset, rejected
fetch, guard-failing item).

That is what the browser pass is _not_ for. It is for the things jsdom cannot
see: whether the crossfade reads as a dissolve rather than a cut, whether a
paused handoff looks frozen mid-dissolve rather than snapped, and whether each
clip's own wall still, starfield, morph and Route Photo actually land.

### Curation runbook

1. `npm run dev`, then open `/dev/landing-clip` signed in. Pick a Fixed Capture
   Run on a **different Route from Maze of Death**, ideally a different area —
   the playlist should read as a body of work. The route needs ORB reference
   features and a pose track ≥ 20 s, or the page says why it cannot be used.
2. Prefer a **landscape source** (item 0 is 1280×720 and sets the stage). If the
   best clip is portrait, take it and accept the letterbox knowingly — the merge
   script will name it.
3. Scrub the window slider to the most legible 20 s, attach an **uncropped frame
   of that same video** as the wall still, then the Route Photo. Wait for
   `Aligned`. Download the item.
4. Repeat for a third Run.
5. Assemble, item 0 first — argument order is play order:

   ```powershell
   npm run landing:merge -- `
     "$env:USERPROFILE\Downloads\landing-replay-run-1781544419409-maze-of-death.json" `
     "$env:USERPROFILE\Downloads\<clip-2>.json" `
     "$env:USERPROFILE\Downloads\<clip-3>.json"
   ```

   It writes `public/landing-replay.json` and prints the per-clip breakdown.
   Confirm the total is ≤ 1.2 MB, then re-run the asset gate
   (`npx vitest run __tests__/pipeline/landingReplayAsset.test.ts`) before
   checking the asset in.

### Browser QA checklist

Three items is a **36 s cycle**; each clip owns 12 s, with a 300 ms crossfade
opening every slot (at 12.0 s, 24.0 s, and 36.0 s → wrap). Within one clip:

| Clip time | What should be on screen                                      |
| --------- | ------------------------------------------------------------- |
| 0–1.4 s   | that clip's own wall still rising out of black                |
| 1.4–3.6 s | the starfield igniting on that still                          |
| 3.6–6.7 s | the still receding to black, field thinning to matched points |
| 6.7–9.7 s | points and Skeleton migrating; the Route Photo rising late    |
| 9.7–12 s  | the finished Route Overlay alone                              |

- Watch a full 36 s: file order, then the wrap from item 2 back to item 0.
- Watch a handoff closely — a dissolve, not a cut.
- Hit pause _during_ a handoff (~12.0 s or ~24.0 s). It should freeze mid-
  dissolve with both clips visible, and resume from that same blend rather than
  snapping to either one.
- Confirm each of the three clips shows all five rows above with **its own**
  still and photo — not just item 0.
- `prefers-reduced-motion: reduce` (devtools → Rendering → Emulate CSS media):
  the hero should park on item 0's finished Route Overlay and stay there until
  play is pressed. Tab to the pause control and operate it with Enter/Space.
- Rename `public/landing-replay.json` aside, reload: the hero renders nothing
  and the rest of the page keeps its text. Rename it back.

When the pass is clean, tick the boxes above, close this issue, and note in
`.scratch/done/ui-public-landing-replay-curation/issues/17-playlist-cycling-curated-assets-and-docs.md`
that its transferred criterion was satisfied here.
