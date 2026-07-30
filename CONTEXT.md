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
landmarks. Seeded at scan setup from the frame where the **User** taps the
Climber, then re-derived each detection frame from the previous pose so it
follows the Climber as they move and change scale. Sized and positioned to hold
the whole body **and** the next move inside the region — so a reaching limb is
not clipped out of detection. The Climber is the **only** thing the Adaptive
Crop frames. It is seeded at scan start by the **Climber Crop** (the tap creates
that seed box; the User may adjust it), then re-derived per frame from landmarks
— the manual box only seeds first acquisition, it does not track.
_Avoid_: bounding box, ROI, the (manual) "crop box".

**Manual Crop**:
A user-adjustable box. There are now **two**, independent of each other (ADR
0016): the **Climber Crop** and the **Wall Crop**. Both are shown together and
directly grabbable (`DualCropOverlay`); dragging one never moves the other. The
per-frame **Adaptive Crop** is _not_ a Manual Crop — it stays landmark-derived
during the scan.
_Avoid_: selection, region.

**Climber Crop**:
The User-adjustable seed box for the **Climber** (code: `climberCrop`). It sets
MediaPipe's first-acquisition search region and the lighting-analysis region for
the **Climber**. Tap-seeded (`climberPoint`) and manually overridable, but it
only seeds — the per-frame **Adaptive Crop** re-derives from landmarks during the
scan, so hand-adjusting the Climber Crop does not change tracking, only where the
first pose is acquired and where lighting is measured.
_Avoid_: seed box (in prose), bounding box.

**Wall Crop**:
A region of stable wall texture (excluding the Climber) used to extract ORB
features for route-photo matching (code: `wallCrop`). Independent of the
**Climber Crop** (ADR 0016): the User may trim it down to just the rock face.
Defaults inset from the frame edges with the bottom pulled up to the Climber's
bottom (trimming floor/pad), and the User may shrink it further to exclude sky,
ground, or bystanders.
_Avoid_: background crop; Route crop (the ADRs drifted to this — it collides
with **Route** the problem; the term is Wall Crop).

**Quality Tier**:
A user-facing speed/accuracy preset (Fast / Balanced / Accurate) that selects the
pose model variant and detection effort (model variant, sampling density, and
**Adaptive Refinement** budget). An advanced panel may override individual knobs
after a tier is picked. Trades a slower **Scan** for a cleaner overlay.
_Avoid_: mode, level, model setting.

### Detection quality

**Detection Frame**:
A single sampled video frame that pose detection was run on — every Nth frame the
seek loop sampled, plus any **Adaptive Refinement** re-samples — whether or not a
**Climber** pose was accepted. The unit the detection-eval harness steps through
and annotates; a "missing skeleton" is a Detection Frame with no accepted pose, an
equally valid thing to land on. Distinct from a raw video frame (most are never
fed to the detector) and from a dense playback frame (a synthetic in-between
carrying an **Interpolated Landmark**, not a detection event).
_Avoid_: sample, video frame (ambiguous — most video frames are not Detection
Frames).

**Detector Attempt**:
A backend-analysis evidence row exported by dev Analyze for one MediaPipe attempt
on the scanner's 100 ms sampled timeline. It records the scanner-owned facts
around that attempt: timestamp, accepted/missing/rejected status, raw selected
keypoints when MediaPipe produced a candidate, accepted keypoints only when the
scanner kept the pose, normalized search/detection regions, reacquire outcome,
candidate-selection counts, and observed frame conditions. It is evidence for
backend analysis, not a recommendation or scoring interpretation; the backend
compares it with **Ground Truth** and decides what it means. Older payloads that
only contain `frames[]` are legacy/proxy detector evidence, and a payload missing
`detectorAttempts[]` means the attempt stream is unknown, not that every detector
attempt succeeded.
_Avoid_: playback frame, pose frame, recommendation input (too broad).

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
Not direct detector evidence and not exported as a **Detector Attempt** keypoint.
_Avoid_: predicted point, fake landmark.

**Interpolated Landmark**:
A keypoint produced by routine densification _between two confident detected
samples_ (turning sparse pose frames into dense playback frames). It inherits the
confidence of its endpoints and is **never dimmed** — interpolation is not a
source of uncertainty, unlike an **Estimated Landmark**. It belongs to continuity
and playback output, not the **Detector Attempt** evidence stream.
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
the camera moves. This mode also covers handheld / shaky moving-camera footage
where the wall drifts in frame, so the UI label may refer to "Moving camera".
Opt-in via a scan-setup toggle; it does not replace **Fixed Capture**.
_Avoid_: tripod mode (use **Fixed Capture** there).

