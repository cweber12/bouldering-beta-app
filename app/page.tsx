"use client";

import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import XrayReplayDemo from "@/components/skeleton/XrayReplayDemo";

// ---------------------------------------------------------------------------
// Landing page — the public front door. One scroll answers "what is this?",
// "does it work?", and "how do I start?":
//   Hero (two-column pitch + live x-ray demo) → How it works → Output showcase
//   (real overlay) → Feature highlights → closing CTA → footer.
// Anonymous-friendly: the primary CTA adapts to auth state; the demo renders
// the bundled default for signed-out visitors with zero wait.
// ---------------------------------------------------------------------------

const ArrowIcon = () => (
  <svg
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
  </svg>
);

const STEPS = [
  {
    step: "1",
    title: "Scan your video",
    body: "MediaPipe Pose Landmarker tracks 33 body keypoints on every sampled frame, while ORB descriptors are extracted from the first frame as a wall reference.",
  },
  {
    step: "2",
    title: "Lock to the route photo",
    body: "Upload a photo of the route. ORB features are matched and a RANSAC homography maps your skeleton coordinates onto the wall.",
  },
  {
    step: "3",
    title: "Export the overlay",
    body: "Download a WebM of your skeleton on the route photo, or compare multiple runs side by side on the Compare page.",
  },
] as const;

const FEATURES = [
  {
    title: "Runs in your browser",
    body: "Pose estimation and feature matching execute client-side on WASM — your footage never leaves the device.",
  },
  {
    title: "Finds the climber",
    body: "Multi-person tracking seeds identity from the climber and rejects passers-by, so the skeleton never jumps to a bystander.",
  },
  {
    title: "Route-locked overlay",
    body: "A homography ties every keypoint to the wall photo, so the movement reads against the actual holds — not a floating figure.",
  },
  {
    title: "Compare your runs",
    body: "Overlay two to four attempts on one route to see exactly where the beta diverged between a send and an attempt.",
  },
] as const;

const PIPELINE_TAGS = ["MediaPipe Pose", "OpenCV ORB", "RANSAC homography", "100% client-side"] as const;

