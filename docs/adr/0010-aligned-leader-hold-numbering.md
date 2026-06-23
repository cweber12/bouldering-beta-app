# On-glyph hold numbering

Supersedes the *labeling* design of [ADR 0007](0007-hold-detection-overlay.md)
(the white-number-disc marker) and the leader-line / outer-side label placement that
grew on top of it, and moots the "label layout can be cached" consequence of
[ADR 0009](0009-authored-persisted-holds.md). The **Hold** inference algorithm, the
selectivity gates, the per-side glyph marker, persistence, and the high-water reveal
are all unchanged — only *how the number is drawn* changes.

The hand / foot **glyph** marker (ADR 0009 era) read well, but the number was set off
to the side in a white chip and tethered back to its glyph by a colored leader line,
placed greedily toward the route's outer edge so chips never overlapped. In practice
that scatter of chips and leaders was the dominant visual noise on the overlay,
broke cohesion with the rest of the site styling, and — by throwing digits away from
the wall — made it harder, not easier, to connect a number to its Hold and to see the
actual rock feature underneath. A collapsible sidebar listing the numbers with
connector lines was considered first and rejected (see below).

## Decision

Draw the number **on the glyph itself** and delete the leader/chip/placement machinery
entirely. Each marker is now self-contained: a hand / foot glyph with a crisp
full-opacity stroke in its per-side color, a lighter translucent fill so the rock reads
through, and the number centered on the glyph (which sits at the limb's contact point)
in an auto-contrasting color with a thin opposite-color halo.

## Considered options (the non-obvious choices)

1. **A collapsible HTML sidebar over the player, listing numbers with connector lines
   to each glyph — rejected.** It splits rendering across two coordinate spaces (the
   image-pixel `<canvas>` and screen-space DOM/SVG), which the framework-agnostic
   `pipeline/holdsOverlay.ts` boundary exists to avoid, and it adds a second label
   renderer for no legibility gain over putting the number on the Hold. Putting the
   number *on* the glyph makes the "connect the number to its Hold" problem vanish
   outright — the number is the Hold.

2. **Keep the hand / foot SVG glyphs; do not fall back to plain dots or rings.** The
   glyph is what encodes the **Hand Hold** / **Foot Hold** distinction at a glance, a
   first-class domain split (see CONTEXT.md). Generic numbered dots and hollow rings
   were considered for maximum rock visibility but were rejected because they erase
   that distinction from the visual unless re-encoded by color alone, which the
   near-monochrome per-side palette does not carry reliably.

3. **Auto-contrast the number from the glyph's luminance, rather than a fixed color.**
   Glyphs are light for hands and dark for feet, so a single fixed number color is
   weak on one of them. The number color (and its halo) are derived from the hold
   color's luminance — dark digit + light halo on light glyphs, light digit + dark
   halo on dark glyphs — so the digit always pops off the glyph *and* survives any
   future recolor of the holds. The halo also separates the digit from busy rock
   showing through the lightened fill.

4. **Add a crisp stroke and lighten the fill, reversing ADR 0009's "no border" glyph.**
   The border-less translucent glyph read as a faded blob; a full-opacity stroke makes
   it a deliberate icon, which then lets the fill drop (~0.55 → ~0.35) so substantially
   more rock shows through while the marker stays obvious.

## Consequences

- **The greedy per-frame label layout is gone, so the plan cache goes with it.** ADR
  0009 cached that layout because it was the per-frame cost; with on-glyph numbers
  there is no placement step, so geometry (including the shared-hold fan-out) is
  computed inline each frame at trivial cost and the `WeakMap` plan cache is removed.
  ADR 0009's persistence decision is untouched — only its caching consequence is moot.
- **`HoldStyle` loses `labelColor` and `numberColor`.** Both were internal to
  `holdsOverlay.ts` and unused by the style panel; the number color is now computed.
  `holdsVisible`, `radius`, and `fillOpacity` remain.
- **Shared-hold fan-out is kept.** A hand and a foot on the same spot are still two
  Holds; they are fanned apart horizontally so both glyphs and both numbers read.
- **No glossary change.** CONTEXT.md describes Holds as "numbered markers placed where
  the Climber's hands and feet used a hold," which stays accurate — the change is
  purely how the number is rendered.
- **No new style-panel controls.** The Overlay panel keeps the Holds visibility toggle
  and the per-side color legend; the new glyph weight and number contrast ship as
  defaults.
- **Same on every surface.** `drawHolds` runs only inside `FramePlayer`, so the new
  look applies identically to the Detection Preview, the saved-Run Route Overlay, and
  both Compare slots. The annotated WebM remains pose-only (ADR 0007), unaffected.