**Scan Loading View**:
The in-scan x-ray stage shown while detection runs: a live pose skeleton over a
live ORB wall-feature starfield in video space (no homography). The starfield is
throttled and refreshed during processing so it moves with camera motion.
_Avoid_: detection preview, route overlay.

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

**Landing Replay Playlist**:
The curated, public set of replay-safe clips shown on the landing-page x-ray
demo. It is shared globally (the same source for every visitor), built from
selected **Run**s, and cycled continuously by the hero replay loop.
_Avoid_: user feed, latest uploads (those imply per-user or automatic inclusion).

**Landing Replay Curation**:
The explicit editorial action of choosing multiple **Run**s to include in the
**Landing Replay Playlist**. Inclusion is manual, not automatic.
_Avoid_: auto-publish, latest-only mode.

**Landing Replay Curation Page**:
The dedicated development surface where a maintainer performs **Landing Replay
Curation** and publishes the selected set.
_Avoid_: account settings, profile tools.

### Overlay & review

**Detection Preview**:
The skeleton played back over the **Run**'s own source video, in raw video-pixel
space with **no homography** applied (first frame used as a temporary fallback
poster while video is preparing). Its purpose is to review detection quality
(did the pose pipeline track the **Climber** cleanly) before a **Route Photo**
is involved. Shown on the review step immediately after a scan. It is also where
**Holds** are reviewed, added, and removed before the Run is saved (Fixed
Capture only — a Panning Capture Run has no single frame that shows the whole
**Route**).
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
two pose overlay passes.
_Avoid_: thin line, wireframe (the Skeleton is the lines+joints, distinct from
the **Silhouette** fill beneath it).

