# Silhouette overlay rendering model

The pose overlay is drawn as two passes — a translucent **Silhouette** (a unioned
body shape: limb/neck/foot capsules, filled torso quad, filled head oval, mitten
hand caps) beneath a crisp **Skeleton** (thin lines + joint points). Two
non-obvious implementation choices are deliberate and should not be "simplified"
away:

1. **The Silhouette is flattened through an offscreen scratch canvas, not drawn
   shape-by-shape at reduced alpha.** Every piece is drawn at full opacity onto a
   reused module-level scratch canvas, then composited onto the target once at the
   opacity slider's value. Drawing the pieces directly at ~50% alpha was rejected
   because every deliberate overlap (shoulder, hip, neck, ankle) would composite
   darker, producing a body with dark seams instead of one uniform translucent
   shape. A single `Path2D` with nonzero winding was also rejected: limbs are
   round-capped strokes, which cannot be unioned into one fill without
   hand-building capsule polygon geometry.

2. **All sizes are multipliers of a per-frame body scale (shoulder width), not
   absolute pixels.** `drawSkeleton` renders at the Route Photo's native
   resolution, so a fixed-pixel thickness looks like a fat body on a phone photo
   and a thread on a DSLR photo. Expressing limb/joint/line sizes as
   `× body scale` keeps the silhouette looking identical across any resolution or
   zoom. The scale is a **single sequence-stable constant** — the median
   per-frame shoulder/torso measure across the whole clip (`computeStableBodyScale`,
   with a shoulder→hip→canvas fallback chain) — so limb widths stay fixed and do
   **not** pulse as the climber moves; only the climber-to-frame ratio sets the
   width. Each rendered layer computes its own constant (callers inject it via
   `SkeletonStyle.bodyScale`), so compare layers never bleed scale into each
   other. The cost is precomputing the scale per sequence and abstract (unitless)
   panel sliders instead of a px readout.

## Consequences

- Confidence dimming (**Estimated Landmark**) applies to the Skeleton pass only;
  the Silhouette is always solid so it never tears into translucent holes.
  **Interpolated Landmarks** are never dimmed.
- The fix lives in the single framework-agnostic `drawSkeleton`, so all three
  render paths (FramePlayer live playback + the two MediaRecorder video
  renderers) inherit it.
- The earlier per-side / per-group line-and-joint style controls were dropped in
  favour of three global rows (Silhouette / Lines / Joints); see CONTEXT.md.

## Update (2026-06-08) — Silhouette is a fat skeleton, not a filled avatar

The original Silhouette construction (per-limb capsules + a filled torso quad + a
head oval + **mitten hand caps** + a single ankle→foot*index foot capsule) was
replaced. Hands read as a featureless ball sitting \_on* the wrist, the foot was a
directionless heel-less stub, and the head's ear-span sizing ballooned in profile
and floated above where the neck stopped. The fixes drift toward one model, so we
adopted it wholesale:

**The Silhouette is the skeleton drawn fat.** Every landmark bone is stroked as a
round-capped capsule, all unioned and flattened through the scratch canvas exactly
as before, then composited once at the opacity slider. Only two body parts are
_areas_ rather than bones, and they stay filled primitives built from their corner
landmarks:

- **Torso** — the shoulders→hips quad is filled **and** its perimeter stroked at
  the base limb width, so the torso side edges meet the leg capsules at the hips
  (and the top edge meets the arms at the shoulders) with no width step.
- **Head** — a body-scale-sized oval (width ≈ a fixed fraction of shoulder width,
  height ≈ 1.3× that), **not** sized from the ear span (which is huge in profile,
  tiny/occluded head-on). Anchored on the face (eyes→nose) so it follows the
  climber's gaze; tilted to the eye line with a spine-up fallback. The neck capsule
  runs from the shoulder-midpoint to the oval's **bottom edge**, so the head can
  never visually detach — this replaces the old artificial `HEAD_LIFT`.

Width classes are a single base `W` (= `limbThickness` × body scale) for the torso
stroke, arms, legs, and neck — so every shoulder/hip/elbow/knee joint lines up with
zero step — and `0.5·W` for the hand and foot edges (anatomically thinner, and the
half-width strokes still union into a solid hand/foot).

**Hands and feet are drawn over their real landmark edges**, the same `capsule()`
stroke the limbs use, just at `0.5·W`:

- Hand: `wrist→index`, `wrist→pinky`, `wrist→thumb`, `index→pinky` — a fan that
  unions into a hand pointing the real way.
- Foot: `ankle→heel`, `ankle→foot_index`, `heel→foot_index` — a rounded triangle
  with a real heel and real toe.

This is deliberate even though `index`/`pinky`/`thumb`/`heel` are **not** gated by
`filterLandmarks` (only `wrist`/`shoulder`/`hip`/`ankle`/`foot_index` are). Drawing
_derived_ hands/feet from the stable proximal joints was considered and rejected:
it loses real orientation, needs special-case geometry and a confidence/plausibility
fallback gate, and is inconsistent with the limb logic. Because the Skeleton pass
already renders these same raw landmarks as thin lines, the fat strokes only thicken
what is already shown — they introduce no landmark the overlay did not already
trust. A missing endpoint simply skips its edge. If a wildly mislocated finger/heel
ever spikes the Silhouette in practice, the cheap guard is to skip an extremity edge
whose length exceeds a plausible multiple of body scale; it is intentionally **not**
added pre-emptively.

The two enduring decisions above (scratch-canvas flatten; sequence-stable body-scale
sizing) are unchanged and carry over verbatim.

