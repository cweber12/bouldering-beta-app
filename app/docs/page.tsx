import Link from "next/link";

export const metadata = {
  title: "Docs — Route Scanner",
  description: "How Route Scanner works: pose detection, ORB matching, and homography.",
};

export default function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="prose prose-invert max-w-none">
        {/* ---------------------------------------------------------------- */}
        {/* Title                                                            */}
        {/* ---------------------------------------------------------------- */}
        <h1 className="text-xl font-bold tracking-tight text-fg sm:text-2xl">
          Documentation
        </h1>
        <p className="mt-3 text-[13px] text-fg-secondary leading-relaxed">
          Route Scanner analyses a climbing video by extracting skeleton poses frame-by-frame,
          then overlays the movement onto a route photo using computer vision. Processed runs
          can be saved to Amazon S3 for access across devices, or exported as local JSON files.
        </p>

        {/* ---------------------------------------------------------------- */}
        {/* Overview                                                         */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-fg">How it works (overview)</h2>
          <ol className="mt-4 flex flex-col gap-3 pl-5 list-decimal text-fg-secondary leading-relaxed">
            <li>
              <strong className="text-fg">Video analysis (Scan page)</strong> — You
              upload a short climbing video. The app samples a frame every 100 ms, runs
              the chosen pose model ({" "}
              <span className="font-mono text-fg">MediaPipe Pose Landmarker</span> &mdash; 33 BlazePose keypoints)
              on each frame and stores the pose timeline.
            </li>
            <li>
              <strong className="text-fg">ORB feature extraction</strong> — After polling
              all frames, ORB (Oriented FAST and Rotated BRIEF) descriptors are extracted from
              the first video frame. These encode the wall&apos;s texture so it can be recognised
              in an external photo later.
            </li>
            <li>
              <strong className="text-fg">Image matching (View page)</strong> — You
              upload a photo of the same section of wall. ORB features are extracted from it,
              then matched against the video-frame features to find correspondences.
            </li>
            <li>
              <strong className="text-fg">Homography &amp; overlay</strong> — The matched
              keypoints are used to compute a perspective transform (homography). Each skeleton
              frame is reprojected through this transform onto the route photo and rendered as a
              WebM video that you can download.
            </li>
          </ol>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Tech stack                                                        */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-fg">Technology</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-edge/50">
            <table className="w-full text-sm text-left text-fg-secondary">
              <thead className="border-b border-edge/40 bg-card/50">
                <tr>
                  <th className="px-4 py-3 font-medium text-fg">Concern</th>
                  <th className="px-4 py-3 font-medium text-fg">Library</th>
                  <th className="px-4 py-3 font-medium text-fg">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/30">
                <tr>
                  <td className="px-4 py-3">Pose detection</td>
                  <td className="px-4 py-3 font-mono text-fg">
                    MediaPipe Pose Landmarker (Lite / Full / Heavy)
                  </td>
                  <td className="px-4 py-3">33 BlazePose keypoints inc. hands &amp; feet, GPU delegate</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Computer vision</td>
                  <td className="px-4 py-3 font-mono text-fg">OpenCV.js 4.12 (WASM)</td>
                  <td className="px-4 py-3">
                    ORB detection, BFMatcher, findHomography (RANSAC)
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Video encoding</td>
                  <td className="px-4 py-3 font-mono text-fg">MediaRecorder API</td>
                  <td className="px-4 py-3">WebM output, no ffmpeg needed</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Framework</td>
                  <td className="px-4 py-3 font-mono text-fg">Next.js 16 App Router</td>
                  <td className="px-4 py-3">Client-side processing, server-side API routes</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Cloud storage</td>
                  <td className="px-4 py-3 font-mono text-fg">Amazon S3 (AWS SDK v3)</td>
                  <td className="px-4 py-3">
                    Runs saved under RouteData/state/area/route/
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Step-by-step guide                                                */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-fg">Step-by-step guide</h2>

          <div className="mt-4 flex flex-col gap-4">
            <div className="rounded-2xl border border-edge/50 bg-card/60 px-5 py-4">
              <p className="text-sm font-semibold text-fg">1. Prepare your footage</p>
              <p className="mt-1.5 text-sm text-fg-secondary leading-relaxed">
                Film your climbing run in portrait or landscape — either works. The camera
                should be stationary and include the entire wall section. For outdoor climbs,
                zoom in as much as possible to improve pose accuracy.
              </p>
            </div>

            <div className="rounded-2xl border border-edge/50 bg-card/60 px-5 py-4">
              <p className="text-sm font-semibold text-fg">2. Choose Indoor or Outdoor</p>
              <p className="mt-1.5 text-sm text-fg-secondary leading-relaxed">
                On the{" "}
                <Link href="/" className="text-fg hover:underline">
                  home page
                </Link>{" "}
                select the mode (
                <a href="#modes" className="text-fg hover:underline">
                  see below
                </a>
                ). This controls how pose detection is applied — indoor uses full-frame detection
                while outdoor crops around the estimated hip position before each inference.
              </p>
            </div>

            <div className="rounded-2xl border border-edge/50 bg-card/60 px-5 py-4">
              <p className="text-sm font-semibold text-fg">3. Upload and process the video</p>
              <p className="mt-1.5 text-sm text-fg-secondary leading-relaxed">
                On the{" "}
                <Link href="/upload" className="text-fg hover:underline">
                  Scan page
                </Link>
                , click the upload area and select your video. Processing begins automatically.
                A progress bar shows the current frame. When the status banner turns green, ORB
                features are ready.
              </p>
              <p className="mt-2 text-sm text-fg-secondary">
                If lighting conditions are challenging, expand the{" "}
                <strong className="text-fg">Frame adjustments</strong> panel and select
                the conditions that apply — see{" "}
                <a href="#lighting" className="text-fg hover:underline">
                  Lighting &amp; preprocessing
                </a>{" "}
                below.
              </p>
              <p className="mt-2 text-sm text-fg-secondary">
                You can optionally save the processed data to your device as a{" "}
                <code className="text-fg">.json</code> file so you can reload it in a
                later session without reprocessing the video.
              </p>
            </div>

            <div className="rounded-2xl border border-edge/50 bg-card/60 px-5 py-4">
              <p className="text-sm font-semibold text-fg">
                4. Adjust skeleton style (optional)
              </p>
              <p className="mt-1.5 text-sm text-fg-secondary leading-relaxed">
                On the View page a <strong className="text-fg">Skeleton style</strong>{" "}
                panel appears once matching completes. Use the colour pickers to change limb and
                joint colours. Use the sliders to adjust line width and joint radius. Changes
                take effect on the next render — click{" "}
                <strong className="text-fg">Apply &amp; Match</strong> again to re-export
                with updated styles.
              </p>
            </div>

            <div className="rounded-2xl border border-edge/50 bg-card/60 px-5 py-4">
              <p className="text-sm font-semibold text-fg">
                5. Match a route photo and export
              </p>
              <p className="mt-1.5 text-sm text-fg-secondary leading-relaxed">
                On the{" "}
                <Link href="/match" className="text-fg hover:underline">
                  View page
                </Link>
                , upload a photo of the wall from a similar angle. The match statistics panel
                shows how many ORB correspondences were found. Aim for at least 10 good matches
                for a stable homography. The pose overlay video renders automatically — download
                it as a <code className="text-fg">.webm</code> file.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Lighting & preprocessing                                         */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10" id="lighting">
          <h2 className="text-lg font-semibold text-fg">Lighting &amp; preprocessing</h2>
          <p className="mt-3 text-sm text-fg-secondary leading-relaxed">
            Pose detection is sensitive to contrast and sharpness. When lighting conditions
            are poor, selecting the matching conditions on the Scan page causes each frame
            to be preprocessed before being sent to the pose model. This does{" "}
            <strong className="text-fg">not</strong> affect the ORB background crop —
            ORB feature matching uses pixel normalisation (histogram equalisation) independently
            to keep descriptor gradients consistent between the video and the uploaded photo.
          </p>

          <div className="mt-4 overflow-hidden rounded-xl border border-edge/50">
            <table className="w-full text-sm text-left text-fg-secondary">
              <thead className="border-b border-edge/40 bg-card/50">
                <tr>
                  <th className="px-4 py-3 font-medium text-fg">Condition</th>
                  <th className="px-4 py-3 font-medium text-fg">Processing applied</th>
                  <th className="px-4 py-3 font-medium text-fg">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/30">
                <tr>
                  <td className="px-4 py-3">Washed out</td>
                  <td className="px-4 py-3 font-mono text-xs text-fg">equalizeHist blend (40 %)</td>
                  <td className="px-4 py-3">Restores global contrast in overexposed regions</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Backlit</td>
                  <td className="px-4 py-3 font-mono text-xs text-fg">equalizeHist blend + gamma γ=1.4</td>
                  <td className="px-4 py-3">Improves contrast then lifts midtones to reduce silhouette effect</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Deep shadows</td>
                  <td className="px-4 py-3 font-mono text-xs text-fg">equalizeHist blend (60 %)</td>
                  <td className="px-4 py-3">Stronger enhancement for heavily shadowed regions</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Low contrast</td>
                  <td className="px-4 py-3 font-mono text-xs text-fg">equalizeHist blend (40 %)</td>
                  <td className="px-4 py-3">Improves edge separation when climber blends into wall</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Gym lighting</td>
                  <td className="px-4 py-3 font-mono text-xs text-fg">pre-blur (σ=3) + equalizeHist blend (40 %)</td>
                  <td className="px-4 py-3">Evens out large fluorescent hot-spots before boosting contrast</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Dusty / hazy lens</td>
                  <td className="px-4 py-3 font-mono text-xs text-fg">Unsharp mask (σ=1.5)</td>
                  <td className="px-4 py-3">Restores edge clarity lost to lens fog or chalk dust</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-sm text-fg-secondary leading-relaxed">
            Multiple conditions can be combined. When both a contrast-enhancement condition and{" "}
            <em>Dusty lens</em> are selected, sharpening is applied to the contrast-enhanced image.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Indoor vs Outdoor                                                 */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10" id="modes">
          <h2 className="text-lg font-semibold text-fg">Indoor vs Outdoor mode</h2>
          <p className="mt-3 text-sm text-fg-secondary leading-relaxed">
            The primary difference is how pose detection is applied to each video frame.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-edge/50 bg-card/60 px-5 py-4">
              <p className="text-sm font-semibold text-fg">Indoor</p>
              <ul className="mt-2 flex flex-col gap-1.5 pl-4 list-disc text-sm text-fg-secondary">
                <li>Full-frame pose detection on every sampled frame.</li>
                <li>Climber fills most of the frame — keypoints are easy to detect.</li>
                <li>No crop, no interpolation, fastest processing.</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-edge/50 bg-card/60 px-5 py-4">
              <p className="text-sm font-semibold text-fg">Outdoor</p>
              <ul className="mt-2 flex flex-col gap-1.5 pl-4 list-disc text-sm text-fg-secondary">
                <li>
                  Crops a window around the detected hip position before each inference. The
                  window size and starting position are set by the <strong className="text-fg">Climber crop</strong>{" "}
                  box on the Scan page — it is re-centred on the hip each frame.
                </li>
                <li>Pose runs every N-th sampled frame (configurable 1–30).</li>
                <li>
                  Intermediate frames are filled by linear interpolation of the keypoints.
                </li>
                <li>Significantly improves keypoint confidence on small-in-frame climbers.</li>
              </ul>
            </div>
          </div>

          <p className="mt-4 text-sm text-fg-secondary leading-relaxed">
            <strong className="text-fg">Frame step</strong> (outdoor only) — controls how
            often full pose detection runs. A step of 1 runs pose on every sampled frame (most
            accurate, slowest). A step of 10 runs it every 10th frame and interpolates the rest,
            which is faster but smoother rather than precisely tracked. For a first look at an
            attempt, 5–10 is a good starting point.
          </p>
          <p className="mt-3 text-sm text-fg-secondary leading-relaxed">
            <strong className="text-fg">Smoothing</strong> — after interpolation both
            modes apply an exponential moving average (α = 0.3) over every keypoint track.
            Brief dropouts (frames where a joint was not detected) are filled in before
            smoothing. This reduces skeletal jitter in the final overlay video without
            introducing noticeable lag.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Privacy                                                           */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-fg">Privacy &amp; data storage</h2>
          <p className="mt-3 text-sm text-fg-secondary leading-relaxed">
            All processing — video decoding, pose inference, ORB feature extraction, homography
            computation, and video rendering — happens locally in your browser.{" "}
            <strong className="text-fg">
              No video frames or images are sent to any server.
            </strong>
          </p>
          <p className="mt-2 text-sm text-fg-secondary leading-relaxed">
            When you click <strong className="text-fg">Save to cloud</strong>, only the
            processed JSON data (pose keypoints, ORB descriptors, and metadata) is uploaded to
            Amazon S3. The original video and route photo are never uploaded. You can also
            save runs to your local device as <code className="text-fg">.json</code>{" "}
            files using the File System Access API.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Troubleshooting                                                   */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10 mb-12">
          <h2 className="text-lg font-semibold text-fg">Troubleshooting</h2>
          <div className="mt-4 flex flex-col gap-3">
            <details className="group rounded-2xl border border-edge/50 bg-card/60">
              <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-medium text-fg select-none hover:text-fg transition">
                The pose overlay looks wrong / skeleton is in the wrong place
                <svg className="h-4 w-4 text-fg-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
              </summary>
              <div className="px-5 pb-4 pt-1 text-sm text-fg-secondary leading-relaxed">
                This usually means too few ORB matches (under 10). Ensure the route photo covers
                the same section of wall visible in the video frame and is shot from a similar
                angle. Photos taken perpendicular to the wall work best. Avoid blurry or very
                dark images.
              </div>
            </details>

            <details className="group rounded-2xl border border-edge/50 bg-card/60">
              <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-medium text-fg select-none hover:text-fg transition">
                Processing is very slow
                <svg className="h-4 w-4 text-fg-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
              </summary>
              <div className="px-5 pb-4 pt-1 text-sm text-fg-secondary leading-relaxed">
                MediaPipe requires a browser with WebGL / GPU support. Make
                sure hardware acceleration is enabled in your browser settings. Very long videos
                (over 5 minutes) can take several minutes to process. You can trim to just the
                crux section before uploading. For outdoor mode, increase the frame step to skip
                frames between pose detections.
              </div>
            </details>

            <details className="group rounded-2xl border border-edge/50 bg-card/60">
              <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-medium text-fg select-none hover:text-fg transition">
                The page is stuck on &ldquo;Loading OpenCV&rdquo; or &ldquo;Loading model&rdquo;
                <svg className="h-4 w-4 text-fg-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
              </summary>
              <div className="px-5 pb-4 pt-1 text-sm text-fg-secondary leading-relaxed">
                OpenCV (~8 MB WASM) and the pose model are loaded fresh each session. A slow
                connection will cause a longer initial wait. Reload the page and wait a few
                seconds. If it persists, check the browser console for network errors — the
                assets may be blocked by a browser extension or firewall.
              </div>
            </details>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Licensing & attribution                                           */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10 mb-12">
          <h2 className="text-lg font-semibold text-fg">Licensing &amp; attribution</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-edge/50">
            <table className="w-full text-sm text-left text-fg-secondary">
              <thead className="border-b border-edge/40 bg-card/50">
                <tr>
                  <th className="px-4 py-3 font-medium text-fg">Component</th>
                  <th className="px-4 py-3 font-medium text-fg">License</th>
                  <th className="px-4 py-3 font-medium text-fg">Copyright</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/30">
                <tr>
                  <td className="px-4 py-3">
                    <a
                      href="https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker"
                      className="text-fg hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      MediaPipe Pose Landmarker
                    </a>{" "}
                    (models &amp; WASM runtime)
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fg">Apache 2.0</td>
                  <td className="px-4 py-3">&copy; Google LLC</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">
                    <a
                      href="https://opencv.org"
                      className="text-fg hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      OpenCV.js
                    </a>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fg">Apache 2.0</td>
                  <td className="px-4 py-3">&copy; OpenCV team</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
