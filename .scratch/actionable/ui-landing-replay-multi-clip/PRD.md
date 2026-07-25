# PRD: Landing Replay Multi-Clip Playlist

Status: in-progress
Disposition: actionable

## Problem Statement

The landing hero plays **one** curated clip. The playlist format already supports
1-5 items in file order, and the renderer already cycles and hands off between
them — none of that is speculative, it is tested and shipped. What is missing is
everything that makes going past one clip actually practical:

1. **The asset does not scale.** One clip is **684 KB**: a 231 KB wall still, a
   224 KB Route Photo, and 248 KB of geometry (a 3000-point starfield and 100
   poses × 33 landmarks × 2 coordinate spaces). Five clips is ~3.4 MB, fetched in
   a single request before the hero draws anything and decoded in full on load.
   That is a poor trade on a portfolio landing page.
2. **Nothing checks a multi-item asset.** Merging means hand-editing a
   three-quarter-megabyte file of base64 to concatenate `items` arrays. Duplicate
   ids, a mismatched aspect, or a sixth item are all silent failures — the sixth
   is dropped with no warning at all.
3. **Mixed aspect ratios are unresolved.** The stage takes its shape from
   `items[0].source` and holds it for the whole playlist, deliberately, so a
   handoff cannot reflow the page. A portrait clip in a landscape-led playlist
   therefore letterboxes, and no one is told.
4. **Playlist-level QA has never run.** Cycling, handoff and wrap need at least
   two clips to observe. This criterion transferred here unticked from
   `.scratch/done/ui-public-landing-replay-curation/issues/17-playlist-cycling-curated-assets-and-docs.md`.

## Solution

Make a 3-clip playlist the supported, verified shape — cheap enough to ship,
mechanical to assemble, and checked rather than hoped for.

Sequenced so the export format settles **before** more clips are authored:
trimming the serializer after curating three clips means re-authoring all three.

### Design invariants carried forward

These were decided in the curation PRD and are **not** reopened here:

- One static asset at `public/landing-replay.json`, same origin as the page's own
  JavaScript. No fallback artifact, no second load path, no runtime publish.
- Order is array order in the checked-in file. No reorder UI, no default item, no
  previous/next navigation. The hero stays passive.
- The exported item is pure geometry. The renderer only lerps and crossfades.
- One stage shape for the run of the page, so a handoff cannot reflow the layout.
- Public labels are `area`, Route name, `rating` — nothing else ships.

### Payload budget

Target **≤ 1.2 MB** for a 3-clip playlist, from ~2.05 MB today. Per clip that is
~400 KB against 684 KB. The levers, largest first:

| Lever | Today | Proposed | Saved/clip |
| --- | --- | --- | --- |
| Route Photo + wall still WebP | 455 KB (q0.75, ≤1280×960) | q0.6, ≤960×720 | ~230 KB |
| Starfield points | 3000 | ~800 strongest by ORB response | ~40 KB |
| Pose coordinate precision | 4 dp | 3 dp (≈2 px at 1080) | ~15 KB |

The starfield cap is nearly free: the hero draws each point as a ~2 px dot on a
900 px stage, so 3000 of them is far past what reads as texture. Image quality is
where the weight actually is, and it is the one lever with a visible cost — the
Route Photo is the final frame the whole clip resolves onto.

## Implementation Decisions

- **Trim the serializer first, then curate.** Issue order is load-bearing.
- **Keep one asset.** Splitting into per-clip files would fix the single large
  fetch but breaks the single-artifact invariant and adds the fallback path the
  curation PRD deliberately refused. Defer *decode* instead of splitting *fetch*.
- **The first frame must not wait on clips it is not showing.** Item 0's images
  are what gate the opening; later items decode behind it.
- **Same-aspect clips are the supported path.** Mixed aspects still play, still
  letterbox, and now warn at assembly time instead of surprising the maintainer
  on the landing page.
- **Assembly is a script, not hand-editing.** It concatenates exports in argument
  order and refuses obvious mistakes.
- **Cap stays 5** in the contract, but the curated set targets 3 — enough to show
  range without the asset dominating the page weight.
- **Curation guidance:** clips should differ in Route and area, so the playlist
  reads as a body of work rather than one climb three ways.

### Deliberately excluded

- **No per-clip lazy fetch.** One asset, one request; only decode is deferred.
- **No per-item stage aspect and no animated stage transition.** Reflow at the
  handoff is exactly what the fixed stage exists to prevent.
- **No reorder UI, no randomisation, no per-item timing overrides.** Unchanged
  from the curation PRD.

## Testing Decisions

- Serializer tests pin the starfield cap (strongest-first, not first-N-encountered)
  and the coordinate precision.
- The checked-in asset gate extends to multi-item invariants: distinct ids, a
  total-size ceiling, and an aspect-consistency check that fails loudly.
- Assembly-script tests cover concatenation order, duplicate ids, over-cap input,
  and mismatched aspects.
- Playlist QA is observed in a browser with ≥2 clips: cycling order, the 300 ms
  handoff, the wrap to the first item, and that pause freezes a handoff mid-cross-
  fade.

## Out of Scope

- Panning Capture support, cross-user curation, runtime publish APIs.
- Video-backed clips (the hero draws stills and geometry; it does not play video).
- Any change to the four-phase storyboard or its window timings.

## Branch and Start Order

One issue per branch, branched from `main`, in this order:

1. `feat/landing-replay-payload-trim`
2. `feat/landing-replay-assembly`
3. `feat/landing-replay-deferred-decode`
4. `feat/landing-replay-curate-set`

Dependency summary:

- 01 has no blockers and must land before any clip is re-authored.
- 02 blocked by 01.
- 03 blocked by 01.
- 04 blocked by 01, 02 and 03 — it is the curation and QA slice.
