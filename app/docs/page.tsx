import Link from "next/link";

export const metadata = {
  title: "Docs — Bouldering Beta",
  description: "How Bouldering Beta works: pose detection, ORB matching, and homography.",
};

export default function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="prose prose-invert prose-zinc max-w-none">
        {/* ---------------------------------------------------------------- */}
        {/* Title                                                            */}
        {/* ---------------------------------------------------------------- */}
        <h1 className="text-3xl font-bold tracking-tight text-zinc-100">
          Documentation
        </h1>
        <p className="mt-3 text-zinc-400 leading-relaxed">
          Bouldering Beta runs entirely in your browser — no account, no server, no uploads.
          It analyses a climbing video by extracting skeleton poses frame-by-frame, then
          overlays the movement onto a route photo using computer vision.
        </p>

        {/* ---------------------------------------------------------------- */}
        {/* Overview                                                         */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-zinc-200">How it works (overview)</h2>
          <ol className="mt-4 flex flex-col gap-3 pl-5 list-decimal text-zinc-400 leading-relaxed">
            <li>
              <strong className="text-zinc-300">Video analysis (Upload page)</strong> — You
              upload a short climbing video. The app samples a frame every 100 ms, runs{" "}
              <span className="font-mono text-zinc-300">MoveNet Lightning</span> on each frame
              to detect 17 body keypoints, and stores the pose timeline.
            </li>
            <li>
              <strong className="text-zinc-300">ORB feature extraction</strong> — After polling
              all frames, ORB (Oriented FAST and Rotated BRIEF) descriptors are extracted from
              the first video frame. These encode the wall&apos;s texture so it can be recognised
              in an external photo later.
            </li>
            <li>
              <strong className="text-zinc-300">Image matching (Match page)</strong> — You
              upload a photo of the same section of wall. ORB features are extracted from it,
              then matched against the video-frame features to find correspondences.
            </li>
            <li>
              <strong className="text-zinc-300">Homography &amp; overlay</strong> — The matched
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
          <h2 className="text-xl font-semibold text-zinc-200">Technology</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full text-sm text-left text-zinc-400">
              <thead className="border-b border-zinc-800 bg-zinc-900">
                <tr>
                  <th className="px-4 py-3 font-medium text-zinc-300">Concern</th>
                  <th className="px-4 py-3 font-medium text-zinc-300">Library</th>
                  <th className="px-4 py-3 font-medium text-zinc-300">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                <tr>
                  <td className="px-4 py-3">Pose detection</td>
                  <td className="px-4 py-3 font-mono text-zinc-300">
                    TF.js 4.22 + MoveNet Lightning
                  </td>
                  <td className="px-4 py-3">WebGL backend, ~5 ms per frame</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Computer vision</td>
                  <td className="px-4 py-3 font-mono text-zinc-300">OpenCV.js 4.12 (WASM)</td>
                  <td className="px-4 py-3">
                    ORB detection, BFMatcher, findHomography (RANSAC)
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Video encoding</td>
                  <td className="px-4 py-3 font-mono text-zinc-300">MediaRecorder API</td>
                  <td className="px-4 py-3">WebM output, no ffmpeg needed</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Framework</td>
                  <td className="px-4 py-3 font-mono text-zinc-300">Next.js 16 App Router</td>
                  <td className="px-4 py-3">All processing is client-side</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Step-by-step guide                                                */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-zinc-200">Step-by-step guide</h2>

          <div className="mt-4 flex flex-col gap-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4">
              <p className="text-sm font-semibold text-zinc-200">1. Prepare your footage</p>
              <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
                Film your climbing attempt in portrait or landscape — either works. The camera
                should be stationary and include the entire wall section. For outdoor climbs,
                zoom in as much as possible to improve pose accuracy.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4">
              <p className="text-sm font-semibold text-zinc-200">2. Choose Indoor or Outdoor</p>
              <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
                On the{" "}
                <Link href="/" className="text-zinc-300 hover:underline">
                  home page
                </Link>{" "}
                select the mode (
                <a href="#modes" className="text-zinc-300 hover:underline">
                  see below
                </a>
                ). This controls how pose detection is applied — indoor uses full-frame detection
                while outdoor crops around the estimated hip position before each inference.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4">
              <p className="text-sm font-semibold text-zinc-200">3. Upload and process the video</p>
              <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
                On the{" "}
                <Link href="/upload" className="text-zinc-300 hover:underline">
                  Upload page
                </Link>
                , click the upload area and select your video. Processing begins automatically.
                A progress bar shows the current frame. When the status banner turns green, ORB
                features are ready.
              </p>
              <p className="mt-2 text-sm text-zinc-400">
                You can optionally save the processed data to your device as a{" "}
                <code className="text-zinc-300">.json</code> file so you can reload it in a
                later session without reprocessing the video.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4">
              <p className="text-sm font-semibold text-zinc-200">
                4. Match a route photo and export
              </p>
              <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
                On the{" "}
                <Link href="/match" className="text-zinc-300 hover:underline">
                  Match page
                </Link>
                , upload a photo of the wall from a similar angle. The match statistics panel
                shows how many ORB correspondences were found. Aim for at least 10 good matches
                for a stable homography. The pose overlay video renders automatically — download
                it as a <code className="text-zinc-300">.webm</code> file.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Indoor vs Outdoor                                                 */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10" id="modes">
          <h2 className="text-xl font-semibold text-zinc-200">Indoor vs Outdoor mode</h2>
          <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
            The primary difference is how pose detection is applied to each video frame.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4">
              <p className="text-sm font-semibold text-zinc-200">Indoor</p>
              <ul className="mt-2 flex flex-col gap-1.5 pl-4 list-disc text-sm text-zinc-400">
                <li>Full-frame pose detection on every sampled frame.</li>
                <li>Climber fills most of the frame — keypoints are easy to detect.</li>
                <li>No crop, no interpolation, fastest processing.</li>
              </ul>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4">
              <p className="text-sm font-semibold text-zinc-200">Outdoor</p>
              <ul className="mt-2 flex flex-col gap-1.5 pl-4 list-disc text-sm text-zinc-400">
                <li>
                  Crops a ±25% window around the previous hip position before each inference.
                </li>
                <li>Pose runs every N-th sampled frame (configurable 1–30).</li>
                <li>
                  Intermediate frames are filled by linear interpolation of the keypoints.
                </li>
                <li>Significantly improves keypoint confidence on small-in-frame climbers.</li>
              </ul>
            </div>
          </div>

          <p className="mt-4 text-sm text-zinc-400 leading-relaxed">
            <strong className="text-zinc-300">Frame step</strong> (outdoor only) — controls how
            often full pose detection runs. A step of 1 runs pose on every sampled frame (most
            accurate, slowest). A step of 10 runs it every 10th frame and interpolates the rest,
            which is faster but smoother rather than precisely tracked. For a first look at an
            attempt, 5–10 is a good starting point.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Privacy                                                           */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-zinc-200">Privacy</h2>
          <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
            All processing — video decoding, pose inference, ORB feature extraction, homography
            computation, and video rendering — happens locally in your browser.{" "}
            <strong className="text-zinc-300">
              No video frames, images, or skeleton data are sent to any server.
            </strong>{" "}
            Saved <code className="text-zinc-300">.json</code> files exist only on your device.
          </p>
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
            The cloud upload and load buttons visible in the app are placeholders for a future
            feature that will require an explicit opt-in. Until then they are disabled.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Troubleshooting                                                   */}
        {/* ---------------------------------------------------------------- */}
        <section className="mt-10 mb-12">
          <h2 className="text-xl font-semibold text-zinc-200">Troubleshooting</h2>
          <div className="mt-4 flex flex-col gap-3">
            <details className="group rounded-xl border border-zinc-800 bg-zinc-900">
              <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-medium text-zinc-300 select-none hover:text-zinc-100 transition">
                The pose overlay looks wrong / skeleton is in the wrong place
                <svg className="h-4 w-4 text-zinc-500 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
              </summary>
              <div className="px-5 pb-4 pt-1 text-sm text-zinc-400 leading-relaxed">
                This usually means too few ORB matches (under 10). Ensure the route photo covers
                the same section of wall visible in the video frame and is shot from a similar
                angle. Photos taken perpendicular to the wall work best. Avoid blurry or very
                dark images.
              </div>
            </details>

            <details className="group rounded-xl border border-zinc-800 bg-zinc-900">
              <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-medium text-zinc-300 select-none hover:text-zinc-100 transition">
                Processing is very slow
                <svg className="h-4 w-4 text-zinc-500 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
              </summary>
              <div className="px-5 pb-4 pt-1 text-sm text-zinc-400 leading-relaxed">
                MoveNet requires a browser with WebGL support. Make sure hardware acceleration is
                enabled in your browser settings. Very long videos (over 5 minutes) can take
                several minutes to process. You can trim to just the crux section before
                uploading. For outdoor mode, increase the frame step to skip frames between pose
                detections.
              </div>
            </details>

            <details className="group rounded-xl border border-zinc-800 bg-zinc-900">
              <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-medium text-zinc-300 select-none hover:text-zinc-100 transition">
                The page is stuck on &ldquo;Loading OpenCV&rdquo; or &ldquo;Loading model&rdquo;
                <svg className="h-4 w-4 text-zinc-500 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
              </summary>
              <div className="px-5 pb-4 pt-1 text-sm text-zinc-400 leading-relaxed">
                OpenCV (~8 MB WASM) and the MoveNet model are loaded fresh each session. A slow
                connection will cause a longer initial wait. Reload the page and wait a few
                seconds. If it persists, check the browser console for network errors — the
                assets may be blocked by a browser extension or firewall.
              </div>
            </details>
          </div>
        </section>
      </div>
    </div>
  );
}