**Holds** (overlay pass):
A third overlay pass, independent of the **Silhouette**/**Skeleton**: ring
markers placed where the **Climber**'s hands and feet used a hold, colour-coded by
limb kind (one colour for a **Hand Hold**, another for a **Foot Hold**) with the
ring interior left clear so the wall hold shows through. Toggled
separately from the pose overlay, so a viewer can show the pose, the Holds, both,
or neither. Drawn both on the **Detection Preview** — where the Holds are
reviewed and edited at scan time — and on the **Route Overlay**. Markers reveal in
first-use order on the first playback pass and then stay shown; a **Reset**
control replays that reveal.
_Avoid_: grips, markers (unqualified), hold map.

**Hold**:
A single place the **Climber** used with a hand or a foot. It is **not** a hold
detected on the **Route Photo**. A Hold is usually inferred from where the limb
stayed still long enough to be load-bearing (a **Dwell**), but the **User** may
also **add or remove** Holds while reviewing a Run (a Hold is added by scrubbing
to the frame where the limb is on the hold and snapping to that limb). Each Hold
is exactly one **Hand Hold** or **Foot Hold**, anchored to where the limb was in
the Run (and shown on the **Route Photo** through the overlay). Each Hold has a
rank in the order it was **first** used (one combined hand+foot sequence), always
re-derived from first-use order so adding or removing a Hold renumbers the rest;
that rank orders the progressive reveal and the editor list rather than appearing
as a number on the marker. Repeated use of the same spot by
the same limb kind — a re-grip, a two-hand match — is the same Hold, not a new
one; a hand and a foot on the same spot are two different Holds.
_Avoid_: grip, placement, contact (those name the raw evidence — see **Dwell** —
not the inferred result); the physical wall hold (we never detect that).

**Hand Hold**:
A **Hold** used by a hand — a **Dwell** where the hand point stays still and sits
above the wrist, reading as a grip rather than a hang or a press.
_Avoid_: grip.

**Foot Hold**:
A **Hold** used by a foot — a **Dwell** where the foot point stays still and the
leg is load-bearing: the knee straightens (the Climber stands up) or the leg is
braced at a supportive angle, as opposed to a free hanging leg.
_Avoid_: foothold as the code term (the type is Foot Hold); step.

**Dwell**:
One stretch of time over which a single limb's contact point stays within a small
radius in Route Photo space — the raw evidence for a **Hold**. Measured in wall
space (after homography) so a held limb still counts as a Dwell while the camera
pans in **Panning Capture**. One Hold may gather several Dwells at the same spot.
_Avoid_: pause, stop, hover.

### Comparison

**Comparison**:
The console surface that plays two to four **Run**s together — their **Skeleton**s
overlaid on one shared **Route Photo**, or side by side each in its own space —
so their beta can be read against each other. A same-owner Comparison lines up a
climber's own Runs of one **Route**; a cross-user Comparison brings in a **Guest
Run** (ADR 0022). Lives at `/route/{userId}/{state}/{area}/{route}`.
_Avoid_: compare (bare verb, when the surface/noun is meant); the old `/compare`
page (now only a redirect into this console).

**Host Route**:
The **Route** a **Comparison** is anchored on — its owner is the `{userId}` in the
path and its **Route Photo** is the default coordinate space the overlay projects
onto. In a cross-user Comparison the Host Route is the **viewer's own** Route; the
other climber's Run rides in as a **Guest Run**.
_Avoid_: owner route, base route.

**Guest Run**:
In a cross-user **Comparison**, a **Run** owned by a different **User** than the
one hosting the Comparison, read through the prefix-gated cross-user endpoint and
overlaid alongside the viewer's own Run. Attributed to its owner by
`displayName`. Its pose may not align on the **Host Route**'s **Route Photo**
(different viewpoint), which is why either owner's photo may anchor the overlay
and why the surface falls back to side by side.
_Avoid_: their run, foreign run, shared run.

### Diagnostics

**Scan Diagnostics**:
The bundle of detection-quality measurements produced while analysing a single
**Run** — pose-detection quality and ORB extraction quality, plus the
conditions of the processed video frames (resolution, brightness, contrast,
sharpness, condition flags). Persisted to a local, dev-machine-only file for
trend analysis and rendered live in a dev panel. Self-contained by design: it
never needs joining back to the Run's pose/ORB data to be useful.
_Avoid_: logs, telemetry (those imply prod-side, server-collected streams).

**Build Identity**:
The pair of stamps every **Scan Diagnostics** record carries saying which code
produced the run: `appVersion` (the checkout's short git SHA, resolved once when
the dev server starts) and `detectorCodeHash` (a content hash of the detector
modules read off disk when the run began — ADR 0025). Neither answers the
question alone. `appVersion` is frozen at server start, so a hot reload moves the
detector without moving it; `detectorCodeHash` moves with the code but names no
commit. Read together they are diagnostic: **same `appVersion`, different hash**
means a hot reload landed mid-batch and those runs are not one build, while
**different `appVersion`, same hash** means a commit that never touched
detection, so those runs pool legitimately. A null hash is _unknown provenance_,
never a conflict — the same fail-open rule as an unstamped **Ground Truth**.
_Avoid_: version, build number (both imply a single field settles it).

**Match Diagnostics**:
The detection-quality measurements produced when a **Run**'s reference features
are matched to one image — the reference frame's conditions, the matched image's
conditions, and the resulting ORB matching quality (matches, inliers,
homography found). One per Run×image, since a Run is matched to many images.
Persisted locally alongside **Scan Diagnostics**; keyed by content hash of the
video and the image so re-used files collapse to a stable key.
_Avoid_: match log, overlay score.

**Reference Frame Metadata**:
The quality characteristics of a **Run**'s processed reference frame (resolution,
the **overall**/**climber**/**wall** region brightness-contrast-sharpness stats,
condition flags, ORB keypoint count) stored in S3 alongside the reference ORB
features, so the features always travel with the conditions under which they were
extracted. The one piece of diagnostic data that lives in S3 rather than locally;
read back at match time to build a **Match Diagnostics** record.
_Avoid_: frame stats (too generic).

**Ground Truth** (Landmarks):
The per-video reference pose the detection-eval harness scores runs against: the
correct **Climber** landmarks on each **Detection Frame**, authored once in the
calibration pass by a **flag-only review** of an auto-accepted seed. Every
Detection Frame starts **accepted** from a **stronger reference model** (ViTPose++,
run on the downloader — ADR 0019, a hard requirement), _not_ from the detector
under test; the human's only job is to _flag exceptions_ — **Wrong** (bad seed
skeleton, kept as presence truth with its joints excluded from scoring) or
**Absent** (no Climber here) — then press one **Accept & save** button. Landmark
dragging and per-joint editing are gone. Each frame carries a `review` value:
**auto** ("nobody objected", left as the seed) or **human-flagged-wrong** /
**human-flagged-absent**; scoring splits auto (agreement-tier) from human-flagged
(accuracy-tier) evidence. Paired to its **Scan Setup** by a stored `setupHash` —
the hash of the calibration whose ViTPose scaffold seeded it, and the hash a run
must stamp to be evaluated against it (ADR 0020) — and stamped with the
`scaffoldSeedHash` of the ViTPose scaffold it was actually authored from
(the scaffold's own `seedHash`, harness ADR 0007). A change to **either** flips
the truth to a surfaced **stale** state (never silently healthy, never
discarded): a Setup save moves the first, a **re-seed** moves only the second,
and neither can stand in for the other. An unstamped truth, or one seeded from a
scaffold that carries no `seedHash`, has _unknown_ provenance and is never read
as stale. Re-seeding under the current calibration carries the human flags
forward by timestamp, and export is refused while the scaffold on disk belongs to
an older calibration. Frozen alongside the video's crops as calibration output;
the scaffold that seeds it is discarded — only the Ground Truth persists, not a
scored run.
_Avoid_: ground-truth run (it is not a **Run** — it yields no scored result);
labels (those are the video-level condition metadata, a different thing);
dragging / editing landmarks (superseded — authoring is flag-only review).

**Detection Error**:
A per-run, per-**Detection Frame** discrepancy between a headless run's detected
pose and the video's **Ground Truth**, computed automatically with no human
judgement per run. Kinds: **missing** (Ground Truth has a Climber, the run found
none), **wrong** (the run's pose is far from Ground Truth — a **Bystander** or a
gross mislabel), **extreme** (an anatomically implausible pose), and **drift**
(the pose is on the Climber but landmarks are displaced, measured as distance from
Ground Truth). Once Ground Truth exists, errors are derived, not hand-tagged, and
_causes_ are found by correlating errors against the auto per-frame conditions and
the video-level metadata across the corpus — not attributed by hand per frame.
_Avoid_: fault (superseded — errors are derived, not authored); reusing **Overlay
Quality** "drift" (scan-level, on the **Route Overlay**).

### Test corpus (detection eval harness)

**Test Video**:
A climbing video downloaded by a separate program to evaluate detection quality —
_not_ a **Run** a **User** recorded. It never touches S3; it lives in that
program's per-video bundle (a `metadata.json` of human-labelled conditions, a
`final_frame.png`, and a `detections/` folder). Its `route_folder` groups Test
Videos of the same wall, so a `route_folder` maps to a **Route**, one Test Video
maps to one **Run** of it, and each `final_frame.png` is a candidate **Route
Photo** for matching the _other_ Runs of that Route (a later cross-video phase).
_Avoid_: sample, clip, Run (a Run is User-recorded and saved to S3).

**Scan Setup**:
The frozen set of manual scan inputs attached to a **Test Video** so its scan can
be replayed headlessly with no **User**: the **Climber Crop**, the **Wall Crop**,
the Climber tap (`climberPoint`), the **Fixed**/**Panning Capture** flag, and the
**Quality Tier**. Set once in a manual calibration pass — which now also authors
the video's **Ground Truth** by a flag-only review of the auto-accepted ViTPose
seed (the Climber selection, `climberPoint` + **Climber Crop**, also drives the
downloader's ViTPose++ scaffold pass — ADR 0019), and lets the User edit the
video-level condition labels — and reused verbatim by every later headless re-run,
so a quality change between runs is attributable to detection-logic changes, not
setup drift. The condition labels are stored inside the Setup itself, under
`setup.json.analysisInputs` (snake_case keys) where the harness reads them; the
`setupHash` covers only the scan-affecting inputs (crops, point, panning, tier), so
editing a label never re-hashes the Setup or orphans saved Ground Truth. Each Setup
save also re-POSTs the harness's `/api/video-stats` (gated on its `/api/contract`
probe) so the harness recomputes region stats under the new hash; the suggested
labels in its response prefill the label form for the User to verify rather than
author, and every label save records per-label provenance under
`setup.json.analysisInputsProvenance` (`auto-accepted` / `human-overridden` /
`human-authored`). The labels in `setup.json.analysisInputs` are advisory corpus
metadata for later analysis; they do not define expected **Climber** presence or
pose, which remains the responsibility of the video's **Ground Truth**. The
scaffold run is discarded; calibration saves no scored run. Stored as `setup.json`
in the Test Video's bundle, beside the `ground-truth.json` **Ground Truth**.
_Avoid_: seed (the identity seed, `climberPoint`, is just one field of the
Setup), config, calibration, fixture.

