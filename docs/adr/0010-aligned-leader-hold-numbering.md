# Aligned-leader hold numbering

> **Superseded by the corner-badge hold redesign.** The off-to-the-side
> black-on-white label and the horizontal leader line described here are gone:
> the Hold number now rides in a small dark **corner badge** pinned to the glyph
> (no leader, no aligned label group). The glyph itself is an **outline-only**
> hand / foot shape — a single colour stroke with a transparent fill, so the wall
> reads through — where only the shape (hand vs foot) and orientation (mirrored for
> the left side) differentiate holds; there is no per-kind or per-side colour. The
> Hold inference, selectivity gates, shared-hold fan-out, and progressive reveal are
> all unchanged. See `pipeline/holdsOverlay.ts`.

Supersedes the *label placement* of [ADR 0007](0007-hold-detection-overlay.md) — the
greedy, outward-pushed, ring-search placement with angled leader lines — and moots the
"label layout can be cached" consequence of [ADR 0009](0009-authored-persisted-holds.md).
The **Hold** inference algorithm, the selectivity gates, the borderless per-side glyph
marker, the black-on-white number label, persistence, and the high-water reveal are all
unchanged — only *how each number label is positioned* changes.

ADR 0007's greedy placement threw each number toward the route's outer edge along
whatever angle first avoided a collision, tethered back by a sloped leader. The result
was a scatter of chips at varied distances and angles that read as visual noise, broke
cohesion, and made it harder to trace a number back to its Hold. Putting the number
*on* the glyph instead was tried (the digit centred on the glyph with an auto-contrast
halo) and rejected as distracting — it cluttered the glyph and fought the wall hold for
the same pixels, which is exactly the spot the overlay exists to keep visible.

## Decision

Keep the number in an off-to-the-side black-on-white label, but place it
**deterministically** with a straight **horizontal** leader from the glyph centre.
Glyphs are split into a left and right group by the **mean x** of all in-bounds Holds.
For each side, every label is offset from its glyph by the *same* horizontal distance

```text
D = (sideMaxX − sideMinX) + glyphWidth
```

so `label_x = glyph_x ± D` and `label_y = glyph_y`. Because D is constant per side, the
leaders are all the same length and horizontal, the whole label group sits one
glyph-width clear of that side's glyphs, and the labels keep the same left-to-right
arrangement as the glyphs they name.

## Considered options (the non-obvious choices)

1. **On-glyph numbers — tried, rejected as distracting.** Centring the digit on the
   glyph removes the leader entirely, but the number then competes with the wall hold
   for the same pixels and clutters the silhouette. Keeping the number off to the side
   keeps both the glyph and the rock under it clean.

2. **A collapsible HTML sidebar listing the numbers with connector lines — rejected.**
   It splits rendering across two coordinate spaces (the image-pixel `<canvas>` and
   screen-space DOM/SVG), which the framework-agnostic `pipeline/holdsOverlay.ts`
   boundary exists to avoid, and adds a second label renderer for no real gain.

3. **Deterministic per-side offset instead of greedy collision search.** The constant
   D gives equal-length parallel leaders and a label group that mirrors the glyph
   layout — orderly and predictable — rather than the varied angles/distances of the
   old ring search. Group geometry (mean and per-side min/max) is taken from *all*
   in-bounds Holds, not just the revealed ones, so a label's position is fixed from the
   start and does not shift as later Holds reveal.

4. **Split by mean x, label outward.** Glyphs left of the mean get left-side labels,
   glyphs right of it get right-side labels, so numbers always sit on the route's
   outer side and the leaders point away from the climb rather than across it.

## Consequences

- **The greedy per-frame label layout is gone, so the plan cache goes with it.** ADR
  0009 cached that layout because it was the per-frame cost; the deterministic
  placement is cheap, so geometry (including the shared-hold fan-out) is computed
  inline each frame and the `WeakMap` plan cache is removed. ADR 0009's persistence
  decision is untouched — only its caching consequence is moot.
- **Shared-hold fan-out is kept.** A hand and a foot on the same spot are still two
  Holds; they are fanned apart horizontally so both glyphs and both labels read.
- **Labels can run off-canvas for very wide routes.** D scales with a side's glyph
  span, so a side whose glyphs span most of the photo width pushes its labels past the
  edge. Accepted for now (routes are normally centred with margin); revisit with a
  clamp if it bites in practice.
- **No glossary change.** CONTEXT.md describes Holds as "numbered markers placed where
  the Climber's hands and feet used a hold," which stays accurate.
- **No new style-panel controls.** The Overlay panel keeps the Holds visibility toggle
  and the per-side color legend; the placement ships as a default.
- **Same on every surface.** `drawHolds` runs only inside `FramePlayer`, so the look
  applies identically to the Detection Preview, the saved-Run Route Overlay, and both
  Compare slots. The annotated WebM remains pose-only (ADR 0007), unaffected.
