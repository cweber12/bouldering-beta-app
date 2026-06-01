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
pose model variant and detection effort. (Planned — see ADR backlog.)
_Avoid_: mode, level, model setting.

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
