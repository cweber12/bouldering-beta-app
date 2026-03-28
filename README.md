# Bouldering Beta

Analyse a climbing run in-browser using **MoveNet Lightning** pose estimation
and **OpenCV.js** ORB feature matching — then save results to **Amazon S3** for
access across devices.

The app records skeleton poses frame-by-frame from a video using MoveNet Lightning
(TF.js WebGL), extracts **ORB reference features** (OpenCV.js WASM) from the first
frame, then overlays the movement onto a static route photo via a perspective
(homography) transform. The output is a downloadable **WebM** video.

Each run is classified as an **attempt** (did not top) or a **send** (topped).
Optional **rating** (e.g. "V3") and freeform **notes** can be attached to any run.

## Pipeline

### Pose estimation

MoveNet Lightning runs on every sampled frame (indoor: every frame; outdoor: configurable stride). After estimation, two post-processing passes are applied:

1. **Interpolation** — for outdoor mode, `interpolatePoseFrames` fills the dense frame timeline from sparse keyframe detections using linear interpolation.
2. **Smoothing** — `smoothPoseFrames` runs on every mode: forward-fill and backward-fill eliminate brief keypoint dropouts, then an exponential moving average (α = 0.3) reduces jitter.

### Skeleton overlay

`drawSkeleton` accepts a `SkeletonStyle` object `{ limbColor, jointColor, lineWidth, pointRadius }` to customise the look of each rendered frame. The match page exposes a style panel (colour pickers + sliders) that feeds into the WebM render.

## Pages

| Route | Purpose | Auth required |
|---|---|---|
| `/` | Landing page — choose Indoor or Outdoor mode | No |
| `/login` | Sign in / sign up with email & password | No |
| `/upload` | Upload & process a climbing video | Yes |
| `/match` | Match a route photo and download the pose overlay | Yes |
| `/compare` | Compare multiple runs side-by-side or overlaid | Yes |
| `/docs` | Usage guide | No |

## Interactive crop boxes

Before processing, each upload and image-match workflow shows an interactive
crop box overlay. Drag the interior to move the box and drag any of the 8
handles to resize it.

**Upload page — two crop modes:**

| Mode | Purpose |
|---|---|
| Climber crop | Pose detection window. In outdoor mode the box dimensions are preserved and re-centred on the detected hip each frame. |
| Route (ORB) crop | ORB feature extraction region on the first video frame. Focus on the wall texture and holds to improve match quality. |

Click **Process video** after setting both crop regions.

**Match / Compare pages:**

Drag the overlay on the uploaded route photo before clicking **Apply & Match**.
The ORB features are extracted only from the cropped region; keypoints are
offset back to full-image coordinates automatically, so homography computation
is unaffected.

## Authentication

User accounts are managed by **Supabase Auth** with cookie-based sessions via
`@supabase/ssr`. Unauthenticated visitors can view the home page and docs;
upload, match, and compare pages require sign-in. The middleware
(`middleware.ts`) refreshes the session on every request and redirects
unauthenticated users to `/login`.

All stored data is scoped per user — S3 keys include the user ID, and every API
route validates that the requesting user owns the data they access.

## Cloud storage (S3)

Processed runs are stored in Amazon S3 under the key prefix
`RouteData/{userId}/{state}/{area}/{route}/run-{timestamp}-{attempt|send}.json`. The
upload, match, and compare pages all feature S3-backed dropdown pickers that
list existing states → areas → routes → runs directly from the bucket.
Attempts are highlighted in amber and sends in emerald throughout the UI.
Legacy `attempt-{timestamp}.json` files are still loadable (treated as attempts).

### Environment variables

| Variable | Purpose | Example |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://xyz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key | — |
| `AWS_REGION` | S3 bucket region | `us-east-2` |
| `AWS_ACCESS_KEY_ID` | IAM access key | — |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key | — |
| `S3_BUCKET_NAME` | Bucket name | `route-renderer-bucket` |
| `S3_KEY_PREFIX` | Key prefix (default `RouteData`) | `RouteData` |

Create a `.env.local` file with these values. **Never commit credentials.**

### API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/s3/put` | POST | Upload run JSON |
| `/api/s3/get` | GET | Download run JSON by key |
| `/api/s3/list` | GET | List objects/prefixes (pagination, delimiter) |
| `/api/s3/delete` | DELETE | Remove a run |

## Stack

| Concern | Library |
|---|---|
| Framework | Next.js 16 App Router |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| Pose detection | TF.js 4.22 + MoveNet Lightning (WebGL) |
| Computer vision | OpenCV.js 4.12 (WASM, main thread) |
| Video encoding | MediaRecorder API (WebM) |
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
components/ Shared UI components (CropBoxOverlay, S3RoutePicker, ComboInput, …)
app/        Next.js App Router pages and layout
app/api/s3/ S3 route handlers (put, get, list, delete) + shared utilities
workers/    Legacy Web Worker files (kept for reference)
utils/      Shared constants and helpers (poseConstants, cvHelpers, fsHelpers)
__tests__/  Unit tests (mirror source tree)
public/     Static assets (opencv.js WASM bundle)
```

See [docs](/docs) inside the running app for a full usage guide.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
