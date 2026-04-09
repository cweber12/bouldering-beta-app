"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import InfoDropdown from "@/components/shared/InfoDropdown";
import ThemeToggle from "@/components/shared/ThemeToggle";

const PUBLIC_TABS = [
  { href: "/docs", label: "Docs" },
] as const;

const AUTH_TABS = [
  { href: "/scan", label: "Scan" },
  { href: "/compare", label: "Compare" },
  { href: "/profile", label: "Saved" },
  { href: "/docs", label: "Docs" },
] as const;

// ---------------------------------------------------------------------------
// Help panel content keyed by pathname
// ---------------------------------------------------------------------------

interface HelpSection {
  title: string;
  bullets: string[];
}

const HELP_CONTENT: Record<string, HelpSection[]> = {
  "/scan": [
    {
      title: "What this page does",
      bullets: [
        "Upload a climbing video and this page analyses it entirely in your browser — nothing is sent to a third-party server.",
        "MediaPipe Pose Landmarker tracks your skeleton joint-by-joint on every sampled frame of the video.",
        "ORB feature matching simultaneously memorises the unique texture of the wall from the first video frame.",
        "The result is a compact .json file you take to the View page to overlay your movement onto a still route photo.",
      ],
    },
    {
      title: "Entering route information",
      bullets: [
        "State / Region, Area, and Route organise saved climbs so they group correctly when loaded on the View and Compare pages.",
        "Set Run type to Attempt if you did not top the route, or Send if you completed it — shown as a coloured badge throughout the app.",
        "Grade / Rating and Notes are optional — add them to help identify and compare climbs later.",
        "All fields can be filled in or changed before or after processing.",
      ],
    },
    {
      title: "Filming and lighting",
      bullets: [
        "Mount the camera on a tripod or fixed surface — any camera movement prevents accurate wall-feature matching.",
        "Keep the entire route and climber visible throughout the clip; nobody should pass between the camera and the climber.",
        "Shoot in consistent, even light — harsh backlight, direct sun, deep shade, or mixed indoor/outdoor light all reduce accuracy.",
        "Overhead gym fluorescents can cast uneven shadows; chalk dust or a fogged lens reduces sharpness — note any issues in Shooting conditions before processing.",
        "Keep the clip short — only the section containing the climb is needed.",
      ],
    },
    {
      title: "Processing, testing, and saving",
      bullets: [
        "After selecting a video, scrub to a representative frame, then drag the Climber crop box around the area the climber moves through and the Background (ORB) crop over the wall texture.",
        "Click Process video. A progress bar shows frames analysed. Processing runs entirely in the browser.",
        "Once complete, click View on route photo to test the skeleton overlay immediately on the View page.",
        "Save the .json to your device or to S3 — it can be reloaded on the View page in any future session without re-processing the video.",
      ],
    },
  ],
  "/match": [
    {
      title: "How does route matching work?",
      bullets: [
        "The app extracts ORB visual features (corner points) from your route photo and matches them against the reference features recorded from the video.",
        "Matching finds pairs of features that appear the same in both images. The best pairs compute a perspective transform that maps the video's coordinate space onto the photo.",
        "Each recorded skeleton keypoint is then projected into the photo using that transform, producing the overlay.",
        "Match quality depends on shared wall texture. Photos taken from a very different angle or distance will reduce accuracy.",
      ],
    },
    {
      title: "How to crop the route photo",
      bullets: [
        "Drag the crop handles to focus on the wall surface — rock texture, holds, and chalk marks are ideal features for matching.",
        "Exclude sky, trees, gear, people, and the floor — these change between sessions and spoil the match.",
        "The crop should roughly correspond to the background (ORB) crop you set on the Scan page.",
        "If matching produces few good matches, try re-cropping to include more distinctive wall texture.",
      ],
    },
  ],
  "/view": [
    {
      title: "Viewing a saved climb",
      bullets: [
        "The route photo and saved crop region are loaded automatically from your S3 storage.",
        "Click 'View Climb' to run ORB matching and overlay your skeleton onto the photo.",
        "If no route photo is saved for this route yet, you can select one from your device.",
        "Use 'Export video' to download a .webm animation of the skeleton overlay.",
      ],
    },
  ],
  "/compare": [
    {
      title: "Comparing multiple climbs",
      bullets: [
        "Load up to 4 climbs and overlay their skeletons onto the same route photo to compare movement and timing.",
        "Side by side mode shows every climb in its own panel — use Play all to sync playback simultaneously.",
        "Overlay mode composites all skeletons onto a single image so you can directly compare body positions frame-by-frame.",
        "Each climb gets a unique colour; adjust using the colour picker next to each slot.",
      ],
    },
    {
      title: "Loading climbs and matching",
      bullets: [
        "First select a route photo, then load each climb slot from your saved S3 data.",
        "Crop the route photo to focus on the wall texture before clicking Apply & View.",
        "All loaded climbs are matched against the same photo — you only need to crop and apply once.",
        "Download individual .webm videos per climb, or a composite overlay video in overlay mode.",
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// NavBar
// ---------------------------------------------------------------------------

export default function NavBar() {
  const path = usePathname();
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [helpOpenPath, setHelpOpenPath] = useState<string | null>(null);
  const helpRef = useRef<HTMLDivElement>(null);

  const tabs = user ? AUTH_TABS : PUBLIC_TABS;
  const helpSections = HELP_CONTENT[path] ?? [];
  const helpOpen = helpOpenPath === path;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [prevPath, setPrevPath] = useState(path);
  if (path !== prevPath) {
    setPrevPath(path);
    setMobileOpen(false);
  }

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setHelpOpenPath(null);
      }
    }
    if (helpOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [helpOpen]);

  async function handleSignOut() {
    await signOut();
    router.push("/");
  }

  return (
    <nav
      className="sticky top-0 z-50 border-b border-edge/60 bg-surface-alt/90 backdrop-blur-xl"
      aria-label="Main navigation"
    >
      <div ref={helpRef} className="relative mx-auto max-w-5xl px-4 sm:px-6">
        <div className="flex h-12 items-center gap-1">
          {/* Brand */}
          <Link href="/" className="mr-4 flex items-center gap-2 py-2 sm:mr-6">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v4a1 1 0 01-1 1H3m18-5v4a1 1 0 001 1h-3M7 21v-4a1 1 0 00-1-1H3m18 5v-4a1 1 0 011-1h-3M12 8v8m-3-5l3-3 3 3" />
              </svg>
            </span>
            <span className="text-sm font-semibold tracking-tight text-fg">
              Route&nbsp;Scanner
            </span>
          </Link>

          {/* Desktop tabs */}
          <div className="hidden items-center gap-0.5 md:flex">
            {tabs.map(tab => {
              const active =
                path === tab.href || path.startsWith(tab.href + "/");
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={[
                    "relative px-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors duration-150",
                    active
                      ? "text-fg bg-card/60"
                      : "text-fg-muted hover:text-fg hover:bg-card/40",
                  ].join(" ")}
                  aria-current={active ? "page" : undefined}
                >
                  {tab.label}
                  {active && (
                    <span className="absolute inset-x-3 -bottom-[13px] h-[2px] rounded-full bg-accent" />
                  )}
                </Link>
              );
            })}

            {/* Help tab -- desktop */}
            {helpSections.length > 0 && (
              <button
                onClick={() => setHelpOpenPath(old => old === path ? null : path)}
                className={[
                  "flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors duration-150",
                  helpOpen
                    ? "text-fg bg-card/60"
                    : "text-fg-muted hover:text-fg hover:bg-card/40",
                ].join(" ")}
                aria-expanded={helpOpen}
              >
                Help
                <svg
                  className={["h-3 w-3 transition-transform duration-200", helpOpen ? "rotate-180" : ""].join(" ")}
                  fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
            )}
          </div>

          {/* Right side — auth + theme toggle + mobile hamburger */}
          <div className="ml-auto flex items-center gap-2">
            {!loading && !user && (
              <Link
                href="/login"
                className="hidden rounded-lg bg-accent/10 px-3.5 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 sm:inline-flex"
              >
                Sign in
              </Link>
            )}
            {!loading && user && (
              <div className="hidden items-center gap-2 sm:flex">
                <span className="truncate max-w-[140px] text-xs text-fg-muted">
                  {user.email}
                </span>
                <button
                  onClick={handleSignOut}
                  className="rounded-lg bg-card/60 px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-card hover:text-fg"
                >
                  Sign out
                </button>
              </div>
            )}

            <ThemeToggle />

            {/* Mobile hamburger */}
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition hover:bg-card/40 hover:text-fg md:hidden"
              onClick={() => setMobileOpen(v => !v)}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="animate-fade-in flex flex-col gap-1 border-t border-edge/40 pb-4 pt-2 md:hidden">
            {tabs.map(tab => {
              const active =
                path === tab.href || path.startsWith(tab.href + "/");
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={[
                    "rounded-lg px-3 py-2 text-sm font-medium transition",
                    active
                      ? "bg-card/60 text-fg"
                      : "text-fg-muted hover:bg-card/40 hover:text-fg",
                  ].join(" ")}
                >
                  {tab.label}
                </Link>
              );
            })}
            {helpSections.length > 0 && (
              <button
                onClick={() => { setHelpOpenPath(old => old === path ? null : path); setMobileOpen(false); }}
                className="rounded-lg px-3 py-2 text-left text-sm font-medium text-fg-muted transition hover:bg-card/40 hover:text-fg"
              >
                Help
              </button>
            )}
            <div className="mt-2 border-t border-edge/40 pt-2">
              {!loading && !user && (
                <Link href="/login" className="block rounded-lg bg-accent/10 px-3 py-2 text-center text-sm font-medium text-accent transition hover:bg-accent/20">
                  Sign in
                </Link>
              )}
              {!loading && user && (
                <div className="flex flex-col gap-2">
                  <span className="truncate px-3 text-xs text-fg-muted">{user.email}</span>
                  <button onClick={handleSignOut} className="rounded-lg bg-card/60 px-3 py-2 text-sm font-medium text-fg-secondary transition hover:bg-card hover:text-fg">
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Help panel dropdown */}
        {helpOpen && helpSections.length > 0 && (
          <div className="animate-fade-in absolute left-0 right-0 top-full z-40 border-b border-edge/60 bg-surface-alt/95 backdrop-blur-xl shadow-2xl">
            <div className="px-4 py-5 sm:px-6 flex flex-col gap-3">
              {helpSections.map(section => (
                <InfoDropdown key={section.title} title={section.title}>
                  <ul className="flex flex-col gap-1.5 pl-4 list-disc">
                    {section.bullets.map((bullet, j) => (
                      <li key={j} className="text-xs text-fg-secondary leading-relaxed">
                        {bullet}
                      </li>
                    ))}
                  </ul>
                </InfoDropdown>
              ))}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

