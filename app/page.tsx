"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

function DemoPreview() {
  return (
    <div className="relative w-full max-w-sm overflow-hidden rounded-1xl border border-edge/60 bg-card shadow-2xl shadow-black/20">
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
        <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-5xl">
          Route Scanner
        </h1>
        <p className="text-base text-fg-secondary leading-relaxed max-w-md">
          Scan your climbing runs, extract skeleton poses with MediaPipe, then
          project your movement onto a route photo &#8212; entirely in your browser.
        </p>
        {!loading && !user && (
          <Link
            href="/login"
            className="mt-1 inline-flex items-center gap-2.5 rounded-xl bg-accent px-7 py-3 text-sm font-semibold text-surface shadow-lg shadow-accent/25 transition-all duration-200 hover:bg-accent-hover hover:shadow-accent/35 active:scale-[0.97]"
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
            className="mt-1 inline-flex items-center gap-2.5 rounded-xl bg-accent px-7 py-3 text-sm font-semibold text-surface shadow-lg shadow-accent/25 transition-all duration-200 hover:bg-accent-hover hover:shadow-accent/35 active:scale-[0.97]"
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
        <p className="text-[11px] font-semibold text-fg-muted uppercase tracking-[0.15em]">Live Demo</p>
        <DemoPreview />
        <p className="text-xs text-fg-muted max-w-xs text-center">
          Skeleton overlay video &#8212; an example of what Route Scanner produces
        </p>
      </div>

      {/* How it works */}
      <div className="mt-20 w-full max-w-3xl sm:mt-24">
        <p className="mb-8 text-center text-[11px] font-semibold text-fg-muted uppercase tracking-[0.15em]">
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
            <div
              key={step}
              className="group relative rounded-2xl border border-edge/50 bg-card/70 px-6 py-6 flex flex-col gap-3 transition-all duration-200 hover:bg-card hover:border-edge-hover/60 animate-scan-pulse"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-xs font-bold text-accent">
                {step}
              </div>
              <p className="text-sm font-semibold text-fg">{title}</p>
              <p className="text-[13px] text-fg-secondary leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
