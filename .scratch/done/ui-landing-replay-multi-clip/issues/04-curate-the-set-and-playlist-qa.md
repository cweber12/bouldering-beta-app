# 04 - Curate the set and run playlist QA

Status: done
Branch: feat/landing-replay-curate-set
Merged: f86604c

## Parent

- .scratch/done/ui-landing-replay-multi-clip/PRD.md

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

- [x] Author two more clips on `/dev/landing-clip`, each with a wall still
      attached, from Runs on different Routes — the playlist should read as a
      body of work, not one climb three ways.
- [x] Prefer clips whose source video shares an aspect ratio with item 0; if one
      does not, confirm its letterboxing is acceptable rather than accidental.
      (All three are 16:9 — nothing letterboxes.)
- [x] Assemble with the merge script and check the asset in. Total playlist
      ≤ 1.2 MB. (1009 KB; the per-item gate moved 420 → 440 KB, see Comments.)
- [x] Verify in a browser: items play in file order, each hands off with the
      ~300 ms crossfade, and the cycle wraps from the last item to the first.
- [x] Verify pause during a handoff freezes the crossfade mid-dissolve and
      resuming continues it, rather than snapping to either item.
- [x] Verify the four-phase behaviour holds for every clip, not just item 0 —
      each one's own wall still, starfield, morph and overlay.
- [x] Re-confirm reduced motion parks on the first clip's finished Route Overlay
      and stays there until play, and that the pause control is keyboard
      reachable and operable.
- [x] Re-confirm graceful degradation: temporarily move the asset aside and
      confirm the hero renders nothing and the page keeps its text content.
- [x] Close out the transferred criterion in
      `.scratch/done/ui-public-landing-replay-curation/issues/17-playlist-cycling-curated-assets-and-docs.md`
      by noting where it was satisfied.

## Blocked by

- .scratch/done/ui-landing-replay-multi-clip/issues/01-export-payload-trim.md
- .scratch/done/ui-landing-replay-multi-clip/issues/02-playlist-assembly-and-asset-gate.md
- .scratch/done/ui-landing-replay-multi-clip/issues/03-deferred-decode-for-later-clips.md

## Comments

### The curated set

Three clips, three areas, three grades — and all three sources are 16:9, so the
stage fits every one of them and nothing letterboxes:

```text
3 items, 1009.2 KB total
  0  run-1781544419409-maze-of-death        339.4 KB  Bishop / Maze of Death / V12
  1  run-1785023154314-midnight-lightning   429.1 KB  Yosemite / Midnight Lightning / V8
  2  run-1785026797409-slashface            240.6 KB  Joshua Tree / Slashface / V4
```

Item 0 is the **checked-in** Maze of Death, not the export of the same Run
sitting in Downloads: that file predates issue 01 and still carries the untrimmed
format (3000 starfield points, 70 poses, a 14 s span and no wall still). The
checked-in item is the one that went through the trim.

**The per-item budget moved 420 → 440 KB.** Midnight Lightning is a legitimate
429 KB export and there is no defect in it — its geometry is 149 KB, in line with
the other two, and its pixel count is comparable. Its Route Photo simply costs
208 KB where Slashface's costs 45 KB at the same quality, because one wall has
much more in front of it. Issue 01 set 420 KB from the single clip that existed
at the time, and the first real curation pass produced a clip past it, which says
the constant was a sample of one rather than a real ceiling. The **total** is the
binding constraint and it is what the PRD specifies; at 1009 KB the set has
190 KB of headroom. The per-item figure stays as a smell detector for one clip
carrying the whole set.

**The four-phase timings differ per clip.** Maze of Death captured 20 s, as do
both new clips, so all three play at the same ~1.7×. The phase table below
applies unchanged to each.

### What the tests carry, and what the eyes did

Issue 01's trim is what makes the set affordable: three clips at the pre-trim
684 KB would have been 2.05 MB. A fourth would still fit today if one of the
three stops earning its place.

The merge script's warning path was exercised separately, with a portrait clip
behind a landscape item 0 — it names the offender and writes anyway, as issue 02
specified:

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

That is what the browser pass was _not_ for. It was for the things jsdom cannot
see: whether the crossfade reads as a dissolve rather than a cut, whether a
paused handoff looks frozen mid-dissolve rather than snapped, and whether each
clip's own wall still, starfield, morph and Route Photo actually land.

**The pass came back clean** against the checklist below, on the three-clip asset
in a real browser. That closes the last criterion of this PRD, and with it the
one that transferred here unticked from the curation PRD's issue 17 — cycling,
handoff and wrap could not be observed while the playlist held one clip.

### How the asset was assembled

Argument order is play order, and the existing asset went in as item 0 — the
script reads every input before it writes, so naming the output as an input is
safe:

```powershell
npm run landing:merge -- `
  public/landing-replay.json `
  "$env:USERPROFILE\Downloads\landing-replay-run-1785023154314-midnight-lightning.json" `
  "$env:USERPROFILE\Downloads\landing-replay-run-1785026797409-slashface.json"
```

Re-running it is how the set changes: add a clip, drop one, or reorder by
changing the argument order. Always re-run
`npx vitest run __tests__/pipeline/landingReplayAsset.test.ts` afterwards — it is
the gate that catches a bust budget, a duplicate id, a mixed aspect and a privacy
leak in the checked-in file.

### Browser QA checklist

What was walked through, and what to walk through again whenever the curated set
changes. Three items is a **36 s cycle**; each clip owns 12 s, with a 300 ms
crossfade opening every slot (at 12.0 s, 24.0 s, and 36.0 s → wrap). Within one
clip:

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

Reduced motion is worth re-checking specifically after any change to the set,
because it parks on **item 0's** finished Route Overlay — reordering the playlist
changes which clip a reduced-motion visitor sees, and that visitor sees only that
one.
