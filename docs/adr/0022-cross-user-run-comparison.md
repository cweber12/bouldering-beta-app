# 0022 — Cross-user Run comparison over any authenticated user's pose data

Date: 2026-07-21
Status: accepted

## Context

The `/route/{userId}/{state}/{area}/{route}` console already overlays 2–4 of a
User's **own** Runs of one Route on a shared **Route Photo**. ADR 0002 kept it
**own-user-only**: every Run and Route Photo loads through `/api/s3/get`, which
`isValidKey` scopes to the authenticated caller, and cross-user viewing was
explicitly deferred.

Users want to compare their beta against another climber's — "me vs my friend on
the same problem." That is the whole of this increment. It requires one User's
browser to read **another** User's pose data (`{id}-{runType}.data.json`:
`frames[]`, ORB features, per-frame matches), which no endpoint exposed: the only
cross-user reads (`/api/profile/{userId}/climbs/detail`) serve **metadata only**.

Two forces shaped the decision:

1. **Consistency with today's exposure.** Profiles and per-climb
   metadata/thumbnails are already readable by **any authenticated user** via
   `isValidRoutePrefix` — there is no privacy flag and no follow-gate on that
   data. Pose `frames[]` are derived skeleton data, no more sensitive than the
   thumbnail already served.
2. **Alignment is not guaranteed.** The overlay projects each Run onto one photo
   via ORB + homography. Two people's videos of the same boulder are often shot
   from different viewpoints, so a single photo may not align both Runs — a real
   failure mode, not an edge case.

## Decision

**Cross-user comparison is enabled, and any authenticated user may read another
user's Run pose data for it.** This supersedes ADR 0002's deferral.

- **New prefix-gated endpoint** `GET /api/profile/[userId]/climbs/attempt?key=`
  returns a full merged RouteData object (metadata + the `.data.json` heavy
  sibling), gated by `isValidRoutePrefix` exactly like the sibling climbs routes.
  It also serves `route-image.json` (no sibling → returned as-is) so a guest
  owner's Route Photo can anchor the homography.
- **Entry is "bring mine to theirs."** From another user's Run in
  `ClimbDetailModal`, the User picks one of their own Runs; the console is hosted
  on the User's **own** route (`/route/{myId}/…`) with the other Run added as a
  **guest slot** loaded through the new endpoint. The User asserts "same Route" —
  no global Route identity is introduced.
- **The anchor photo is selectable** between the host's photo and each guest
  owner's photo, so the overlay can try whichever photo aligns both Runs.
- **When no photo aligns every Run, the view falls back to side-by-side** (which
  needs no shared photo) with a surfaced notice — a missing skeleton is never
  silent.
- **Permission is "any authenticated user."** No per-Run or per-profile privacy
  model is added; that stays a separable future feature.

## Consequences

- One User's derived pose data is now readable by any other authenticated User.
  This is a deliberate widening of the data boundary, consistent with the already
  world-readable profile climb metadata, but it is **hard to reverse** once
  cross-user compare links circulate.
- The compare URL is inherently shareable: it carries mixed-owner keys in the
  `keys` CSV, and any authenticated user can open it and read both Runs — a
  near-free consequence of the existing URL-mirroring, not extra infrastructure.
- Alternatives rejected: **follow-gating** the pose reads (inconsistent — the same
  Runs are already visible on the profile with no such gate) and **owner opt-in**
  (needs a whole privacy model that does not exist; default-private would break
  existing public profiles). Both are still available later as a hardening layer.
- ADR 0002's premise (the `{userId}` segment is always the session user) no longer
  holds for a hosted comparison's guest slot; the host segment remains the session
  user, and guest Runs ride in `keys` with their own owner in the path.
