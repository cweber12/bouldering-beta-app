# Beta Scanner

Scan a climbing run in-browser using **MediaPipe Pose Landmarker** pose
estimation and **OpenCV.js** ORB feature matching — then save results to
**Amazon S3** for access across devices.

The app records skeleton poses frame-by-frame from a video using MediaPipe Pose
Landmarker (GPU delegate), extracts **ORB reference features** (OpenCV.js WASM),
then overlays the movement onto a static route photo via a perspective
(homography) transform. The output is a downloadable **WebM** video.

Two capture modes share that pipeline:

- **Fixed Capture** (default) — a static (tripod/propped) shot where the whole
  route stays in frame. A single homography from the **first frame** aligns the
  run to the route photo for every frame.
- **Panning Capture** (opt-in "Moving camera" toggle) — for longer routes and
  any moving-camera footage (panning, handheld drift, mild shake). The run
  stores ORB **keyframes** (wall-crop features sampled ~every 0.75 s) and
  aligns each moving section to the route photo independently, so the overlay
  tracks the wall as the camera moves. The photo is the global reference, so
  the alignment is drift-free; in-between frames decompose-interpolate the
  bracketing keyframe homographies.

Each run is classified as an **attempt** (did not top) or a **send** (topped).
Optional **rating** (e.g. "V3") and freeform **notes** can be attached to any run.

## Pipeline

### Pose estimation

The scan/upload pages expose a single **Fast / Balanced / Accurate** quality
tier as the primary detection control (`utils/poseTiers.ts`). Each tier resolves
to a config bundle that drives the **MediaPipe Pose Landmarker** (33 BlazePose
keypoints including hands and feet):

| Tier               | Model variant | maxPoses | frameStep | Gap-recovery frames | Filter tolerance |
| ------------------ | ------------- | -------- | --------- | ------------------- | ---------------- |
| Fast               | Lite          | 2        | 15        | 15                  | 4                |
| Balanced (default) | Full          | 3        | 10        | 30                  | 3                |
| Accurate           | Heavy         | 4        | 5         | 45                  | 2                |

An **Advanced** panel still overrides the individual model variant and frame
step (detection stride) for power users; the tier remains the source of truth
for `maxPoses`, gap-recovery aggressiveness, and the landmark-filter tolerance.

The landmarker runs in **multi-pose** mode so the pipeline can tell the climber
apart from bystanders. A **climber-identity tracker** (`pipeline/climberTracker.ts`)
seeds identity from a tap on the climber in the first frame (or the strongest
pose), then on each frame selects the detected pose whose torso centroid is
nearest the velocity-predicted position — rejecting anyone outside a distance
gate, so a passerby never steals the track. The per-frame detection crop is
derived **automatically** from the climber's landmarks — sized to the body plus
room for the next move and led toward the velocity-predicted position, so a
reaching limb stays inside the crop instead of being clipped. If the climber is
lost inside the crop, detection widens to the full frame and re-acquires by
identity.

After estimation, five post-processing passes are applied:

1. **Interpolation** — `interpolatePoseFrames` densifies the sparse detected frames onto the full timestamp list, interpolating each joint along its own detection timeline (Catmull-Rom). A joint occluded longer than the bridge gap is omitted rather than stretched in a straight line.
2. **Estimation** — `estimateMissingLandmarks` fills short gaps using temporal interpolation and skeletal bone-vector geometry.
3. **Persistent-gap fill** — `fillPersistentGaps` is the no-gap guarantee: any joint the detector saw both before and after a frame is always present in that frame (structurally off a visible neighbour where possible, else temporal lerp), at a dimmed confidence. This stops an occluded limb from winking out across a dropout too long to bridge or too degraded to estimate.
4. **Smoothing** — `smoothPoseFrames` runs a zero-phase (forward + backward) One-Euro adaptive filter that suppresses jitter without lag.
5. **Bone constraint** — `constrainSkeleton` rebuilds each limb joint in bone space (`parent + polar(angle, len)`, with angle and projected length interpolated between the real detections) so bones keep a rigid length and true orientation. The earlier passes move each joint's x/y independently of its parent, which makes rotating limbs stretch/snap and occluded joints bend the wrong way; this pass removes both while still honouring genuine foreshortening at the detections (ADR 0015).

