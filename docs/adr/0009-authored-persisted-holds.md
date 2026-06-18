# Authored, persisted Holds detected at scan time (Fixed Capture)

Supersedes the *persistence* and *space* choices of [ADR 0007](0007-hold-detection-overlay.md)
(options 1 and 2, and the "Holds cannot appear in the Detection Preview" consequence)
for **Fixed Capture** Runs. The inference algorithm and the selectivity gates of
[ADR 0007](0007-hold-detection-overlay.md) / [ADR 0008](0008-selective-hold-detection.md)
are unchanged — only *where* detection runs, *what space* its output lives in, and
*whether the result is editable and saved* change.

ADR 0007 deliberately derived Holds on the fly in Route Photo space and never
persisted them, naming its own revisit trigger: *"revisit only if we add
user-editable Holds."* That trigger has fired. We now want the **User** to review,
add, and remove Holds, and we want that work to survive a reload — which requires
somewhere to store the overrides. Separately, the on-the-fly path is **not** the
cause of the rendering slowdown that motivated this change (detection runs once,
memoized; the per-frame cost is the greedy label layout inside `drawHolds`), but
persisting static Holds lets that layout be computed once and cached.

## Considered options (the non-obvious choices)

1. **Detect in video-frame space at scan time, not wall space at match time —
   Fixed Capture only.** ADR 0007 option 1 measured the Dwell in wall/photo space
   because a held hand travels across the frame during a **Panning Capture** pan.
   But for **Fixed Capture** the camera is static, so a gripped hand is motionless
   in video pixels too (ADR 0007 concedes this), and all the gates are fractions of
   a body scale, so they hold equally in video-pixel space. Running detection on the
   **Detection Preview**'s own frames — *before* any **Route Photo** exists — is
   therefore valid for Fixed Capture and is the only way Holds can be authored on a
   single frame that shows the whole **Route**. Panning Capture has no such frame,
   so it keeps the on-the-fly wall-space path. Authoring Holds on the Route Photo
   instead was rejected: the photo may not exist yet at scan time, and editing
   against the climber's own body in the source frame is more direct than aiming at
   an unannotated wall photo.

2. **Persist the edited Holds with the Run; fall back to on-the-fly detection when
   absent.** New Fixed-Capture Runs save their final (auto-detected + User-edited)
   Holds to S3 alongside the pose data, in **normalized [0,1] video space** so they
   are resolution-independent and project to the Route Photo through the existing
   homography exactly as the on-the-fly path does. Runs with no saved Holds — every
   legacy Run, and every Panning Capture Run — fall back to the wall-space
   `detectHolds`/`useHolds` path unchanged. Deleting the on-the-fly path was
   rejected: it would strip Holds from all existing data and from Panning Capture.
   The two paths coexist; saved Holds win when present.

3. **Numbering is always re-derived from first-use order; there is no stored
   number.** A Hold is added by scrubbing the Detection Preview to the frame where
   the limb is on the hold and snapping to that limb — so the add-frame timestamp
   *is* the Hold's first-use/reveal time, which slots it into the sequence. The
   printed number is then just the chronological rank, recomputed on every add and
   remove. An earlier plan had the User type a number on add (with the rest
   shifting); it was rejected because the add-frame timestamp already fixes the
   Hold's place, leaving two competing orderings (typed number vs first-use time).

4. **Snap a new Hold to a limb keypoint, not a free tap.** Adding picks one of the
   four extremities; the Hold takes that limb's contact point in the current frame
   (hand = mean(index, pinky) → wrist fallback; foot = foot_index → ankle fallback,
   matching detection) and its kind from the limb. A free tap plus a hand/foot
   toggle was rejected as slower and prone to drifting off the landmark the rest of
   the pipeline reasons about.

5. **High-water-mark reveal everywhere, with a Reset.** A Hold shows once playback
   time has *ever* reached its first-use time since the last Reset, so the first
   pass reveals Holds in order and they then stay shown across loops; Reset re-arms
   the sequential reveal. This replaces ADR 0007's strict `firstUseTime ≤ t` reveal
   (which re-hid every loop) on **all** surfaces — Detection Preview, saved Route
   Overlay, and both Compare slots — since `FramePlayer` is shared. Keeping the old
   reveal off-scan and the new one on-scan was rejected as two behaviours to
   maintain for no benefit.

## Consequences

- **Schema change.** `RouteAttempt` gains an optional `holds?` field (and the S3
  JSON gains the same), each entry carrying its normalized `{ x, y }`, `kind`, and
  `firstUseTime`; `order` is re-derived on load. Optional for back-compat: legacy
  Runs load without it and fall back to on-the-fly detection. This is the first
  Holds data ever written to S3 (reversing ADR 0007 option 2).
- **Editing is scan-stage only (v1).** Holds are finalized on the Detection Preview
  before save and are read-only on saved-Run playback and Compare. Re-editing a
  saved Run's Holds is deferred (it would need an authenticated re-save path).
- **Holds now appear on the Detection Preview**, directly reversing an ADR 0007
  consequence. They are drawn in video-pixel space there (no homography), and in
  Route Photo space on the Route Overlay (homography applied), from the same stored
  points.
- **The label layout can be cached.** Because saved Holds are static, the greedy
  per-frame label placement in `drawHolds` can be computed once per (holds, canvas)
  and reused — the actual fix for the rendering slowdown that prompted this work.
- **Panning Capture is unchanged.** It keeps wall-space on-the-fly detection and
  gains no scan-stage editing in v1.
