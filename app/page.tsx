"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

function DemoPreview() {
  return (
    <div className="relative w-full max-w-sm overflow-hidden rounded-md border border-edge/40 bg-surface">
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
    <main className="flex flex-1 flex-col items-center px-4 py-12 sm:px-6 sm:py-20">
      {/* Hero section */}
      <div className="flex flex-col items-center gap-5 text-center max-w-xl">
        {!loading && !user && (
          <Link
            href="/login"
            className="ui-control-primary mt-1 inline-flex items-center gap-2.5 rounded-md px-6 py-2.5 text-sm font-semibold"
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
            href="/scan"
            className="ui-control-primary mt-1 inline-flex items-center gap-2.5 rounded-md px-6 py-2.5 text-sm font-semibold"
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

      {/* Demo */}
      <div className="mt-16 flex flex-col items-center gap-4 sm:mt-20">
        <p className="text-label font-semibold text-fg-muted uppercase tracking-label">Live Demo</p>
        <DemoPreview />
        <p className="text-xs text-fg-muted max-w-xs text-center">
          Skeleton overlay video &#8212; an example of what Route Scanner produces
        </p>
      </div>

      {/* How it works */}
      <div className="mt-20 w-full max-w-3xl sm:mt-24">
        <p className="mb-8 text-center text-label font-semibold text-fg-muted uppercase tracking-label">
          How it works
        </p>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {[
            {
              step: "1",
              title: "Scan your video",
              body: "MediaPipe Pose Landmarker detects 33 body keypoints on every sampled frame. ORB descriptors are extracted from the first frame as a reference.",
            },
            {
              step: "2",
              title: "Lock to route photo",
              body: "Upload a photo of the route. ORB features are matched and a RANSAC homography maps your skeleton coordinates onto the wall photo.",
            },
            {
              step: "3",
              title: "Export the overlay",
              body: "Download a WebM video of your skeleton overlaid on the route photo. Compare multiple runs side by side on the Compare page.",
            },
          ].map(({ step, title, body }) => (
            <div key={step} className="relative flex flex-col gap-3 border-l-2 border-edge/45 pl-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-accent/10 text-xs font-bold text-accent">
                {step}
              </div>
              <p className="text-sm font-semibold text-fg">{title}</p>
              <p className="text-body-sm text-fg-secondary leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