### Skeleton overlay

`drawSkeleton` renders the pose as two passes: a translucent **Silhouette** (the
skeleton drawn fat — every bone stroked as a round-capped capsule, hands and feet
at 0.75× the limb width, plus two filled regions for the torso quad and a head
oval — flattened through an offscreen canvas so overlaps stay uniform, and shaded
for depth with a dark boundary rim fading to lighter limb cores plus radial torso
and head fills, all derived from the silhouette colour) beneath a crisp
**Skeleton** (thin lines + joint points).
It accepts a `SkeletonStyle` object with `silhouetteVisible/Color/Opacity`,
`limbThickness`, `linesVisible/lineColor/lineThickness`, and
`jointsVisible/jointColor/jointRadius` (plus optional `skeletonEdges` /
`keypointNames`). All sizes are multipliers of a per-frame body scale (shoulder
width) so the overlay looks the same at any photo resolution. The **Climber**
panel (rows: Silhouette / Lines / Joints, each with a visibility toggle, colour,
and unitless sliders, plus a Holds row) feeds the live preview and the WebM
render. On the scan preview it opens as a right-edge drawer over the preview
frame, from a control bar directly above the preview.

### Holds overlay

A third overlay pass, **Holds**, marks where the climber's hands and feet were
used on the wall. Each marker is a **thin colour-coded ring** with a **transparent
interior**, so the wall hold reads straight through. Colour carries the only thing
the marker says: **blue = a hand hold, orange = a foot hold** (ADR 0012). There is
no number, no glyph and no left/right side on the wall — the Skeleton already shows
the move sequence, and a ring popping in as the limb lands narrates the order. A
spot used by both hands collapses to one blue ring; a spot used by both a hand and
a foot draws **two concentric rings** (blue outer, orange inner).
Markers reveal in first-use order on the first playback pass and then stay shown
across loops; a **Replay** control on the player re-arms that reveal. Holds are
**inferred from Dwells** (a limb held still long enough to be load-bearing — a
gripped hand above the wrist, a foot that is either held out to the side of the
hip, pushing up as the knee straightens, or braced with a bent knee planted below
it), never detected on the route photo. A foot must be held still longer than a
hand, so a repositioning or swinging foot that briefly pauses is not mistaken for
a placement. A Dwell survives a brief lift-off and return (so a re-grip is one
Hold, not two), and the climber is taken to always be supported by at least one
hand.

For a **Fixed Capture** Run, Holds are detected at scan time in the Run's own
video-frame space and reviewed on the **Detection Preview**, where the User can
**add** a Hold (scrub to the frame where the limb is on the hold, then snap it to
one of the four extremities) and **remove** Holds (the rest renumber
automatically). The result is saved with the Run in normalized `[0,1]` video
space and projected — through the same homography as the Skeleton — onto the
**Route Overlay** and in Compare, where it is read-only. A Run with no saved
Holds (every legacy Run, every Panning Capture Run) falls back to deriving Holds
on the fly via `pipeline/holdDetection.ts` (`detectHolds`) over the same pose
frames the Skeleton uses. The Holds source path lives in the `useHolds` hook;
scan-stage editing lives in `useScanHolds`. `drawHolds`
(`pipeline/holdsOverlay.ts`) renders them beneath the Skeleton (which stays
legible on top): coincident Holds collapse into **one ring per kind** at the spot,
blue for hand and orange for foot, each a thin colour stroke with a dark contrast
halo and a clear interior (see ADR 0012). The per-frame cost is
trivial, so geometry is computed inline without a cache. They are toggled
independently from the Climber panel's Holds row, and edited from the **Holds**
drawer (the hand-glyph control on the preview bar). The
auto-rendered WebM stays pose-only (static, so a baked-in Holds layer could not
be toggled off). The dev Analyze harness posts `detectorAttempts[]` as the
backend evidence stream for accepted, missing, flip-rejected, and
quality-rejected detector attempts while keeping playback frames separate. It
posts scanner-owned evidence only: `setup.json.analysisInputs` remain advisory
condition metadata, Ground Truth remains authoritative for expected climber
presence and pose, and backend recommendation semantics stay outside
beta-scanner. Older `frames[]`-only payloads are legacy/proxy detector evidence;
when `detectorAttempts[]` is missing, the detector-attempt stream is unknown, not
implicitly successful. Dev Analyze skips the animated scan-loading x-ray, and its
Detection Preview adds a detection-frame filmstrip and stepper — a scrolling row
of frame thumbnails, each bordered by its detection status (detected / weak /
missing / flip) — for jumping through sampled frames and flagged stretches.

