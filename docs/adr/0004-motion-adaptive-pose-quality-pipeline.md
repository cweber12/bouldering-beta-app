# Motion-adaptive pose-quality pipeline

## Status

accepted

## Context

The **Scan** processing pass detects the **Climber**'s pose on every N-th sampled
video frame (uniform `frameStep`), then filters, interpolates, and smooths the
result into the overlay ([useVideoProcessor.ts], [poseInterpolator.ts]). All
overlay quality is decided here — Match and overlay-render are downstream and
cheap. Four recurring quality complaints trace back to this pass:

- **Landmark Flips** — MediaPipe mislabels the Climber's left/right sides for a
  few frames, then recovers ("shoulders/hips reverse then flip back"). The
  One-Euro smoother filters each keypoint _by name independently_, so it cannot
  even see a flip as a flip — it sees two unrelated jumps and smooths each,
  which is why the overlay pops and settles.
- **Missing landmarks / connectors** — three gates erase joints: the
  `minScore` visibility cut, `interpolateKeypoints` keeping only joints present
  in _both_ anchors, and edges drawing only when both endpoints exist.
- **Jittery vs robotic overlay** — a single uniform `frameStep` couples two
  unrelated problems: per-detection _noise_ (jitter) and _under-sampling_ of
  fast motion (robotic lerping). Tuning the one knob trades one for the other.
- **Lighting** — backlit, low-light, harsh-shadow, and white-balance Runs all
  produce low-confidence detections.

The user can spend more Scan time for a cleaner overlay (it is a one-time batch
with a progress bar), gated behind the existing **Quality Tier** preset +
advanced panel ([poseTiers.ts], already wired through [app/scan/page.tsx] and
[StepSetDetection.tsx]). Match/overlay-render latency is already near-instant and
is not the budget being protected.

## Decision

Restructure the Scan pass into a motion-adaptive, quality-targeted pipeline.
Free correctness fixes are always-on across every tier; expensive density is
tier/advanced-gated.

New pass order:

1. **Detect** at the tier's uniform `frameStep`.
2. **Flip detection (stateful walk forward).** Walk detected frames in order,
   comparing each to the previous _accepted_ frame. A **Landmark Flip** is a
   fast, discontinuous sign-change in shoulder/hip separation where each labelled
   torso joint _teleports_ (the swapped assignment would have low displacement) —
   as opposed to a genuine rotation, where each labelled joint moves smoothly and
   the no-swap assignment stays low-cost. Detection sensitivity scales with
   `frameStep` (sparser sampling → looser threshold). Flipped frames are
   **discarded, not relabelled** — real flips are frequently asymmetric, so a
   clean left↔right swap would produce a wrong pose.
3. **Adaptive Refinement (unified).** A second pass densely re-samples
   _frame-by-frame, no stride skip_ only the segments that need it: high
   inter-anchor motion (fast moves) **or** frames discarded in step 2. Each
   candidate must pass the same flip + confidence gate; the walk stops at the
   first clean pose or a per-segment budget cap (`maxRecoveryFrames`). Static
   segments stay sparsely sampled. This generalizes the existing gap-recovery
   pass into one mechanism for both triggers.
4. **Filter → Interpolate (relaxed).** Drop the strict "present in both anchors"
   rule so a joint that is strong in one anchor survives, keeping connectors from
   flickering. Catmull-Rom interpolation is retained for C1-continuous motion.
5. **Estimate missing landmarks** at reduced confidence (existing
   `estimateMissingLandmarks`).
6. **Zero-phase smoothing.** Replace the forward-only One-Euro pass with a
   forward+backward pass. Removes phase lag entirely (valid because the Scan is
   offline/batch), so density can rise without jitter returning. Always-on.

Render: an **Estimated Landmark** is dimmed only when its confidence is low /
the gap was too large to estimate reliably; confidently-bridged joints render
at full strength.

Lighting is **deferred**: lean on the heavy-model Accurate tier + Adaptive
Refinement (more detection attempts per degraded spot) first, then re-evaluate a
dedicated CLAHE-on-adaptive-crop preprocessing pass against measured detection
confidence before building it.

New tier/advanced knobs (refinement budget, motion threshold, flip sensitivity)
extend `TierConfig`; the always-on fixes (flip detection, relaxed fill, zero-phase
smoothing) are not gated.

## Considered options

1. **Discard-and-refine flips + unified Adaptive Refinement** (chosen) — keeps
   only clean detections, spends extra Scan time exactly where motion is fast or
   data is missing, and treats flip-recovery and dyno-capture as one mechanism.
   Highest quality-per-millisecond; most to build.
2. **Relabel (left↔right swap) flipped frames** — rejected: keeps the motion
   sample for free, but real flips are often asymmetric/partial, so a clean swap
   yields an anatomically wrong pose. Discarding + re-detecting the next frames
   is more robust.
3. **Uniform dense stride + zero-phase smoothing only** — simpler and
   predictable, but to capture one fast move it must lower the _global_ stride,
   slowing the entire Scan for a local problem, and still needs a recovery loop
   bolted on for flips (which is Option 1's machinery anyway).
4. **Per-keypoint flip handling** — decide/swap each pair independently;
   rejected: produces anatomically impossible poses (swapped shoulders, unswapped
   hips).
5. **Per-lighting-mode preprocessing handlers** — rejected for now: highest
   complexity and a real risk of _degrading_ a model trained on natural images;
   not justified without eval data.

## Consequences

- **Scan time becomes data-dependent.** A Run full of fast dynamic moves triggers
  more refinement (more seeks — the expensive part) than a slow, static one. Hard
  caps (`maxRecoveryFrames`, per-segment budget) bound the worst case; the Quality
  Tier sets the budget.
- **The pass order is now load-bearing.** Flip detection must run on the sparse
  detected frames _before_ interpolation — interpolating across an uncorrected
  flip is what creates garbage in-between poses. This coupling is the main reason
  the decision is hard to reverse.
- **Flip detection is sampling-coupled.** At Fast tier (large `frameStep`) a
  genuinely fast rotation can complete inside one gap and _look_ like a flip; the
  frameStep-scaled threshold trades a small false-positive risk for safety.
  Denser tiers are strictly more reliable.
- **Relaxed fill + estimation can show inferred motion.** The overlay favours
  completeness over honesty; the confidence-driven dimming is the only signal
  that a joint was estimated rather than seen.
- **Lighting remains partially unsolved** until the deferred CLAHE work is
  measured — accepted in exchange for not shipping preprocessing that might make
  detection worse.