export default function Home() {
  const { user, loading } = useAuth();

  const primary = user
    ? { href: "/scan", label: "Get started" }
    : { href: "/login", label: "Sign in to get started" };

  return (
    <main className="flex flex-1 flex-col">
      {/* ─── Hero ─────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:px-8 lg:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          {/* Pitch */}
          <div className="flex flex-col items-start gap-5">
            <span className="text-label font-semibold uppercase tracking-label text-accent">
              Client-side climbing analysis
            </span>
            <h1 className="font-display text-4xl font-bold leading-[1.08] text-fg sm:text-5xl">
              Turn a climbing video into a route-locked movement overlay.
            </h1>
            <p className="max-w-md text-base leading-relaxed text-fg-secondary sm:text-lg">
              Beta Scanner tracks your body through every frame, matches the wall
              from a single photo, and locks your skeleton onto the route — so you
              can study the beta move by move. All in your browser.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {!loading && (
                <Link
                  href={primary.href}
                  className="ui-control-primary inline-flex items-center gap-2.5 rounded-md px-6 py-2.5 text-sm font-semibold"
                >
                  {primary.label}
                  <ArrowIcon />
                </Link>
              )}
              <Link
                href="/docs"
                className="ui-control inline-flex items-center rounded-md px-5 py-2.5 text-sm font-medium text-fg"
              >
                View docs
              </Link>
            </div>

            {/* Pipeline trust line */}
            <ul className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-2">
              {PIPELINE_TAGS.map((tag, i) => (
                <li key={tag} className="flex items-center gap-2">
                  {i > 0 && <span className="h-1 w-1 rounded-full bg-fg-placeholder" aria-hidden="true" />}
                  <span className="font-mono text-label uppercase tracking-label text-fg-muted">{tag}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Live x-ray demo */}
          <div className="flex flex-col items-center gap-3 lg:items-end">
            <div className="w-full">
              <XrayReplayDemo maxHeight="clamp(340px, 62vh, 600px)" />
            </div>
            <p className="text-center text-label uppercase tracking-label text-fg-muted lg:text-right">
              Live replay · ORB feature field + tracked pose
            </p>
          </div>
        </div>
      </section>

      {/* ─── How it works ─────────────────────────────────────────────── */}
      <section className="border-t border-edge/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="mb-10 flex flex-col gap-2">
            <span className="text-label font-semibold uppercase tracking-label text-fg-muted">
              How it works
            </span>
            <h2 className="font-display text-2xl font-bold text-fg sm:text-3xl">
              Three steps, start to overlay.
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {STEPS.map(({ step, title, body }) => (
              <div
                key={step}
                className="flex flex-col gap-3 rounded-lg border border-edge/50 bg-card/40 p-5"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-accent/10 text-sm font-bold text-accent">
                  {step}
                </div>
                <p className="font-display text-base font-semibold text-fg">{title}</p>
                <p className="text-body-sm leading-relaxed text-fg-secondary">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Output showcase ──────────────────────────────────────────── */}
      <section className="border-t border-edge/40 bg-surface-alt">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="flex flex-col gap-4">
              <span className="text-label font-semibold uppercase tracking-label text-accent">
                The payoff
              </span>
              <h2 className="font-display text-2xl font-bold text-fg sm:text-3xl">
                Your movement, mapped onto the real route.
              </h2>
              <p className="max-w-md text-body-sm leading-relaxed text-fg-secondary sm:text-base">
                The skeleton is projected through the homography so it sits on the
                actual wall. Detected holds are ringed by kind — cyan for hands,
                orange for feet — so you can read hand-foot sequence and body
                position against the holds you&apos;ll be pulling on.
              </p>
              <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                <li className="flex items-center gap-2 text-body-sm text-fg-secondary">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "var(--color-hand-hold)" }} aria-hidden="true" />
                  Hand holds
                </li>
                <li className="flex items-center gap-2 text-body-sm text-fg-secondary">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "var(--color-foot-hold)" }} aria-hidden="true" />
                  Foot holds
                </li>
                <li className="flex items-center gap-2 text-body-sm text-fg-secondary">
                  <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
                  Tracked skeleton
                </li>
              </ul>
            </div>

            <figure className="flex flex-col gap-2">
              <div className="relative aspect-1080/616 w-full overflow-hidden rounded-lg border border-edge/60 bg-scan-stage">
                <Image
                  src="/docs/skeleton-holds.jpg"
                  alt="A climber's tracked skeleton and colour-coded hold rings overlaid on a boulder route photo"
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="(min-width: 1024px) 40rem, 100vw"
                />
              </div>
              <figcaption className="text-center text-label uppercase tracking-label text-fg-muted">
                Real export — skeleton + hold overlay on a route photo
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* ─── Feature highlights ───────────────────────────────────────── */}
      <section className="border-t border-edge/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="mb-10 flex flex-col gap-2">
            <span className="text-label font-semibold uppercase tracking-label text-fg-muted">
              What it does
            </span>
            <h2 className="font-display text-2xl font-bold text-fg sm:text-3xl">
              Built for reading beta, not just watching video.
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2">
            {FEATURES.map(({ title, body }) => (
              <div key={title} className="flex gap-4 border-l-2 border-accent/40 pl-4">
                <div className="flex flex-col gap-1.5">
                  <p className="font-display text-base font-semibold text-fg">{title}</p>
                  <p className="text-body-sm leading-relaxed text-fg-secondary">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Closing CTA ──────────────────────────────────────────────── */}
      <section className="border-t border-edge/40 bg-accent/6">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-5 px-4 py-16 text-center sm:px-6 sm:py-20 lg:px-8">
          <h2 className="font-display text-2xl font-bold text-fg sm:text-3xl">
            Ready to scan your project?
          </h2>
          <p className="max-w-md text-body-sm leading-relaxed text-fg-secondary sm:text-base">
            Bring a phone clip and a photo of the route. Everything runs in the
            browser — no upload, no wait.
          </p>
          {!loading && (
            <Link
              href={primary.href}
              className="ui-control-primary mt-1 inline-flex items-center gap-2.5 rounded-md px-6 py-2.5 text-sm font-semibold"
            >
              {primary.label}
              <ArrowIcon />
            </Link>
          )}
        </div>
      </section>

      {/* ─── Footer ───────────────────────────────────────────────────── */}
      <footer className="border-t border-edge/50 bg-surface-alt">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <Image
              src="/climber_scan_logo.svg"
              alt="Beta Scanner"
              width={21}
              height={24}
              unoptimized
              className="h-7 w-auto"
            />
            <span className="font-display text-sm font-semibold text-fg">Beta Scanner</span>
          </div>

          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Footer">
            {user && (
              <>
                <Link href="/scan" className="text-body-sm text-fg-secondary transition-colors hover:text-fg">
                  Scan
                </Link>
                <Link href="/routes" className="text-body-sm text-fg-secondary transition-colors hover:text-fg">
                  Routes
                </Link>
              </>
            )}
            <Link href="/docs" className="text-body-sm text-fg-secondary transition-colors hover:text-fg">
              Docs
            </Link>
            {!loading && !user && (
              <Link href="/login" className="text-body-sm text-fg-secondary transition-colors hover:text-fg">
                Sign in
              </Link>
            )}
          </nav>

          <p className="text-label uppercase tracking-label text-fg-muted">
            © {new Date().getFullYear()} Beta Scanner
          </p>
        </div>
      </footer>
    </main>
  );
}