### Adaptive overlay contrast

A **Boost contrast** control in the Climber panel keeps the overlay legible
against the wall it is drawn on. It is **opt-in and off by default**: the backdrop
is always sampled (so poor contrast can be _detected_), but adaptation is only
applied once the user turns the boost on. When the wall is detected to give the
palette poor contrast (`paletteContrastIsPoor`), the panel surfaces a one-click
"Low contrast on this wall — boost it" prompt; otherwise it shows a plain toggle.

The backdrop's luminance band is sampled once per surface (`useContrastAdjust` →
`sampleBackdropLuma` draws the photo, or the wall crop, to a small offscreen
canvas and hands the pixels to the pure `computeLumaStats`), and
`contrastAdapter.adaptColor` nudges each overlay colour's **lightness only** just
far enough to clear the contrast target against that band. Hue never moves — cyan
still means Hand Hold, orange still means Foot Hold (ADR 0012), and the anatomical
Skeleton keeps its limb identities — saturation is only ever raised (to rescue a
hue a lightness push would wash out), and the result is clamped away from pure
black/white so a nudge stays a nudge rather than a blackout. The target is
deliberately gentler than WCAG's 3:1 graphical-object bar: on a bright wall a
bright overlay cannot get _brighter_ than the wall, so a hard 3:1 would force it
to near-black. The review step samples the wall crop; the route-photo overlay and
the exported/baked WebM sample the route photo. Turning the boost off renders the
authored palette exactly — the feature is purely additive, and nothing is
persisted (the adjustment is recomputed deterministically from the photo, so saved
runs need no migration). The target and band width are named constants
(`TARGET_CONTRAST_RATIO`, `BAND_K`) at the top of `contrastAdapter.ts`.

The route console (single, side-by-side, and multi-climb overlay) carries the
same boost via a **Contrast** toggle in its stage toolbar, sampling the route
photo. Because every climb differs by hue and hue never moves, adaptation can only
slide lightness within each identity, so slots stay distinguishable; the shared
white joint is a neutral anchor and is exempt from adaptation.

## Pages

| Route                                    | Purpose                                                                                                                                                                                                                                                                                                                     | Auth required |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `/`                                      | Landing page — intro, the curated replay hero (the same playlist for every visitor, signed in or not), and how-it-works summary                                                                                                                                                                                             | No            |
| `/login`                                 | Sign in / sign up with email & password                                                                                                                                                                                                                                                                                     | No            |
| `/scan`                                  | Scan a climbing video, preview landmarks, optionally overlay on a route photo                                                                                                                                                                                                                                               | Yes           |
| `/compare`                               | Redirect into the route console (below); preserved for older links                                                                                                                                                                                                                                                          | Yes           |
| `/route/[userId]/[state]/[area]/[route]` | Route console — open one run (single view) or compare 2–4 runs side-by-side/overlaid, with route-photo matching and per-run start-time alignment. Guest runs from **another user** can be overlaid (cross-user comparison): selectable anchor photo, side-by-side fallback when alignment fails, and a colour + name legend | Yes           |
| `/people`                                | Search other climbers by name or email, open their public profile, then choose a climb to view or compare                                                                                                                                                                                                                   | Yes           |
| `/profile`                               | View own profile with 4×4 climb grid, filters, list/map toggle; click any climb card or map pin for full detail modal; edit mode for profile fields, search & follow                                                                                                                                                        | Yes           |
| `/profile/[userId]`                      | View another user's public profile with 4×4 climb grid, filters, list/map toggle; click any climb card or map pin for full detail modal, including **Compare with mine** to overlay their run against one of your own                                                                                                       | Yes           |
| `/docs`                                  | Usage guide                                                                                                                                                                                                                                                                                                                 | No            |
| `/dev/map-drag`                          | Internal diagnostics page for verifying Leaflet mouse drag/pan behavior and map init race handling                                                                                                                                                                                                                          | No            |
| `/dev/landing-clip`                      | Development-only, unlinked maintainer tooling: pick a saved Fixed Capture run, choose a 20-second window, attach an optional wall still and a route photo, run the existing ORB match, and download one landing-replay clip (`{ version: 1, items: [ … ] }`) to check into the repo                                                                    | Yes           |

