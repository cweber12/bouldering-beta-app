import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Docs — Route Scanner",
  description: "How Route Scanner works: pose detection, ORB matching, and homography.",
};

/**
 * Documentation figure — a captioned screenshot in a letterboxed frame so
 * portrait and landscape captures both sit inside the same 16:9 container.
 */
function Figure({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="mt-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-edge/50 bg-(--color-inset)">
        <Image src={src} alt={alt} fill unoptimized className="object-contain" />
      </div>
      <figcaption className="mt-2 text-sm text-fg-muted leading-relaxed">{caption}</figcaption>
    </figure>
  );
}

export default function DocsPage() {
  return (
    <div className="docs-readable mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="max-w-none">
        {/* ---------------------------------------------------------------- */}
        {/* Title                                                            */}
        {/* ---------------------------------------------------------------- */}
        <h1 className="text-xl font-bold tracking-tight text-fg sm:text-2xl">
          Documentation
        </h1>
          <p className="mt-3 text-base text-fg-secondary leading-relaxed">
          Route Scanner turns a single climbing video into an annotated route map. It estimates
          the climber&apos;s skeleton frame-by-frame, infers which holds the hands and feet used,
          and reprojects both onto a photo of the route using computer-vision feature matching.
          Every stage runs locally in your browser; processed runs can be saved to Amazon S3 for
          access across devices, or exported as local JSON files.
        </p>

        {/* ---------------------------------------------------------------- */}
        {/* Overview                                                         */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-fg">How it works</h2>
          <p className="mt-3 text-base text-fg-secondary leading-relaxed">
            The pipeline runs entirely client-side and transforms raw footage into a
            route-aligned overlay in five stages.
          </p>

          <ol className="mt-6 flex flex-col gap-8 pl-5 list-decimal leading-relaxed text-fg-secondary marker:font-semibold marker:text-fg">
            <li>
              <strong className="text-fg">Pose estimation.</strong> The app samples a frame
              roughly every 100&nbsp;ms and runs{" "}
              <span className="font-mono text-fg">MediaPipe Pose Landmarker</span> to locate 33
              BlazePose keypoints per frame. A crop window locks onto the climber you tapped and
              follows them frame-to-frame, so a small-in-frame subject still resolves cleanly, and
              the sparse detections are interpolated and smoothed into a continuous pose timeline.
              <Figure
                src="/docs/skeleton-holds.jpg"
                alt="Climbing video frame with the estimated skeleton drawn in green and inferred holds ringed in blue and orange"
                caption="The estimated skeleton (green) tracked across the video, with inferred hand and foot holds ringed on the wall."
              />
            </li>
            <li>
              <strong className="text-fg">Detection framing.</strong> On the Scan page you tap the
              climber on the first frame. Two nested boxes then appear and can be dragged: an inner{" "}
              <em>Climber</em> box — derived from the climber&apos;s landmarks — that seeds tracking
              and the automatic lighting analysis, and an outer <em>Route</em> box that bounds the
              wall texture used for matching. The Route always contains the Climber, and its lower
              edge trims the ground and crash pad that would otherwise pollute feature matching.
              <Figure
                src="/docs/detection-crops.jpg"
                alt="Scan page detection step showing a large outer Route crop box and a smaller nested Climber crop box over the boulder"
                caption="The nested Climber (inner) and Route (outer) crop boxes on the detection step."
              />
            </li>
            <li>
              <strong className="text-fg">Feature extraction.</strong> ORB (Oriented FAST and
              Rotated BRIEF) descriptors are sampled from the wall inside the Route box. These encode
              the rock&apos;s texture as a fingerprint that can be recognised in a separate photo. When
              the camera pans during the climb, features are gathered across several keyframes so the
              whole wall stays represented.
              <Figure
                src="/docs/orb-features.jpg"
                alt="Video frame overlaid with red ORB feature points densely covering the boulder's textured face"
                caption="ORB feature points (red) sampled from the wall texture inside the Route box."
              />
            </li>
            <li>
              <strong className="text-fg">Route-photo matching.</strong> You upload a photo of the
              same wall. ORB features from the photo are matched against the video features, and a
              homography — a perspective transform — is fitted with RANSAC to map any point from
              video space into the photo.
              <Figure
                src="/docs/route-photo.jpg"
                alt="A clean photo of the boulder route shot from a similar angle, ready to receive the overlay"
                caption="The uploaded route photo. Shots taken from a similar angle to the video match most reliably."
              />
            </li>
            <li>
              <strong className="text-fg">Reprojection &amp; overlay.</strong> Every skeleton frame
              is reprojected through the homography onto the route photo. The app also infers which
              holds the hands and feet used — from how long each limb dwells at a fixed point on the
              wall — and marks them with thin rings (blue for hands, orange for feet) that reveal in
              the order they were first used. The finished sequence renders to a WebM video you can
              download.
              <Figure
                src="/docs/pose-overlay.jpg"
                alt="Route photo with the reprojected skeleton and blue and orange hold rings tracing the climb"
                caption="The reprojected skeleton and hold rings composited onto the route photo — the exported result."
              />
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
            <div className="border-l-2 border-edge/40 px-4 py-2">
              <p className="text-sm font-semibold text-fg">1. Prepare your footage</p>
              <p className="mt-1.5 text-base text-fg-secondary leading-relaxed">
                Film your climbing run in portrait or landscape — either works. The camera
                should be stationary and include the entire wall section. For distant or
                small-in-frame climbers, zoom in as much as possible to improve pose accuracy.
              </p>
            </div>

            <div className="border-l-2 border-edge/40 px-4 py-2">
              <p className="text-sm font-semibold text-fg">2. Upload or record your video</p>
              <p className="mt-1.5 text-base text-fg-secondary leading-relaxed">
                On the{" "}
                <Link href="/scan" className="text-fg hover:underline">
                  Scan page
                </Link>
                , choose a video file or record one on the spot with your camera. The video stays
                on your device — nothing is uploaded yet.
              </p>
            </div>

            <div className="border-l-2 border-edge/40 px-4 py-2">
              <p className="text-sm font-semibold text-fg">3. Mark the climber and scan</p>
              <p className="mt-1.5 text-base text-fg-secondary leading-relaxed">
                Tap the climber on the first frame to lock tracking onto them, then drag the
                white <strong className="text-fg">Climber</strong> and amber{" "}
                <strong className="text-fg">Route</strong> boxes to frame the shot. Click{" "}
                <strong className="text-fg">Scan video</strong> to begin — a progress view shows
                the current frame, and processing finishes with the traced climb ready to review.
              </p>
              <p className="mt-2 text-base text-fg-secondary">
                Open the <strong className="text-fg">Settings</strong> popover (gear icon) to
                choose a <strong className="text-fg">detection quality</strong> tier — Fast,
                Balanced, or Accurate (see{" "}
                <a href="#quality" className="text-fg hover:underline">
                  Detection quality
                </a>{" "}
                below). The same popover exposes the pose model, detection frequency, and the{" "}
                <strong className="text-fg">Long route (panning)</strong> toggle for shots where
                the camera pans up the wall.
              </p>
              <p className="mt-2 text-base text-fg-secondary">
                Lighting is handled automatically — there are no manual exposure controls to set
                (see{" "}
                <a href="#lighting" className="text-fg hover:underline">
                  Lighting &amp; preprocessing
                </a>{" "}
                below).
              </p>
            </div>

            <div className="border-l-2 border-edge/40 px-4 py-2">
              <p className="text-sm font-semibold text-fg">
                4. Review and adjust skeleton style (optional)
              </p>
              <p className="mt-1.5 text-base text-fg-secondary leading-relaxed">
                Watch the traced climb on the review step. A{" "}
                <strong className="text-fg">Skeleton style</strong> panel lets you change limb and
                joint colours with the colour pickers and adjust line width and joint radius with
                the sliders. Changes take effect on the next render. From here you can save the
                raw scan or continue to the route photo.
              </p>
            </div>

            <div className="border-l-2 border-edge/40 px-4 py-2">
              <p className="text-sm font-semibold text-fg">
                5. Place on the route photo and export
              </p>
              <p className="mt-1.5 text-base text-fg-secondary leading-relaxed">
                Add a photo of the wall taken from a similar angle. A preliminary match runs
                automatically and frames the climb over the photo; adjust the box if needed, then
                click <strong className="text-fg">Place on route</strong>. The pose overlay renders
                automatically — click <strong className="text-fg">Export video</strong> to download
                it as a <code className="text-fg">.webm</code> file. Aim for at least 10 good ORB
                matches for a stable homography (match statistics appear in Developer view).
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Lighting & preprocessing                                         */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10" id="lighting">
          <h2 className="text-lg font-semibold text-fg">Lighting &amp; preprocessing</h2>
          <p className="mt-3 text-base text-fg-secondary leading-relaxed">
            Lighting is handled automatically — there are no manual exposure or contrast controls.
            When the scan starts, the app analyses the reference frame (measuring exposure,
            contrast, and sharpness inside the Climber and Route boxes) and adapts its
            preprocessing to what it finds, so overexposed, backlit, and low-contrast footage all
            work without any setup.
          </p>

          <p className="mt-3 text-base text-fg-secondary leading-relaxed">
            The two stages of the pipeline are preprocessed for different goals:
          </p>

          <div className="mt-4 overflow-hidden rounded-xl border border-edge/50">
            <table className="w-full text-sm text-left text-fg-secondary">
              <thead className="border-b border-edge/40 bg-card/50">
                <tr>
                  <th className="px-4 py-3 font-medium text-fg">Stage</th>
                  <th className="px-4 py-3 font-medium text-fg">Processing applied</th>
                  <th className="px-4 py-3 font-medium text-fg">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/30">
                <tr>
                  <td className="px-4 py-3">Pose detection</td>
                  <td className="px-4 py-3">Runs on the raw colour frame</td>
                  <td className="px-4 py-3">
                    MediaPipe is trained on colour imagery — grayscale or heavily equalised input
                    hurts keypoint confidence rather than helping it
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Feature matching (ORB)</td>
                  <td className="px-4 py-3 font-mono text-xs text-fg">
                    retinex illumination normalisation + histogram equalisation
                  </td>
                  <td className="px-4 py-3">
                    Removes lighting gradients so wall-texture descriptors stay consistent between
                    the video and a route photo shot under different light; a light unsharp mask is
                    added when the frame is soft
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-base text-fg-secondary leading-relaxed">
            Because the ORB path is normalised independently, a route photo taken in daylight can
            still match a video shot under gym lighting.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Detection quality                                                */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10" id="quality">
          <h2 className="text-lg font-semibold text-fg">Detection quality</h2>
          <p className="mt-3 text-base text-fg-secondary leading-relaxed">
            A single <strong className="text-fg">quality tier</strong> — chosen in the Settings
            popover on the Scan detection step — bundles the low-level detection knobs into one
            Fast / Balanced / Accurate choice. Every tier crops and tracks the climber the same
            way; the tier trades scan speed against pose fidelity.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="border-l-2 border-edge/40 px-4 py-2">
              <p className="text-sm font-semibold text-fg">Fast</p>
              <ul className="mt-2 flex flex-col gap-1.5 pl-4 list-disc text-sm text-fg-secondary">
                <li>Lite model, sparse sampling (every 15th frame).</li>
                <li>Quickest scan; more interpolation between detections.</li>
              </ul>
            </div>

            <div className="border-l-2 border-edge/40 px-4 py-2">
              <p className="text-sm font-semibold text-fg">Balanced <span className="font-normal text-fg-muted">(default)</span></p>
              <ul className="mt-2 flex flex-col gap-1.5 pl-4 list-disc text-sm text-fg-secondary">
                <li>Full model, moderate sampling (every 10th frame).</li>
                <li>Densifies clearly fast segments to catch quick moves.</li>
              </ul>
            </div>

            <div className="border-l-2 border-edge/40 px-4 py-2">
              <p className="text-sm font-semibold text-fg">Accurate</p>
              <ul className="mt-2 flex flex-col gap-1.5 pl-4 list-disc text-sm text-fg-secondary">
                <li>Heavy model, dense sampling (every 5th frame).</li>
                <li>Cleanest trajectory; slowest to process.</li>
              </ul>
            </div>
          </div>

          <p className="mt-4 text-base text-fg-secondary leading-relaxed">
            <strong className="text-fg">Detection frequency (frame step)</strong> — how often
            full pose detection runs, overridable in the same popover (1–30). A step of 1 runs pose
            on every sampled frame (most accurate, slowest); a step of 10 runs it every 10th frame
            and fills the rest by interpolation. Between detected anchors the pipeline
            automatically re-samples segments where the climber moves quickly, so fast moves stay
            sharp even at a coarse step.
          </p>
          <p className="mt-3 text-base text-fg-secondary leading-relaxed">
            <strong className="text-fg">Smoothing</strong> — after interpolation a One-Euro
            adaptive filter is applied over every keypoint track. Brief dropouts (frames where a
            joint was not detected) are filled in first. The filter smooths harder when a joint is
            nearly still and eases off during fast motion, cutting skeletal jitter in the final
            overlay without adding noticeable lag.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Privacy                                                           */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-fg">Privacy &amp; data storage</h2>
          <p className="mt-3 text-base text-fg-secondary leading-relaxed">
            All processing — video decoding, pose inference, ORB feature extraction, homography
            computation, and video rendering — happens locally in your browser.{" "}
            <strong className="text-fg">
              No video frames or images are sent to any server.
            </strong>
          </p>
          <p className="mt-2 text-base text-fg-secondary leading-relaxed">
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
            <details className="group rounded-md border border-edge/50 bg-surface/35">
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

            <details className="group rounded-md border border-edge/50 bg-surface/35">
              <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-medium text-fg select-none hover:text-fg transition">
                Processing is very slow
                <svg className="h-4 w-4 text-fg-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
              </summary>
              <div className="px-5 pb-4 pt-1 text-sm text-fg-secondary leading-relaxed">
                MediaPipe requires a browser with WebGL / GPU support. Make
                sure hardware acceleration is enabled in your browser settings. Very long videos
                (over 5 minutes) can take several minutes to process. You can trim to just the
                crux section before uploading, pick the <strong className="text-fg">Fast</strong>{" "}
                quality tier, or increase the detection frequency (frame step) in Settings to skip
                frames between pose detections.
              </div>
            </details>

            <details className="group rounded-md border border-edge/50 bg-surface/35">
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
