# Clustered-ring hold overlay

Supersedes the _marker look and label placement_ of
[ADR 0010](0010-aligned-leader-hold-numbering.md) (which itself superseded
[ADR 0007](0007-hold-detection-overlay.md)). The **Hold** inference algorithm, the
selectivity gates, persistence, and the progressive reveal are all unchanged — this
ADR only changes how Holds are _drawn_ in `pipeline/holdsOverlay.ts`.

## Context

The previous overlay drew **one circle per Hold**. Because detection deliberately
keeps left/right and hand/foot distinct (ADR 0008 — never merge sides), a wall hold
used by both hands, or by a hand and a foot, produced several Holds at the same spot
and therefore a pile of **overlapping circles**. Combined with oversized glyphs (a
silhouette wider than its own circle's diameter), a number that fought the glyph for
the same pixels, and a badge-deconfliction step that could **fling a badge far off to
the side**, the result read as visual noise — the opposite of "which hold do I grab?"

## Decision

Draw the overlay as **clustered rings**. The data model is untouched; clustering is a
draw-time concern.

1. **One ring per cluster.** All in-bounds Holds are grouped by single-link proximity
   (centres within ~one ring radius, i.e. only Holds whose rings would visibly
   overlap). Each cluster draws **one transparent bordered ring** at the centroid of
   its members, so coincident Holds read as a single circle. The ring is slightly
   larger than before (`0.45 × bodyScale`) and its interior is kept clear so the wall
   hold shows through.

2. **Numbered glyph badges hang off the ring, side-anchored.** Each Hold keeps its own
   number and hand/foot glyph. Left-limb badges sit on the ring's **left arc** (rest at
   9 o'clock), right-limb on the **right arc** (3 o'clock); several on one side fan
   symmetrically along that arc. A glyph rests **flush just outside the stroke**,
   pointing inward — the contact implies the link, no leader line.

3. **The number rides on the glyph.** A bold **dark digit sits over the palm / ball**
   of the solid white silhouette — no separate disc. Its position comes from a
   **per-side centroid** (left/right entries mirror-symmetric about the glyph centre),
   so the digit reads **down-and-out toward its limb's side** — left limbs left, right
   limbs right. The digit **auto-fits** the glyph's solid region (a tighter cap on the
   foot's smaller "ball") so a two-digit number stays contained, and carries a **thin
   white halo**: invisible on the white glyph, but giving the digit a readable backing
   wherever it spills onto rock — legibility without re-adding a disc.

4. **Smaller glyphs, tied to the ring.** Glyph span scales as a fixed fraction of the
   ring radius (`≈ ring radius`), roughly half the old size, so ring and glyph always
   look balanced at any photo resolution. A small **per-kind multiplier** draws the
   foot a touch larger than the hand, which reads smaller at a given span.

5. **Contrast halo.** The white ring and white glyph each carry a thin **dark outline**
   so the marks read on light granite or chalky holds as well as on dark rock.

6. **Layout fixed up front; gentle inter-ring nudge.** Ring centres and every badge
   slot are solved against all in-bounds Holds before drawing, so nothing jumps as
   later Holds reveal. Where two _separate_ rings sit close, a colliding badge is
   nudged a little along its own arc (**capped at ±π/2, never stepped radially
   outward**); a small overlap is tolerated over a far-flung badge.

7. **Progressive reveal.** A ring appears when its **earliest member's**
   `firstUseTime ≤ t`; each badge pops in at its own `firstUseTime`, so the numbers
   still narrate the sequence as playback advances.

## Considered options (the non-obvious choices)

1. **Merge coincident Holds in detection instead of at draw time — rejected.** It would
   change the `Hold` type, `StoredHold` persistence, numbering, and ADR 0008's
   "never merge sides" rule, all to fix a purely visual artifact. Draw-time clustering
   leaves each Hold its own number, glyph, and reveal time while still showing one ring.

2. **Number in its own off-glyph badge (ADR 0010's direction) — rejected.** It split
   attention between the glyph and a separate chip and re-introduced placement/leader
   problems. Centring the digit on the palm/ball keeps the mark a single compact unit.
   ADR 0010 had earlier rejected on-glyph numbers as "distracting," but that was with a
   full-size glyph and a haloed digit fighting the wall hold; a **smaller** glyph with
   a contained dark digit and the ring framing the rock resolves that tension.

3. **Even distribution around the full ring — rejected** in favour of side-anchored
   arcs. Side anchoring matches the mirrored glyph (a left hand reads on the left) and
   keeps the common two-hands case as one-left/one-right.

4. **Keep the slide-then-radial deconfliction — rejected.** Its radial blow-out is
   exactly what flung badges "off to the side." Clustering removes the intra-hold case
   entirely, and a capped arc-only nudge handles the rare close-but-separate rings.

## Consequences

- **`drawHolds` stays the single renderer.** It still runs only inside `FramePlayer`,
  so the look applies identically to the Detection Preview, the saved-Run Route
  Overlay, and both Compare slots. The annotated WebM remains pose-only (ADR 0007).
- **No new style-panel controls.** The Overlay panel keeps the Holds visibility toggle.
- **`HOLD_BADGE` is retained** for the scan-stage Holds editor list chip, even though
  the overlay no longer draws a number disc.
- **The dangling "ADR 0011" reference** in the code comments (the badge-deconfliction
  rule) now resolves to this ADR.
- **Glyph artwork is unchanged** — the hand/foot SVG paths and the `HoldGlyphIcon`
  legend/editor icon are reused; only sizing, anchoring, and the on-glyph number move.
- **No glossary change.** CONTEXT.md still describes Holds as "numbered markers placed
  where the Climber's hands and feet used a hold," which stays accurate.