**Untrackable** (bundle state):
A **Test Video** whose most recent ViTPose++ seed job landed **no Climber
landmarks** — the tracker matched nobody to the current seed, or the job failed —
and which has no fresh, accepted **Ground Truth** to fall back on, so it holds
neither a usable seed nor good evidence. Held out of the batch calibration and
re-seed sweeps rather than deleted, so the same failing seed is never re-run in
bulk every sweep; it stays in the corpus, flagged, until a **re-seed** (a fresh
Climber tap + ViTPose run) lands landmarks. Derived from what is on disk, not a
stored marker: a poseless seed artifact from the _current_ calibration, or a
terminal job-failure record. A bundle that already has fresh Ground Truth is
never Untrackable — a later re-seed that lands nothing leaves the good truth
standing — and a poseless artifact from an _older_ calibration is retryable, not
Untrackable (the scan-affecting inputs changed, so the failure may not recur).
_Avoid_: broken / failed (a _job_ fails; the _bundle_ is Untrackable); dead
(it is kept for a later pass, not discarded); quarantined (fine in prose, but the
state is Untrackable).

### Planning tracker

**Status** (tracker):
The implementation lifecycle state of a PRD or issue.
_Avoid_: priority, actionability, parked state.

**Disposition**:
The actionability state of a PRD: actionable, parked, or done.
_Avoid_: Status, lifecycle.

