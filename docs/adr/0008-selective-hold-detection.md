# Selective hold detection: gap-tolerant dwells, weighted-foot gate, split-disc co-render

Refines [ADR 0007](0007-hold-detection-overlay.md). The original Holds pass produced
**too many Holds in the same place**: a limb that lifted off and came straight back
made a second marker, a tucked or swinging leg passed the load-bearing gate, and a
hand and a foot used on the same wall hold drew two stacked discs. This ADR records
the changes that make detection more selective without changing the **Hold** /
**Dwell** language (see CONTEXT.md — both terms keep their meaning) and without
persisting anything new (still derived on the fly per ADR 0007 option 2).

## Considered options (the non-obvious choices)

1. **Gap-tolerant Dwell, not post-hoc location merge alone.** A brief lift-off (a
   re-grip, a chalk-up, a foot reset) used to break the stationary run into two
   Dwells; if the limb returned even slightly off the original spot it cleared the
   same-kind merge radius and became a second Hold. A Dwell now **survives a brief
   excursion**: the contact point may leave the stationary radius for up to a short
   gap (~0.4 s) and is re-admitted if it returns within the radius of the *same
   anchor*. Excursion frames are excluded from the averaged Hold position, but their
   elapsed time still counts toward the Dwell duration, so a *long* lift-off naturally
   fails the confidence guard rather than being silently bridged. Relying only on a
   wider merge radius was rejected: it cannot tell a genuine re-grip from a distinct
   adjacent hold, and a too-wide radius swallows real neighbours. The same-kind merge
   radius is still nudged up (~0.25 → ~0.35 × body scale) as a backstop for a return
   that lands just outside the anchor.

2. **Weighted-foot gate split by geometry: side support vs underneath.** ADR 0007
   option 4 gated a Foot Hold on knee-straighten **OR** "braced" (knee bent past a
   straight dangle, **OR** ankle offset from the hip plumb). The braced *bent-knee*
   clause leaked: a leg **tucked up** under the body also has a bent knee, so it
   registered a false Foot Hold. The gate is now three independent signals that
   mirror how a foot actually bears load:
   - **(A) Side support** — the ankle is offset from the hip plumb line. A leg shot
     out from under the torso and held still is resting on a hold *even when the knee
     barely bends*, so horizontal offset qualifies on its own. (An earlier revision
     of this ADR required a vertical hip→knee→ankle stack; that was wrong — it
     rejected exactly this side-extended foot, whose leg is roughly horizontal.)
   - **(B) Stand-up underneath** — the interior hip–knee–ankle angle increases across
     the dwell (the Climber pushes up on a foot under the body).
   - **(C) Braced underneath** — a bent knee *with the foot planted below the knee*.
     The below-knee test (ankle clearly lower than the knee) is what separates a
     braced foothold from a tucked, dangling leg whose foot is drawn up level with or
     above the knee — closing the leak without touching the side-support and stand-up
     cases.

   A straight, static leg under the body matches none of the three (no stand-up, no
   offset, no bend) and is correctly read as hanging. A per-frame posture classifier
   was rejected as overkill for tunable geometric rules built from joints we already
   project.

3. **A soft "never reject both hands at once" support rule, not a hard invariant.**
   The domain truth is that a Climber is always supported by at least one limb, and at
   most three (both feet + one hand) dangle at a time — so **both hands are never
   simultaneously dangling**. Rather than enforce this per frame (which would
   manufacture a Hold during a genuine dyno/flight moment), the dangle rejection is
   allowed to drop up to three limbs but **never both hand contacts in the same
   window** — if the gates would reject both, the stronger one is kept. This guards
   against erasing a real hang without inventing holds in mid-air. A hard per-frame
   invariant was rejected for that failure mode; treating the rule as mere rationale
   (no code) was rejected because the per-limb gates alone can reject both hands during
   a noisy hang.

4. **A hand+foot on one spot is co-rendered as a split disc — render-only, still two
   Holds in data.** This is the direct reversal of how ADR 0007 option 5 *presented*
   the case (it kept them two discs), but **not** of the data model: a Hand Hold and a
   Foot Hold on the same spot are still two Holds, each with its own kind, `order`, and
   `firstUseTime` (CONTEXT.md's **Hold** definition stays literally true). When their
   centres fall within the merge-radius factor (the same "same place" notion detection
   uses, mirrored as a render constant in `holdsOverlay.ts`), they are **drawn as one
   disc at their midpoint**: top half hand colour, bottom half foot colour, each
   original number tethered to its own half by a leader line. A new dual-kind `Hold`
   in the data model was rejected — it would churn the type, the glossary, and the
   numbering for a purely visual grouping. Same-kind Dwells already merge in data, so a
   split disc is always exactly a two-way hand/foot split, never three-way.

5. **Independent half reveal.** The two halves of a split disc usually have different
   `firstUseTime`s (grab the hold, then foot it later). Each half reveals at its own
   first-use time: a single-kind disc with one number until the second limb lands, then
   it splits live and gains the second number. Revealing the whole disc at the earlier
   time was rejected (it implies a foot-hold before the foot arrives); revealing only
   once both are used was rejected (it regresses ADR 0007's "pops in when the limb first
   lands" behaviour by hiding the first marker for the whole interval between uses).

## Consequences

- **No schema or glossary change.** Detection stays a pure `detectHolds(frames)` derived
  on the fly (ADR 0007 option 2). The **Hold**, **Hand Hold**, **Foot Hold**, and
  **Dwell** definitions in CONTEXT.md are unchanged — gap tolerance and the stack gate
  are implementation of *how* a Dwell is detected, not what the words mean.
- **More tunables, same Balanced philosophy.** New constants (excursion gap seconds,
  the downward-stack margins) join the existing block at the top of
  `pipeline/holdDetection.ts`; the render combine factor lives in `pipeline/holdsOverlay.ts`
  and is documented to stay in sync with detection's merge-radius factor.
- **The split disc is overlay-only.** Like the rest of the Holds pass it is a **Route
  Overlay** feature; the auto-rendered annotated WebM stays pose-only (ADR 0007).
- **Selectivity over recall.** These gates deliberately reject ambiguous contacts
  (tucked legs, brief touches, mid-flight limbs). A genuinely quick foot placement at
  the 0.5 s boundary may still be missed; the dwell time was kept at 0.5 s rather than
  raised so this trade stays mild.
