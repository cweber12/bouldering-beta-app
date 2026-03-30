"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

function DemoPreview() {
  return (
    <div className="w-full max-w-sm overflow-hidden rounded-xl border border-edge bg-card shadow-xl">
      <div className="flex items-center justify-between border-b border-edge bg-inset px-3 py-1.5">
        <span className="text-xs font-mono text-fg-muted">pose-overlay.webm</span>
      </div>
      <video
        src="/run-1774824194693-pose-overlay.webm"
        autoPlay
        loop
        muted
        playsInline
        className="w-full block"
        aria-label="Demo skeleton overlay video"
      />
    </div>
  );
}

export default function Home() {
  const { user, loading } = useAuth();
  return (
    <main className="flex flex-1 flex-col items-center gap-16 px-6 py-16">
      <div className="flex flex-col items-center gap-4 text-center max-w-lg">
        <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-edge bg-card px-3 py-1 text-xs font-medium text-fg-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          All processing runs locally
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-fg">
          Route&nbsp;Renderer
        </h1>
        <p className="text-base text-fg-secondary leading-relaxed">
          Record your bouldering runs, extract skeleton poses with MediaPipe, then
          project your movement onto a route photo &#8212; entirely in your browser.
        </p>
        {!loading && !user && (
          <Link
            href="/login"
            className="mt-2 flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-fg transition hover:bg-accent-hover active:scale-95"
          >
            Sign in to get started
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
              />
            </svg>
          </Link>
        )}
        {!loading && user && (
          <Link
            href="/upload"
            className="mt-2 flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-fg transition hover:bg-accent-hover active:scale-95"
          >
            Get started
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
              />
            </svg>
          </Link>
        )}
      </div>

      <div className="flex flex-col items-center gap-3">
        <p className="text-xs text-fg-muted uppercase tracking-wider">Demo</p>
        <DemoPreview />
        <p className="text-xs text-fg-muted">
          Skeleton overlay &#8212; example of what Route Renderer produces
        </p>
      </div>

      <div className="w-full max-w-2xl">
        <p className="mb-6 text-center text-xs text-fg-muted uppercase tracking-wider">
          How it works
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              step: "1",
              title: "Upload your video",
              body: "MediaPipe Pose Landmarker detects 33 body keypoints on every sampled frame. ORB descriptors are extracted from the first frame as a reference.",
            },
            {
              step: "2",
              title: "Match to route photo",
              body: "Upload a photo of the route. ORB features are matched and a RANSAC homography maps your skeleton coordinates onto the wall photo.",
            },
            {
              step: "3",
              title: "Export the overlay",
              body: "Download a WebM video of your skeleton overlaid on the route photo. Compare multiple runs side by side on the Compare page.",
            },
          ].map(({ step, title, body }) => (
            <div
              key={step}
              className="rounded-xl border border-edge bg-card px-5 py-5 flex flex-col gap-2"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full border border-edge-hover text-xs font-bold text-fg-secondary">
                {step}
              </div>
              <p className="text-sm font-semibold text-fg">{title}</p>
              <p className="text-xs text-fg-secondary leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
