# Colour-coded ring hold overlay

Supersedes the *marker look* of [ADR 0011](0011-clustered-ring-hold-overlay.md)
(which superseded 0010, which superseded 0007). The **Hold** inference algorithm,
the selectivity gates, persistence, the cluster-by-proximity idea, and the
progressive reveal are all unchanged — this ADR only changes how Holds are *drawn*
in `pipeline/holdsOverlay.ts` and how kind is shown in the legend and editor.

## Context

ADR 0011 drew each cluster as a transparent ring with **numbered hand/foot
silhouette badges** hanging off its arc, the number painted on the palm/ball of the
glyph. Across eight render iterations the marker never settled. The problems were
structural, not parameters left untuned:

- A literal silhouette has no flat region for a digit, forcing per-kind
  `SOLID_WIDTH_FRAC`, per-side `GLYPH_CENTROID`, auto-shrink and a halo just to keep
  the *most important* element — the number — legible.
- The hand (512-viewBox anatomical) and foot (32-viewBox footprint with toe-beans)
  share no visual language and turn to mush at the ~45 px the overlay draws on
  textured rock.
- Side-by-mirroring is imperceptible at that size — a paid-for bit conveying nothing.
- ADR 0010 had already *rejected* on-glyph numbers as "distracting… fought the wall
  hold for the same pixels"; ADR 0011 reintroduced them. That tension was never
  actually resolved.

The deeper issue: one mark carried four things — location, order, kind, side. The
**Skeleton** overlay already conveys progression for anyone who wants it, and the
numbers were too small to read regardless, so the marker need not carry order at all.

## Decision

Reduce each Hold marker to the one thing it must say — **hand or foot, and where** —
and carry it on the channel that reads fastest while keeping the rock visible:
**colour on a clear-interior ring.**

1. **One thin colour-coded ring per spot, interior clear.** **Blue = Hand Hold,
   orange = Foot Hold** — a blue/orange pair is colour-blind-safe and sits clear of
   the green pose overlay (`#b3e609`), so a hold ring never blends into the skeleton.
   The interior stays clear so the wall hold shows through; a thin dark halo lets the
   ring read on light or dark rock.

2. **No number, no glyph, no side on the wall.** `order` and `side` stay in the data
   model (ADR 0008's never-merge-sides rule is untouched); they are simply not
   painted. The number is gone entirely — its job (sequence) is served by the reveal
   timing and the Skeleton.

3. **Cluster by proximity *and kind*; concentric for both kinds.** Coincident
   same-kind Holds (two hands matching, a re-grip) collapse to one ring of that
   colour. A spot used by both a hand and a foot draws **two concentric rings**
   (blue + orange) centred on the spot — no badge fan, no radial nudge.

4. **Progressive reveal kept.** A ring still appears at its earliest member's
   `firstUseTime`, and **Reset** replays it. With numbers gone, *appearance timing* is
   the sequence cue: a ring shows as the limb lands.

5. **Colour = kind everywhere.** The legend and the Holds editor switch to
   blue/orange swatches/dots (the editor's add-buttons keep their L/R text labels for
   side). The hand/foot SVG apparatus — `HoldGlyphIcon`, `HOLD_GLYPH_PATH` /
   `HOLD_GLYPH_VIEWBOX`, `HAND_PATH` / `FOOT_PATH`, `drawGlyph`, the `Path2D` cache —
   is deleted.

## Considered options (the non-obvious choices)

1. **Salvage the silhouettes (tune sizing/placement) — rejected.** Eight rounds of
   tuning hadn't converged; the problem is structural (a silhouette is the wrong
   vehicle for kind at 45 px and steals the number's home), not a parameter.

2. **Keep numbers, strip everything else (numbered rings) — rejected.** The numbers
   were too small to read on the wall and the Skeleton already narrates progression,
   so the number earns nothing for the clutter and legibility cost it carries.
   Sequence moves to reveal timing (passive) and a future step-through (manual).

3. **Reintroduce colour, reversing ADR 0011's shape-only choice — accepted
   deliberately.** 0011 went single-colour-shape to avoid a colour legend and keep one
   look; but shape does not read at overlay scale, and colour is the fastest
   preattentive channel for a binary. A clear-interior *colour* ring keeps the rock
   visible *and* says kind instantly — better on both axes than a shape that is
   illegible.

4. **Drop side from the wall — accepted.** Mirroring conveyed nothing at size;
   dropping it halves the render states (2, not 4) and lets same-kind coincident Holds
   collapse to one clean ring. Side stays in the editor, where text labels make it
   legible and it drives which limb a new Hold snaps to.

5. **Concentric rings over a nudged pair or a split two-tone ring — accepted.**
   Concentric keeps the mark exactly on the hold (no position fudge — the thing 0011's
   nudge was criticised for) and keeps the innermost interior clear; a split ring is
   busier and its division arbitrary.

6. **Step-through "next hold" deferred — accepted.** It needs playback control, a
   current-hold highlight, and its own UX pass (does it work on the Detection Preview?
   does it pulse the matching skeleton limb?); it should not gate the visual cleanup,
   which is fully testable on its own.

## Consequences

- **`drawHolds` stays the single renderer** inside `FramePlayer`, so the look applies
  identically to the Detection Preview, the saved-Run Route Overlay, and both Compare
  slots. The annotated WebM remains pose-only.
- **Large net deletion** in `holdsOverlay.ts`: the glyph paths, `drawGlyph`, the badge
  layout / fan / inter-ring nudge, the digit auto-fit, and the per-side
  centroid/solid-width tables all go. Clustering stays but now splits by kind.
- **New palette tokens.** `--color-hand-hold` (blue) / `--color-foot-hold` (orange)
  return to `globals.css`, with matching `utils/theme.ts` `dark`/`light` canvas
  values; the single `holdGlyph` token is removed. They must stay clear of the green
  pose overlay.
- **The editor keeps a sequence index, re-themed:** the Holds editor is a
  management list where the first-use index still helps, so each row keeps a small
  number chip — but it moves to semantic tokens (`bg-inset` / `text-fg-secondary`),
  and the raw `HOLD_BADGE` constant (a white-on-white relic) is deleted along with
  the glyph apparatus. Kind shows as a small colour ring matching the wall.
- **Glossary updated.** CONTEXT.md's **Holds** and **Hold** entries no longer call the
  markers "numbered" / "labelled with its rank" — the rank persists as data that
  orders the reveal and the editor list, not as a wall label.
- **Step-through "next hold" is a tracked follow-up**, not part of this ADR.