## Relationships

- A scan has exactly one **Climber** and zero or more **Bystanders**.
- **Climber Identity** is seeded once, then selects the Climber's pose in every
  frame; the **Adaptive Crop** is derived from that selected pose.
- The tap seeds **Climber Identity** and the first **Adaptive Crop**; the
  Adaptive Crop then frames the Climber every detection frame. The **Wall Crop**
  defaults to the whole frame, stays User-adjustable, and feeds route-photo
  matching, not pose tracking.
- A **Hold** is inferred from one or more **Dwells** of the same limb kind at one
  spot, and may then be edited by the **User**. For a **Fixed Capture** Run the
  Holds are detected and edited on the **Detection Preview** and saved with the
  Run; for a **Panning Capture** or legacy Run they are derived on the fly from
  the same pose frames the **Skeleton** uses. Either way they are projected
  through the same homography onto the **Route Photo** for display.

## Example dialogue

> **Dev:** "If a **Bystander** walks across the **Climber**, do we lose the track?"
> **Domain expert:** "No — **Climber Identity** picks the pose nearest where the
> Climber was predicted to be, and rejects anything outside the gate. The
> Bystander is never selected, so the **Adaptive Crop** keeps following the
> Climber."

## Flagged ambiguities

- "crop" meant both the user's drawn box and the per-frame detection region —
  resolved: the **Adaptive Crop** (auto-derived, tap-seeded) is the only Climber
  crop and frames the Climber; the **Manual Crop** is now just the
  User-adjustable **Wall Crop**.
- "user" meant both the account holder and the person climbing — resolved: the
  account holder is the **User**; the person climbing is the **Climber**.
- "climb" is used in the UI/code for both the **Route** (a problem) and a single
  **Run** (one ascent) — prefer Route / Run when precision matters.
- "attempt" is used for both a **Run** generically and the not-topped **Run Type**
  — resolved: a Run is a Run; "Attempt" is reserved for the Run Type opposite Send.
- "hold" could mean the physical hold on the wall or the app's inferred **Hold** —
  resolved: a **Hold** is always the inferred place a limb used (from a **Dwell**);
  the app never detects physical wall holds, so the bare word always means the
  inferred one.
- "compare" was an undocumented UI surface — resolved: the noun is a
  **Comparison** (the console showing multiple Runs together), on a **Host Route**,
  optionally including a cross-user **Guest Run** (ADR 0022). The bare verb still
  means "put runs against each other"; use Comparison when the surface is meant.
- "preview"/"overlay" meant both the skeleton over the Run's own first frame and
  the skeleton projected onto the Route Photo — resolved: **Detection Preview**
  (video-pixel, no homography) vs **Route Overlay** (projected onto the Route
  Photo). A bare "stuck on the preview" is ambiguous between the two.
- "status" was used to mean both implementation progress and whether a PRD should
  be picked up — resolved: **Status** is lifecycle only; **Disposition** is PRD
  actionability.
