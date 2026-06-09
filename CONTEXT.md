# Bouldering Beta — Context

Domain glossary for the climbing-video analysis app: capturing a climb, tracking
the climber through the pose pipeline, and matching the climb to a route photo.

## Language

### Capture & subjects

**Climber**:
The single person whose movement a scan is meant to analyse — the subject the
pose pipeline tracks across the whole video.
_Avoid_: subject, person, user (the **User** is the app's account holder).

**Bystander**:
Any other person who appears in the video and is not the **Climber** (a spotter,
a passerby). Detection must never switch the track onto a Bystander.
_Avoid_: other person, intruder.

**Climber Identity**:
The persistent notion of "which detected pose is the **Climber**" maintained
across frames, so a **Bystander** entering the shot is rejected rather than
followed. Seeded once per scan (by a tap, or the strongest pose).
_Avoid_: tracking ID, person ID.

### Detection region

**Adaptive Crop**:
The detection region for a frame, derived automatically from the **Climber**'s
landmarks in the previous frame so it stays tight as they move and change scale.
Replaces a fixed, manually-sized box.
_Avoid_: bounding box, ROI, the (manual) "crop box".

**Manual Crop**:
A user-drawn box used as an override/seed when tap-to-track is not used. The
Climber crop and the **Wall Crop** are the two Manual Crops.
_Avoid_: selection, region.

**Wall Crop**:
A region of stable wall texture (excluding the Climber) used to extract ORB
features for route-photo matching.
_Avoid_: background crop.

**Quality Tier**:
A user-facing speed/accuracy preset (Fast / Balanced / Accurate) that selects the
pose model variant and detection effort (model variant, sampling density, and
**Adaptive Refinement** budget). An advanced panel may override individual knobs
after a tier is picked. Trades a slower **Scan** for a cleaner overlay.
_Avoid_: mode, level, model setting.

### Detection quality

**Landmark Flip**:
A frame in which the pose model mislabels the **Climber**'s left/right sides
(e.g. `left_shoulder` jumps to the right side of the body) without the body
actually having rotated — a detection glitch, _not_ a real movement. Detected by
a fast, discontinuous sign-change in shoulder/hip separation; distinguished from
a genuine torso rotation, which moves each labelled joint smoothly. Flipped
frames are discarded (not relabelled — flips are often asymmetric) and re-detected.
_Avoid_: rotation, twist (those are real motion), mirror.

**Adaptive Refinement**:
A second detection pass that densely re-samples only the segments that need it —
where the Climber moves fast between sampled frames, or where a frame was
discarded (e.g. a **Landmark Flip**) — stepping frame-by-frame until a clean pose
is captured or a budget cap is hit. Static segments stay sparsely sampled. Spends
**Scan** time where it changes the overlay, not uniformly.
_Avoid_: gap recovery (that is one trigger of Adaptive Refinement, not the whole thing).

**Estimated Landmark**:
A keypoint whose position was inferred (from neighbouring frames or skeletal
geometry) rather than detected, so the skeleton stays whole through brief
dropouts/occlusion. Carried at reduced confidence; rendered dimmed (in the
**Skeleton** pass only — the **Silhouette** never dims) when the gap is too large
to estimate reliably. Distinct from an **Interpolated Landmark**.
_Avoid_: predicted point, fake landmark.

**Interpolated Landmark**:
A keypoint produced by routine densification _between two confident detected
samples_ (turning sparse pose frames into dense playback frames). It inherits the
confidence of its endpoints and is **never dimmed** — interpolation is not a
source of uncertainty, unlike an **Estimated Landmark**.
_Avoid_: estimated, inferred (those imply reduced confidence).

### Capture mode

**Fixed Capture**:
A **Run** recorded with a static camera (tripod or propped). The whole **Route**
stays in frame, so a single homography aligns the Run to the **Route Photo** for
every frame. The original and default capture path.
_Avoid_: tripod mode, static mode.

**Panning Capture**:
A **Run** recorded while deliberately panning the camera along a longer **Route**
that does not fit in one frame. Aligned to the **Route Photo** per-**Keyframe**
rather than by a single homography, so the skeleton overlay tracks the wall as
the camera moves. Opt-in via a scan-setup toggle; it does not replace **Fixed
Capture**.
_Avoid_: handheld mode, moving-camera mode (it is specifically a _deliberate
pan_, not shake/jitter correction — fast handheld shake is out of scope).

**Keyframe**:
A sampled video frame in a **Panning Capture** at which **Wall Crop** features
(ORB) are extracted and stored, so each section of the pan can be matched to the
**Route Photo** independently (the photo is the one image that overlaps every
Keyframe, which keeps the alignment drift-free). In-between frames are placed by
interpolating between adjacent Keyframes.
_Avoid_: anchor frame, reference frame (the single Fixed-Capture reference frame
is not a Keyframe).

### Persistence & media

**Route**:
A single climbing problem, identified by its location `{State}/{Area}/{Route}`.
Every recording of that problem belongs to one Route.
_Avoid_: climb (the UI/code calls a Route a "climb" in places — ambiguous with a
single **Run**).

**Run**:
One recorded ascent of a **Route** — a single capture-and-analysis session,
classified by **Run Type** as a **Send** or an **Attempt**. A Route has many Runs.
_Avoid_: climb, attempt (as the generic term — an Attempt is one Run Type, not the
word for "a Run").

**Run Type**:
Whether a **Run** reached the top (**Send**) or did not (**Attempt**).
_Avoid_: result, outcome.

**Route Photo**:
The single reference photograph of the wall for a **Route**. A **Run**'s pose is
matched against it (ORB + homography) and the skeleton overlay is projected onto
it. One per Route, optional, shared by every Run of the Route.
_Avoid_: route image, background photo.

### Overlay & review

**Detection Preview**:
The skeleton played back over the **Run**'s own first video frame, in raw
video-pixel space with **no homography** applied. Its purpose is to review
detection quality (did the pose pipeline track the **Climber** cleanly) before a
**Route Photo** is involved. Shown on the review step immediately after a scan.
_Avoid_: preview, landmark preview (ambiguous with the **Route Overlay**).

**Route Overlay**:
The skeleton projected onto the **Route Photo** through the homography (ORB
match → `computeHomography`), so the climb is seen on the wall photo. Distinct
from the **Detection Preview**, which never leaves video-pixel space.
_Avoid_: preview, overlay (unqualified), projection.

**Silhouette**:
The semi-transparent body shape of the **Climber** — the skeleton drawn fat:
every bone (arms, legs, neck, hands, feet) stroked as a round-capped capsule,
plus two filled regions for the parts that are areas not bones (the **torso**
quad and a **head** oval), all unioned into one translucent form that reads as a
solid avatar and contrasts against the wall. Hand and foot strokes are thinner
(half the limb width) per anatomical proportion. The lower of the two overlay
passes.
_Avoid_: blob, halo (it is a unioned body shape, not a single fat mark).

**Skeleton**:
The thin, crisp pose lines and joint points drawn on top of (inside) the
**Silhouette** so the pose is legible within the body shape. The upper of the
two overlay passes.
_Avoid_: thin line, wireframe (the Skeleton is the lines+joints, distinct from
the **Silhouette** fill beneath it).

## Relationships

- A scan has exactly one **Climber** and zero or more **Bystanders**.
- **Climber Identity** is seeded once, then selects the Climber's pose in every
  frame; the **Adaptive Crop** is derived from that selected pose.
- A **Manual Crop** (Climber) seeds or overrides the Adaptive Crop; the **Wall
  Crop** feeds route-photo matching, not pose tracking.

## Example dialogue

> **Dev:** "If a **Bystander** walks across the **Climber**, do we lose the track?"
> **Domain expert:** "No — **Climber Identity** picks the pose nearest where the
> Climber was predicted to be, and rejects anything outside the gate. The
> Bystander is never selected, so the **Adaptive Crop** keeps following the
> Climber."

## Flagged ambiguities

- "crop" meant both the user's drawn box and the per-frame detection region —
  resolved: **Manual Crop** (user-drawn) vs **Adaptive Crop** (auto-derived).
- "user" meant both the account holder and the person climbing — resolved: the
  account holder is the **User**; the person climbing is the **Climber**.
- "climb" is used in the UI/code for both the **Route** (a problem) and a single
  **Run** (one ascent) — prefer Route / Run when precision matters.
- "attempt" is used for both a **Run** generically and the not-topped **Run Type**
  — resolved: a Run is a Run; "Attempt" is reserved for the Run Type opposite Send.
- "preview"/"overlay" meant both the skeleton over the Run's own first frame and
  the skeleton projected onto the Route Photo — resolved: **Detection Preview**
  (video-pixel, no homography) vs **Route Overlay** (projected onto the Route
  Photo). A bare "stuck on the preview" is ambiguous between the two.