## Update (2026-06-08) — Depth-shaded silhouette

The Silhouette was flat-coloured: every part painted in one `silhouetteColor` at full
alpha on the scratch canvas, flattened, composited once at the opacity slider. It read
as a uniform translucent blob. This update gives it **depth shading** (darker edges,
lighter cores) and revises the head/neck proportions, **without** disturbing the two
enduring decisions — the result is still flattened through the scratch canvas and
composited exactly once at `silhouetteOpacity`, and every size is still a multiple of
the sequence-stable body scale. The shading is built entirely _inside_ that single
scratch pass.

### Shading is a unified inner-rim, not per-part gradients

The literal request was four per-part gradients (each limb a cross-section linear
gradient; the torso perimeter its own linear; torso fill and head as radials). That was
**rejected**: clipping per-part gradients to the union mask only stops them leaking
_outside_ the body — it does not stop one limb's dark edge from overwriting an adjacent
limb's light centre _inside_ the union, so every elbow/knee/wrist still seams. Those
internal streaks are precisely the noise the effect must avoid.

Instead the "dark edges, light centre" is derived from the **union's own boundary** as a
single continuous inner rim that fades inward to a lighter interior. For a straight limb
that rim runs down both long edges — which _is_ the requested cross-section — and because
it is a property of the whole silhouette, adjacent limbs share it and joints stay
continuous with zero internal seams. Only the torso fill and the head are literal
(radial) gradients, layered on top inside the mask.

ADR-0005 already records that the Silhouette **cannot** be reduced to one `Path2D`
outline (round-capped strokes will not union without hand-built polygon geometry), so
there is no boundary path to stroke inward from. The rim is therefore produced by
**eroding** the union:

1. Draw the **full union** (all capsules + torso quad + head oval) in the **dark** shade
   at full alpha → crisp outer edge, dark base, and the mask.
2. With `source-atop` + a blur, redraw the **eroded** union (capsules at reduced width,
   torso quad inset, head oval smaller) in the **light** shade. The blur feathers the
   dark→light transition into a smooth gradient. `source-atop` keeps the light strictly
   within the mask, so the outer edge stays crisp from pass 1.
3. **Torso radial fill** on top: a narrow vertical oval highlight (light centre) fading
   to a darker torso-edge shade — lighter than the rim dark, but _darker_ than the limb
   light-centres, per the brief.
4. **Head radial** on top, drawn **last** (topmost): light centre → dark edges.
5. Composite the scratch canvas onto the target once at `silhouetteOpacity`, as before.

A **nested-erosion** alternative (redraw the union ~6–8× at shrinking size, interpolating
dark→light per band) was considered and rejected as the default: it is deterministic and
blur-free but costs many more draw passes per frame across all three render paths for a
result the single dark-fill + blurred-light-core pass achieves more cheaply.

### Shades are derived, not authored

The panel exposes a single live `silhouetteColor` picker. Rather than expand the API and
the 3-row panel with explicit dark/light pickers, both rim ends are **derived** from
`silhouetteColor` by fixed HSL lightness shifts (dark = −, light = +). The gradients track
whatever hue the user picks, with no extra controls. Strength (lightness deltas, rim
width, blur radius) is a set of **hardcoded subtle constants** tuned once in code — no
"depth" slider — to honour the "subtle, illusion of depth, not too much noise" intent and
keep the panel surface unchanged.

### Depth order: torso and head strictly on top

The torso radial and head radial are painted **after** all limbs (head last). A limb
crossing in front of the torso therefore has its _fill_ occluded by the torso — the arm
is conveyed by its thin **Skeleton**-pass line + joints, which always draw on top of the
composited Silhouette and stay crisp. A "subtle overlap rim" and a "limb fill over torso"
variant were both considered; the strict single-union occlusion was chosen for the
cleanest, fully seam-free render, with skeleton-line legibility as the safety net.

### Proportions

- **Head** enlarged: half-width `0.30 → 0.35` (full width `0.70×` shoulder), height ratio
  `1.30 → 1.20` (full height `0.84×`) — bigger and rounder, sized against the fat limbs
  rather than strict anthropometry (a "correct" head is ≈ `0.5×` shoulder wide, but reads
  small next to the `~0.7×`-diameter limbs).
- **Neck** widened: radius `limbR → 1.25×limbR`. The over-stretch (the neck elongating on
  big head tilts because the head oval is eye-anchored) is fixed by **clamping the
  head-centre distance** from the shoulder-midpoint to `~0.85×` shoulder width and pulling
  the head in along the neck axis past that — this shortens the neck while keeping the
  chin-bridge attachment intact. Clamping the neck capsule length alone was rejected
  because it would detach the head from its eye anchor.
- **Hands and feet** thickened: `EXTREMITY_WIDTH_FACTOR 0.5 → 0.75`, so extremity edges
  are three-quarters of the limb width (they read too small at half).

### Depth-shading consequences

- The inner rim width is taken as a fraction of **each part's own** radius (not a global
  pixel band), so thin hands/feet keep a light core instead of eroding to fully dark.
- `ctx.filter` blur is the primary feathering mechanism; where it is unavailable the pass
  falls back to `shadowBlur`.
- One extra eroded+blurred pass plus two radial fills per frame, on the scratch canvas,
  across all three render paths (FramePlayer + the two MediaRecorder renderers). Still a
  single composite at the opacity slider.
- CONTEXT.md is unchanged: depth shading introduces no new domain term and does not alter
  the meaning of **Silhouette** (still a unioned body shape that reads as a solid avatar).
