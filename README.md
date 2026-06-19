# Route Scanner

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
- **Panning Capture** (opt-in "Long route / panning" toggle) — for a longer
  route shot by deliberately panning the camera up the wall. The run stores ORB
  **keyframes** (wall-crop features sampled ~every 0.75 s) and aligns each pan
  section to the route photo independently, so the overlay tracks the wall as
  the camera moves. The photo is the global reference, so the alignment is
  drift-free; in-between frames decompose-interpolate the bracketing keyframe
  homographies. Fast handheld shake is out of scope — use Fixed Capture there.

Each run is classified as an **attempt** (did not top) or a **send** (topped).
Optional **rating** (e.g. "V3") and freeform **notes** can be attached to any run.

## Pipeline

### Pose estimation

The scan/upload pages expose a single **Fast / Balanced / Accurate** quality
tier as the primary detection control (`utils/poseTiers.ts`). Each tier resolves
to a config bundle that drives the **MediaPipe Pose Landmarker** (33 BlazePose
keypoints including hands and feet):

| Tier | Model variant | maxPoses | frameStep | Gap-recovery frames | Filter tolerance |
| --- | --- | --- | --- | --- | --- |
| Fast | Lite | 2 | 15 | 15 | 4 |
| Balanced (default) | Full | 3 | 10 | 30 | 3 |
| Accurate | Heavy | 4 | 5 | 45 | 2 |

An **Advanced** panel still overrides the individual model variant and frame
step (detection stride) for power users; the tier remains the source of truth
for `maxPoses`, gap-recovery aggressiveness, and the landmark-filter tolerance.

The landmarker runs in **multi-pose** mode so the pipeline can tell the climber
apart from bystanders. A **climber-identity tracker** (`pipeline/climberTracker.ts`)
seeds identity from a tap on the climber in the first frame (or the strongest
pose), then on each frame selects the detected pose whose torso centroid is
nearest the velocity-predicted position — rejecting anyone outside a distance
gate, so a passerby never steals the track. The per-frame detection crop is
derived **automatically** from the climber's landmarks; if the climber is lost
inside the crop, detection widens to the full frame and re-acquires by identity.

After estimation, four post-processing passes are applied:

1. **Interpolation** — `interpolatePoseFrames` densifies the sparse detected frames onto the full timestamp list, interpolating each joint along its own detection timeline (Catmull-Rom). A joint occluded longer than the bridge gap is omitted rather than stretched in a straight line.
2. **Estimation** — `estimateMissingLandmarks` fills short gaps using temporal interpolation and skeletal bone-vector geometry.
3. **Persistent-gap fill** — `fillPersistentGaps` is the no-gap guarantee: any joint the detector saw both before and after a frame is always present in that frame (structurally off a visible neighbour where possible, else temporal lerp), at a dimmed confidence. This stops an occluded limb from winking out across a dropout too long to bridge or too degraded to estimate.
4. **Smoothing** — `smoothPoseFrames` runs a zero-phase (forward + backward) One-Euro adaptive filter that suppresses jitter without lag.

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
width) so the overlay looks the same at any photo resolution. The Overlay panel
(rows: Silhouette / Lines / Joints, each with a visibility toggle, colour, and
unitless sliders, plus a Holds row) feeds the live preview and the WebM render.

### Holds overlay

A third overlay pass, **Holds**, marks where the climber's hands and feet were
used on the wall — numbered in the order they were first used, Hand Holds cyan
and Foot Holds orange. Each marker is a translucent **hand / foot glyph** of the
limb that used it (borderless, with a soft colour glow) that marks the spot
without covering it; the number is set off to the side as black-on-white,
tethered by a leader line. Numbers are pushed to the route's **outer** side —
Holds left of the holds' mean x get labels further left, those to the right get
labels further right — so the digits sit clear of the holds, and labels are
placed in first-use order so they never overlap each other or a glyph. Each
glyph's left / right orientation follows the same mean-x split (the detected Hold
carries only its kind, not which hand or foot used it).
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
legible on top), caching the greedy label layout per reveal so playback stays
cheap; they are toggled independently from the Overlay panel's Holds row. The
auto-rendered WebM stays pose-only (static, so a baked-in Holds layer could not
be toggled off).

## Pages

| Route | Purpose | Auth required |
|---|---|---|
| `/` | Landing page — choose Indoor or Outdoor mode | No |
| `/login` | Sign in / sign up with email & password | No |
| `/scan` | Scan a climbing video, preview landmarks, optionally overlay on a route photo | Yes |
| `/compare` | Climb console — open one climb (single view) or compare 2–4 runs side-by-side/overlaid, with route-photo matching and per-climb start-time alignment | Yes |
| `/profile` | View own profile with 4×4 climb grid, filters, list/map toggle; click any climb card or map pin for full detail modal; edit mode for profile fields, search & follow | Yes |
| `/profile/[userId]` | View another user's public profile with 4×4 climb grid, filters, list/map toggle; click any climb card or map pin for full detail modal | Yes |
| `/docs` | Usage guide | No |