## Interactive crop boxes

Before processing, each upload and image-match workflow shows an interactive
crop box overlay. Drag the interior to move the box and drag any of the 8
handles to resize it.

**Mark detection — two nested boxes:**

**Tap the climber** to lock detection onto them. Two boxes then appear and are
adjustable at the same time — the inner **Climber** box and the outer **Route**
box around it (drag a box's interior to move it, a handle to resize). Re-tap to
pick a different climber.

| Target          | Purpose                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Climber (inner) | Pose detection seed window, derived from the climber's landmarks at the tap (sized to the body plus room for the next move). Adjust it to correct the first-frame search region; during the scan the per-frame crop still follows the climber automatically.                                                        |
| Route (outer)   | Feature-matching region on the first video frame. Starts framed around the climber — inset from the frame edges with its **bottom pulled up to the climber's bottom** (excluding the floor/pad, which is matching noise); drag it to trim it down to just the rock face and line the climb up with the route photo. |

The two boxes are independent — resize each freely. The Route is not tied to the
Climber, so you can shrink it to just the target face even when the climber is
wider than the rock. Click **Scan video** after framing the boxes.

## Guided scan flow

The upload flow is a guided 4-step wizard. Every step shares a common
`ProcessFlowShell` chrome: a "Step _n_ of 4" indicator, an optional one-sentence
**purpose line** stating what the step is for, and a sticky footer that always
keeps the primary action visible regardless of media aspect ratio (so the
Scan/Save buttons never fall below the fold on portrait video). All copy is
goal-named — no pipeline jargon (ORB, homography, feature points) appears unless
**Developer view** is enabled.

1. **Choose clip** — upload a clip or record with camera (both equal-weight),
   with a one-line note on what makes a good video.
2. **Mark detection** — tap the climber to lock tracking onto them (a coaching
   pill on the media shows where to tap), then frame the route. Pressing
   Scan with no climber marked surfaces a soft nudge ("Scan anyway") rather than
   blocking. Quality tier, pose model, sampling stride, the **Moving camera**
   toggle, and the **Developer view** switch live in a single
   **Settings** popover.
3. **Review climb** — watch the traced climb (clean by default; feature points
   appear only in Developer view). The promoted primary action, **Place on
   route**, opens the route-photo overlay; **Save scan** (raw scan) is the
   secondary action.
4. **Place on route** — add a route photo (**Take photo** on the spot or
   **Choose from library**). A preliminary match runs automatically and
   auto-frames the climb by projecting the saved climber crop into the photo, so
   the crop box lands over the route ready to confirm; adjust it if needed, then
   **Place on route**. If the preliminary match is too weak to auto-frame, a hint
   asks you to drag the box over the route area yourself. **Export video**
   downloads the annotated clip; match statistics are Developer-view only.

Metadata entry is essentials-first (location + run type, with location required
for cloud upload — the Upload button stays disabled until it is filled), and
optional details (grade, notes) progressively disclosed in the save sheet.

**Match / Compare pages:**

Adding a route photo opens the same auto-framed crop-confirm step as the scan
pipeline: a preliminary match projects the first loaded climb's saved climber
crop into the photo so the box lands over the route, ready to adjust, then
**Place on route** runs the match for every loaded climb. If auto-framing is too
weak (a different viewpoint, or no saved crop), a hint asks you to drag the box
over the route area yourself before placing. The ORB features are extracted only
from the cropped region; keypoints are offset back to full-image coordinates
automatically, so homography computation is unaffected. After placing, **Refine**
reopens the crop to re-match without re-uploading.

On the **Compare** page, all climbs for a route sit under one grouped surface.
Each climb shows a clean metadata line (colour swatch · date · time · a green
send / amber attempt dot); the route grade is accented in the page header. Each
climb keeps its identity colour. Use **Set start** on each side-by-side climb to
flag the frame its sequence begins, then **Play all** runs every climb from its
own start in sync. (In the overlaid view the translucent Silhouette is suppressed
so several climbers' skeletons stay legible.)

**Cross-user comparison.** From another climber's climb detail modal, **Compare
with mine** picks one of your own runs and opens the console hosted on your route,
with their run overlaid as a guest. Because the two videos may be shot from
different viewpoints, the anchor photo is selectable between either owner's saved
photo (Update photo), and when no single photo aligns both runs the view drops to
side by side with a notice. Each skeleton is attributed by colour and the owner's
display name. Any authenticated user may read another user's pose data for this,
served by the prefix-gated `/api/profile/[userId]/climbs/attempt` endpoint (see
ADR 0022).

## Authentication

User accounts are managed by **Firebase Auth** (email/password). After signing
in the client exchanges the Firebase ID token for an HTTP-only session cookie
via `POST /api/auth/session`. Unauthenticated visitors can view the home page
and docs; upload, match, compare, and profile pages require sign-in. The proxy
(`proxy.ts`) checks for the session cookie on every request and redirects
unauthenticated users to `/login`. Route Handlers verify the session cookie
against the Firebase Admin SDK before executing any protected operation.

All stored data is scoped per user — S3 keys include the Firebase UID, and every
API route validates that the requesting user owns the data they access.

## Cloud storage (S3)

Processed runs are stored in Amazon S3 under the key prefix
`RouteData/{userId}/{state}/{area}/{route}/run-{timestamp}-{attempt|send}.json`. The
upload, match, and compare pages all feature S3-backed dropdown pickers that
list existing states → areas → routes → runs directly from the bucket.
Attempts are highlighted in amber and sends in emerald throughout the UI.
Legacy `attempt-{timestamp}.json` files are still loadable (treated as attempts).

Each run is stored as **two** objects: the `.json` above holds the small,
queryable metadata (location, run type, rating, notes, thumbnail, video meta,
and — for Fixed Capture — the authored **Holds** as normalized `[0,1]`
video-space points) that the list/card/detail views read, while a sibling
`run-{timestamp}-{attempt|send}.data.json` holds the heavy frames, per-frame ORB
matches, and base64-encoded descriptors — fetched only when a run is actually
opened. **Panning Capture** runs additionally store an ordered array of ORB
**keyframe** feature sets (each with its video timestamp) in the data object; a
longer route can run to a few MB (under the 25 MB upload cap). Fixed Capture runs
omit the keyframes field. Legacy single-file runs (everything inline) still load
transparently.
The heavy data object is written **first** and the metadata object **last**, so a
save that fails partway never leaves a metadata record pointing at missing
frames; opening a run whose data sibling is absent surfaces a clear error rather
than silently loading an empty skeleton. User-supplied text (state, area, route,
rating, notes) is clamped to 500 characters before storage.

Profile data is stored in the **same S3 bucket** as route data, under the
prefix `ProfileData/{userId}/profile.json` (display name, bio, location,
profile picture as base64 data URL). A searchable index entry at
`ProfileData/_index/{userId}.json` enables user search by name or email.
Following relationships are stored at `ProfileData/{userId}/following.json`.

Each saved run may include a scaled-down PNG thumbnail of the middle video frame
with ORB keypoints drawn as green dots. The thumbnail is stored as a data URL in
the JSON and displayed inline in the route picker alongside climb information.

## Location & Maps

Climb locations are captured via two mechanisms, both of which require no API key:

- **GPS auto-fill** — a crosshair button on the upload page and the profile page
  calls `navigator.geolocation` to get the device's current coordinates. On the
  upload page the coordinates are stored with the run and the state/area fields
  are auto-populated via **Nominatim** (OpenStreetMap reverse geocoding). On the
  profile page the location field is auto-populated with the nearest locality.

- **Map picker** — a "Pick on map" button on the upload page opens a full-screen
  **Leaflet** map with a preferred **MapTiler Outdoor** basemap when
  `NEXT_PUBLIC_MAPTILER_KEY` is configured, and automatic fallback to
  **OpenTopoMap** when the key is missing or the preferred tiles fail at runtime.
  Both tiers are outdoor topographic styles with contour lines, so the map keeps
  its climbing identity in either path. A theme-aware CSS filter on the tile pane
  (`app/globals.css`) tones the tiles toward the app's warm-charcoal surface in
  dark mode and relaxes to a light, natural render under `.theme-light`. Users
  can click or drag a pin to select a precise climb location.

- **Location autocomplete** — the location autocomplete component (`LocationAutocomplete`)
  queries Nominatim forward-search with a 500 ms debounce and displays a dropdown
  of up to five suggestions.

- **Climbs map** — the public profile page (`/profile/[userId]`) includes an
  interactive Leaflet map showing all of the user's GPS-tagged climbs as colour-coded
  pins (amber = attempt, emerald = send). Nearby pins are automatically clustered
  via **leaflet.markercluster**; clicking a cluster or hovering a pin reveals a
  popup listing each climb.

- **Profile photo crop** — the profile page replaces the plain avatar upload with a
  circular crop editor (`react-image-crop`) that lets users zoom and reposition
  their photo before saving. The cropped image is compressed to JPEG 85 % at

### Environment variables

| Variable                                   | Purpose                                             | Example                       |
| ------------------------------------------ | --------------------------------------------------- | ----------------------------- |
| `NEXT_PUBLIC_FIREBASE_API_KEY`             | Firebase web API key                                | —                             |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`         | Firebase auth domain                                | `project.firebaseapp.com`     |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`          | Firebase project ID                                 | `route-scanner-xxxxx`         |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`      | Firebase storage bucket                             | `project.firebasestorage.app` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID                        | —                             |
| `NEXT_PUBLIC_FIREBASE_APP_ID`              | Firebase app ID                                     | —                             |
| `NEXT_PUBLIC_MAPTILER_KEY`                 | Optional key for preferred MapTiler Outdoor basemap | —                             |
| `FIREBASE_PROJECT_ID`                      | Firebase project ID (Admin SDK, server-side)        | —                             |
| `FIREBASE_CLIENT_EMAIL`                    | Service account client email (server-side)          | —                             |
| `FIREBASE_PRIVATE_KEY`                     | Service account private key (server-side)           | —                             |
| `AWS_REGION`                               | S3 bucket region                                    | `us-east-2`                   |
| `AWS_ACCESS_KEY_ID`                        | IAM access key                                      | —                             |
| `AWS_SECRET_ACCESS_KEY`                    | IAM secret key                                      | —                             |
| `S3_BUCKET_NAME`                           | Bucket name                                         | `route-renderer-bucket`       |
| `S3_KEY_PREFIX`                            | Key prefix (default `RouteData`)                    | `RouteData`                   |

Create a `.env.local` file with these values. **Never commit credentials.**

The Firebase Admin private key can be downloaded from the Firebase console:
**Project Settings → Service Accounts → Generate new private key**.

### API routes

| Route                                  | Method          | Purpose                                                               |
| -------------------------------------- | --------------- | --------------------------------------------------------------------- |
| `/api/s3/put`                          | POST            | Upload run JSON                                                       |
| `/api/s3/get`                          | GET             | Download run JSON by key                                              |
| `/api/s3/list`                         | GET             | List objects/prefixes (pagination, delimiter)                         |
| `/api/s3/delete`                       | DELETE          | Remove a run                                                          |
| `/api/auth/session`                    | POST/DELETE     | Create/destroy Firebase session cookie                                |
| `/api/profile`                         | GET/PUT         | Read/update own profile                                               |
| `/api/profile/[userId]`                | GET             | Read any user's public profile                                        |
| `/api/profile/[userId]/climbs`         | GET             | List any user's climbs (raw S3 keys)                                  |
| `/api/profile/[userId]/climbs/page`    | GET             | Paginated climb summaries with thumbnails, filters                    |
| `/api/profile/[userId]/climbs/detail`  | GET             | Single climb detail by S3 key                                         |
| `/api/profile/[userId]/climbs/attempt` | GET             | Full run data (pose frames) or route photo, cross-user (prefix-gated) |
| `/api/profile/[userId]/pins`           | GET             | GPS pins for a user's climbs (map view)                               |
| `/api/profile/follow`                  | GET/POST/DELETE | List/add/remove followed users                                        |
| `/api/profile/search`                  | GET             | Search users by name or email                                         |

## Stack

| Concern         | Library                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Framework       | Next.js 16 App Router                                                                                  |
| Language        | TypeScript (strict)                                                                                    |
| Styling         | Tailwind CSS v4                                                                                        |
| Authentication  | Firebase Auth (email/password, session cookies)                                                        |
| Pose detection  | MediaPipe Pose Landmarker (Lite / Full / Heavy, GPU delegate)                                          |
| Computer vision | OpenCV.js 4.12 (WASM, main thread)                                                                     |
| Video encoding  | MediaRecorder API (WebM)                                                                               |
| Maps            | Leaflet + react-leaflet, MapTiler Outdoor (preferred) with OpenTopoMap fallback, leaflet.markercluster |
| Geocoding       | Nominatim (OpenStreetMap, no API key required)                                                         |
| Photo cropping  | react-image-crop (circular crop, canvas output)                                                        |
| Testing         | Vitest + jsdom + Testing Library                                                                       |

## Development

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>.

### Landing replay

The landing hero plays a curated playlist of replay clips from
`public/landing-replay.json` — one static asset every visitor sees, played in
file order. Each clip runs four fixed phases: the ORB starfield with the
video-space skeleton, the matched wall features emerging, the route photo rising
while points and skeleton morph into its space, and the finished route overlay
standing alone. The hero draws no holds — they are a secondary feature, and a
ring lighting up mid-morph competes with the skeleton arriving on the wall. Items
still carry them, so re-enabling is a call to `drawHolds`, not a re-curation.

A clip captures **20 seconds** of climbing and the hero spends **12 seconds**
showing it, so the figure plays back at ~1.7× — enough of the ascent to read as a
climb rather than a fragment. That speed-up is free in fidelity terms: pose
detection runs at 2 Hz and the stored track is bone-space interpolated up from
there, so replaying above 1× discards nothing that was ever measured. Each item
carries its own captured `duration`, so the rate is per item; screen time stays
at 12s because the phase windows are fractions of it and the phase-3 morph starts
to drag much past that.

Each clip may also carry a **wall still** — an uncropped frame lifted from the
run's own video, sharing its coordinate space. The hero opens on the dark stage,
raises that still behind the skeleton, and ignites the ORB starfield on it. The
still then recedes to black for the x-ray beat, where the wall exists only as
matched ORB points travelling into route-photo space; the route photo itself
rises late and eased beneath them, so it never covers the migration it explains.
That black gap is bounded on purpose — long enough to read the points moving,
short enough that the real wall is still in mind when the photo answers it. The still is optional: a clip
authored without one opens on the dark stage instead. The stage takes its shape
from the first item's source plane, so landscape footage is not letterboxed into
a portrait frame, and it holds that shape for the whole playlist so a handoff
never reflows the layout.

Cycling is deliberately thin. Items play in **array order** — reordering means
editing the file — and the playlist is read up to five items. Each item runs its
full window and hands off with a 300 ms crossfade in which the outgoing clip
holds its finished route overlay while the next one opens on its starfield; after
the last item the cycle wraps to the first and continues indefinitely. Phases,
cycling and handoff all run off one clock, so the single pause/play control (and
scrolling offscreen, and hiding the tab) freezes and resumes everything together.
Reduced motion starts parked on the first clip's finished route overlay and stays
there until the visitor presses play.

#### Authoring a clip

Clips are authored by the maintainer on the unlinked development-only route
`/dev/landing-clip`:

1. Pick a saved Fixed-Capture run (panning captures, runs with no reference ORB
   features, and pose tracks shorter than the 20s window are rejected with a
   notice).
2. Choose the 20-second window with the slider, checking the endpoint thumbnails
   and segment playback (which runs at the hero's playback rate, not real time).
3. Optionally attach the wall still — an uncropped frame of the same video. The
   route is warned if its aspect does not match the video's, because a cropped
   still puts the skeleton in the wrong place.
4. Attach the route photo and let the existing ORB match run; export unlocks only
   once alignment succeeds.
5. Download the `{ version: 1, items: [ … ] }` file. Poses export at 5 Hz with
   landmarks encoded as `[index, x, y, score]`, which keeps a 20s clip lighter
   than the original 8s one.

Then save it as `public/landing-replay.json` — or, for more than one clip,
concatenate the `items` arrays by hand in the order you want them played — and
commit it. **A downloaded export is not live until it is at that path**; the hero
fetches `/landing-replay.json` and nothing else. Nothing is
written to the repo or to S3 from the UI, so **rollback is reverting that one
file** (`git revert` the commit, or `git checkout <sha> -- public/landing-replay.json`).

The exported item is pure geometry (both coordinate spaces baked, labels only —
no identity, notes, coordinates, keys, descriptors, or homography), so the hero
only lerps and crossfades: no OpenCV, no MediaPipe, no homography at runtime.
`__tests__/pipeline/landingReplayAsset.test.ts` re-checks that content surface
against the checked-in file whenever one is present. If the asset is missing, or
every item in it fails the runtime guard, the hero renders nothing and the page
degrades to its text content.

## Code quality

```powershell
npx tsc --noEmit        # type-check
npx vitest run          # unit tests
npx vitest run --coverage
npx eslint .
```

## Project structure

```
pipeline/   Framework-agnostic processing modules (no React)
hooks/      React hooks wiring pipeline modules to UI state
storage/    In-memory session store (swappable backend); exports RunType
components/ UI components grouped by kind/feature (ui, layout, skeleton, capture, run, scan, compare, route, routes, map)
app/        Next.js App Router pages and layout
app/api/s3/ S3 route handlers (put, get, list, delete) + shared utilities
workers/    Legacy Web Worker files (kept for reference)
utils/      Shared constants and helpers (poseConstants, cvHelpers, fsHelpers)
__tests__/  Unit tests (mirror source tree)
public/     Static assets (opencv.js + local MediaPipe pose .task models)
```

See [docs](/docs) inside the running app for a full usage guide.

## Deploy on Vercel

Deployments are handled by **Vercel's native GitHub integration** — every push
to `main` triggers a production deploy automatically.

The `buildCommand` in `vercel.json` runs `npm run setup:assets` before
`next build` so the gitignored `public/opencv.js` and local MediaPipe pose
model files are always present in the production bundle.

### Required Vercel environment variables

Set these in the Vercel dashboard (Project → Settings → Environment Variables)
for the **Production** environment:

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
S3_BUCKET_NAME
```

### CI (GitHub Actions)

`.github/workflows/ci.yml` runs type-check (`tsc --noEmit`), Vitest, and
ESLint on every push and pull request. Vercel deploys in parallel — if CI
fails, the deploy should be cancelled via the Vercel dashboard.
