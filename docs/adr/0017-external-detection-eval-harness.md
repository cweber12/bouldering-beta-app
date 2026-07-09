# External detection eval harness over a downloaded test corpus

## Status

accepted

Extends ADR 0006 (dev-local detection diagnostics). Reuses its **Scan
Diagnostics** record and its `NODE_ENV === "development"` gating; adds a second,
external sink for a downloaded **Test Video** corpus.

## Context

ADR 0006 answers "what drives detection quality?" from the developer's *own*
scans, written as local JSONL. That corpus is small, unlabelled, and reflects
only whatever the developer happened to record. To steer tuning we want a
**labelled** corpus we can re-run whenever detection logic changes and watch the
numbers move.

A separate downloader program already supplies exactly that. It fetches climbing
videos and writes a per-video bundle — a `metadata.json` carrying human-labelled
conditions (`route_orientation`, `shadows`, `climber_contrast`, `camera_angle`,
…), a `final_frame.png`, and a `detections/` folder — and exposes
`POST /api/detections`, which appends one timestamped `pose`/`orb` pair per call
into a video's bundle (it never overwrites; `pose` and `orb` are opaque JSON).
See **Test Video**, **Scan Setup** in CONTEXT.md.

Three forces shape the design:

- **The pipeline is browser-bound.** MediaPipe (GPU delegate) and OpenCV WASM
  (synchronous, main thread) do not run headless in Node or in a worker
  (AGENTS.md). So "run detection on a Test Video" must happen in a browser page,
  as `/dev/orb-bench` already does — a video at an absolute path in another
  program's folder has to physically reach a browser tab.
- **A scan needs manual inputs.** A real scan is interactive: the **User** taps
  to seed **Climber Identity**, adjusts the **Climber Crop** and **Wall Crop**,
  and sets **Fixed**/**Panning Capture**. Uncontrolled videos contain
  **Bystanders**, so an auto-seed can silently follow the wrong person. Those
  inputs must be captured once and replayed deterministically, or a re-run's
  quality change is unattributable.
- **There is no Route Photo in a bundle.** The ORB path is a *matching*
  pipeline; a bundle only has `final_frame.png` (same camera). Per the ORB match
  diagnosis, cross-viewpoint mismatches do not respond to ORB tuning while
  same-viewpoint preprocessing changes do — so capture-time matching adds noise,
  not signal.

## Decision

1. **A dev-only page plus a dev-only beta-scanner proxy.** A new page under
   `app/dev/` lists the corpus and runs detection per video in the browser. A
   dev-only Node route in beta-scanner reads the external `analysis/` root from
   disk (path via env), streams each video to the page, writes `setup.json`, and
   relays detection results to the downloader's `POST /api/detections`
   server-to-server. The downloader's surface stays exactly `/api/detections`;
   no CORS, and no video bytes cross an origin boundary. Everything is gated on
   `NODE_ENV === "development"` and no-ops in production, as in ADR 0006.

2. **A two-phase model: calibrate once, batch-replay forever.** Phase one is a
   manual pass that reuses the production `StepSetDetection` component (it is
   fully props-driven and owns none of the S3 save flow) to set a video's **Scan
   Setup** — `climberCrop`, `wallCrop`, `climberPoint`, the panning flag, and the
   **Quality Tier**. Confirming writes `setup.json` into the bundle **and** fires
   a first detection run. Phase two replays the stored Setup headlessly through
   `useVideoProcessor` whenever detection logic changes, with no human in the
   loop. The Quality Tier is pinned in the Setup (not swept), so setup is held
   constant across re-runs. The batch pass is driven by a **Playwright script**
   (`harness:batch`) that launches headless Chromium against a batch mode of the
   dev page and iterates the calibrated corpus — the pipeline is browser-bound
   (no headless Node), so a terminal/CI-runnable script must drive a real
   browser rather than call the pipeline directly. The batch page exposes a
   machine-readable progress/done signal (a `window` flag / DOM state) the script
   awaits, and skips any Test Video without a `setup.json`.

3. **Payloads reuse the Scan Diagnostics record, routed by source.** One record
   builder. Real dev scans keep appending to local JSONL (ADR 0006, unchanged).
   Test-corpus scans send the same record to the external bundle instead. The
   `pose` payload is the Scan Diagnostics pose metrics plus the sparse detected
   `PoseFrame[]` (dense/smoothed frames are derived, so omitted). The `orb`
   payload is capture-time extraction data only — the **Reference Frame
   Metadata** (keypoint count, region brightness/contrast/sharpness, condition
   flags). No match runs at capture time.

4. **Every run is self-attributing.** Each `pose`/`orb` payload stamps
   `appVersion` (git SHA), the resolved detection config (tier, model variant,
   frame step), and a `setupHash`. A quality shift between two runs is then
   decomposable into new code vs changed config vs edited setup. The labelled
   conditions already sit in the same bundle's `metadata.json`, so they are not
   echoed per run.

## Considered options

1. **Dev page + dev proxy, external bundle as corpus of record** (chosen) —
   keeps the downloader write-only for detections, avoids CORS, and lets Setups
   and results travel with the videos so wiping beta-scanner state loses nothing.
2. **Dev page hits the downloader API directly** — rejected: forces the
   downloader to serve video bytes over HTTP and enable CORS for beta-scanner's
   origin, widening its surface for a single-machine dev tool.
3. **A new `POST /api/setup` on the downloader** — rejected for now: cleaner
   ownership, but the proxy already has disk access to the same folder, so a new
   endpoint buys nothing on one trusted machine.
4. **Keep Setups dev-local in beta-scanner** (keyed by video_key/content hash) —
   rejected: Setups would not travel with the corpus, and the point of the bundle
   is to be the self-contained record for a Test Video.
5. **Auto-seed the Climber (strongest pose), no manual pass** — rejected: a
   Bystander-seeded run is indistinguishable from a good one, silently poisoning
   the corpus. The manual pass makes the seed ground truth and replayable.
6. **Match against `final_frame` at capture time** — deferred: same-viewpoint
   self-match is low-signal. Cross-video matching (one Run's reference vs another
   Run's `final_frame` within the same `route_folder`/**Route**) is the real test
   and is a later phase.

## Consequences

- **beta-scanner writes into another program's folders.** The dev proxy creates
  `setup.json` and relays detection writes into the downloader's `analysis/`
  tree. Acceptable only because both are dev tools on one trusted machine and the
  whole path is `NODE_ENV`-gated; this is not a production capability.
- **Two diagnostics sinks now exist.** Local JSONL (dev scans) and the external
  bundle (test corpus), fed by one record builder and chosen by source. If they
  ever need to diverge in shape, this is the seam to split.
- **The batch pass carries a browser dependency.** `harness:batch` needs headless
  Chromium (Playwright) and the dev server running; it is not a standalone Node
  script and cannot run where a browser/GPU is unavailable. The dev page must keep
  a stable batch-mode contract (URL params + a completion signal) for the driver.
- **The corpus is only as good as its labels and Setups.** A mis-labelled
  `metadata.json` or a Bystander-seeded Setup skews trend analysis; the manual
  pass is the quality gate.
- **Cross-video route matching is unlocked but unbuilt.** Grouping Test Videos by
  `route_folder` (a **Route**) with each `final_frame.png` as a candidate **Route
  Photo** is the intended next phase; the capture-time ORB payload deliberately
  stops short of it.