## Interactive crop boxes

Before processing, each upload and image-match workflow shows an interactive
crop box overlay. Drag the interior to move the box and drag any of the 8
handles to resize it.

**Mark detection — two targets:**

| Target | Purpose |
|---|---|
| Climber | Pose detection window. **Tap the climber** to lock detection onto them; the box is then derived automatically and follows their full body each frame. Dragging the box is still available as a manual override. |
| Route | Feature-matching region on the first video frame. Frame only the route and the connected face to line the climb up with the route photo. |

Click **Scan video** after marking the climber and the route.

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
  blocking. Quality tier, pose model, sampling stride, the **Long route
  (panning)** toggle, and the **Developer view** switch live in a single
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

Drag the overlay on the uploaded route photo before clicking **Place on route**.
The ORB features are extracted only from the cropped region; keypoints are
offset back to full-image coordinates automatically, so homography computation
is unaffected.

On the **Compare** page, all climbs for a route sit under one grouped surface.
Each climb shows a clean metadata line (colour swatch · date · time · a green
send / amber attempt dot); the route grade is accented in the page header. Each
climb keeps its identity colour. Use **Set start** on each side-by-side climb to
flag the frame its sequence begins, then **Play all** runs every climb from its
own start in sync. (In the overlaid view the translucent Silhouette is suppressed
so several climbers' skeletons stay legible.)

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
  **Leaflet** map with an **OpenTopoMap** tile layer (topo contours + hiking trails)
  where the user can click or drag a pin to select a precise climb location.

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
  256 × 256 px maximum before being stored as a data URL.

### Environment variables

| Variable | Purpose | Example |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase web API key | — |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase auth domain | `project.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID | `route-scanner-xxxxx` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket | `project.firebasestorage.app` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID | — |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase app ID | — |
| `FIREBASE_PROJECT_ID` | Firebase project ID (Admin SDK, server-side) | — |
| `FIREBASE_CLIENT_EMAIL` | Service account client email (server-side) | — |
| `FIREBASE_PRIVATE_KEY` | Service account private key (server-side) | — |
| `AWS_REGION` | S3 bucket region | `us-east-2` |
| `AWS_ACCESS_KEY_ID` | IAM access key | — |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key | — |
| `S3_BUCKET_NAME` | Bucket name | `route-renderer-bucket` |
| `S3_KEY_PREFIX` | Key prefix (default `RouteData`) | `RouteData` |

Create a `.env.local` file with these values. **Never commit credentials.**

The Firebase Admin private key can be downloaded from the Firebase console:
**Project Settings → Service Accounts → Generate new private key**.

### API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/s3/put` | POST | Upload run JSON |
| `/api/s3/get` | GET | Download run JSON by key |
| `/api/s3/list` | GET | List objects/prefixes (pagination, delimiter) |
| `/api/s3/delete` | DELETE | Remove a run |
| `/api/auth/session` | POST/DELETE | Create/destroy Firebase session cookie |
| `/api/profile` | GET/PUT | Read/update own profile |
| `/api/profile/[userId]` | GET | Read any user's public profile |
| `/api/profile/[userId]/climbs` | GET | List any user's climbs (raw S3 keys) |
| `/api/profile/[userId]/climbs/page` | GET | Paginated climb summaries with thumbnails, filters |
| `/api/profile/[userId]/climbs/detail` | GET | Single climb detail by S3 key |
| `/api/profile/[userId]/pins` | GET | GPS pins for a user's climbs (map view) |
| `/api/profile/follow` | GET/POST/DELETE | List/add/remove followed users |
| `/api/profile/search` | GET | Search users by name or email |

## Stack

| Concern | Library |
|---|---|
| Framework | Next.js 16 App Router |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| Authentication | Firebase Auth (email/password, session cookies) |
| Pose detection | MediaPipe Pose Landmarker (Lite / Full / Heavy, GPU delegate) |
| Computer vision | OpenCV.js 4.12 (WASM, main thread) |
| Video encoding | MediaRecorder API (WebM) |
| Maps | Leaflet + react-leaflet, OpenTopoMap tiles, leaflet.markercluster |
| Geocoding | Nominatim (OpenStreetMap, no API key required) |
| Photo cropping | react-image-crop (circular crop, canvas output) |
| Testing | Vitest + jsdom + Testing Library |

## Development

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>.

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


