# Bouldering Beta

Analyse a climbing attempt entirely in-browser — no account, no server, no uploads.

The app records skeleton poses frame-by-frame from a video using **MoveNet Lightning**
(TF.js WebGL), extracts **ORB reference features** (OpenCV.js WASM) from the first
frame, then overlays the movement onto a static route photo via a perspective
(homography) transform. The output is a downloadable **WebM** video.

## Pages

| Route | Purpose |
|---|---|
| `/` | Choose Indoor or Outdoor mode |
| `/upload` | Upload & process a climbing video |
| `/match` | Match a route photo and download the pose overlay |
| `/compare` | Compare multiple attempts side-by-side or overlaid |

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
storage/    In-memory session store (swappable backend)
components/ Shared UI components (CropBoxOverlay, LoadingGate, …)
app/        Next.js App Router pages and layout
workers/    Legacy Web Worker files (kept for reference)
utils/      Shared constants and helpers
__tests__/  Unit tests (mirror source tree)
public/     Static assets (opencv.js WASM bundle)
```

See [docs](/docs) inside the running app for a full usage guide.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
