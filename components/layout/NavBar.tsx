"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/utils/cn";
import { useAuth } from "@/hooks/useAuth";
import { useClickOutside } from "@/hooks/useClickOutside";
import InfoDropdown from "@/components/ui/InfoDropdown";
import ThemeToggle from "@/components/ui/ThemeToggle";
import AccountMenu from "@/components/layout/AccountMenu";

const PUBLIC_LINKS = [
  { href: "/docs", label: "Docs" },
] as const;

const AUTH_LINKS = [
  { href: "/scan", label: "Scan" },
  { href: "/routes", label: "Routes" },
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
        "The result is a compact .json file you open in the climb console to overlay your movement onto a still route photo.",
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
        "Once complete, click View on route photo to test the skeleton overlay immediately in the climb console.",
        "Save the .json to your device or to S3 — it can be reloaded in the climb console in any future session without re-processing the video.",
      ],
    },
  ],
  "/compare": [
    {
      title: "Opening a climb in the console",
      bullets: [
        "Open any saved climb from the Collection page — click the three-dot menu or the Open button in the climb detail view.",
        "The console starts in single-climb view: it loads the route photo, runs ORB matching, and overlays your skeleton onto the photo.",
        "The left rail lists every climb you have on the route. In single view, tapping another climb swaps which one is shown.",
        "Use 'Download .webm' to save an animation of the skeleton overlay.",
      ],
    },
    {
      title: "Comparing multiple climbs",
      bullets: [
        "Click 'Compare Multiple' in the rail header to switch from single view to a 2–4 climb comparison.",
        "Tap climbs in the rail to add them; each gets a distinct colour and a check in its identity colour.",
        "Side by side mode shows every climb in its own panel — use Play all to sync playback simultaneously.",
        "Overlay mode composites all skeletons onto a single image so you can directly compare body positions frame-by-frame.",
      ],
    },
    {
      title: "How does route matching work?",
      bullets: [
        "The app extracts ORB visual features (corner points) from your route photo and matches them against the reference features recorded from the video.",
        "Matching finds pairs of features that appear the same in both images. The best pairs compute a perspective transform that maps the video's coordinate space onto the photo.",
        "Each recorded skeleton keypoint is then projected into the photo using that transform, producing the overlay.",
        "Open Refine to crop the route photo onto the wall surface — rock texture, holds, and chalk marks are ideal features; exclude sky, trees, gear, people, and the floor. All loaded climbs match against the same photo, so you only crop once.",
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

  const links = user ? AUTH_LINKS : PUBLIC_LINKS;
  const helpSections = HELP_CONTENT[path] ?? [];
  const helpOpen = helpOpenPath === path;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [prevPath, setPrevPath] = useState(path);
  if (path !== prevPath) {
    setPrevPath(path);
    setMobileOpen(false);
  }

  // Close on outside click
  useClickOutside(helpRef, () => setHelpOpenPath(null), helpOpen);

  async function handleSignOut() {
    await signOut();
    router.push("/");
  }

  return (
    <nav
      className="sticky top-0 z-50 border-b border-edge/60 bg-surface-alt/90 backdrop-blur-xl"
      aria-label="Main navigation"
    >
      <div ref={helpRef} className="relative w-full px-4 sm:px-6 lg:px-8">
        <div className="flex h-12 items-center gap-3">
          {/* Brand */}
          <Link href="/" className="mr-3 flex items-center gap-2 py-2 sm:mr-5" aria-label="Beta Scanner home">
            <Image
              src="/climber_scan_logo.svg"
              alt="Beta Scanner"
              width={21}
              height={24}
              unoptimized
              className="h-8 w-auto"
            />
            <span className="text-sm font-semibold tracking-tight text-fg-inverse">
              Beta&nbsp;Scanner
            </span>
          </Link>

          {/* Desktop nav rail */}
          <div className="hidden items-center md:flex">
            {links.map((link, index) => {
              const active =
                path === link.href || path.startsWith(link.href + "/");
              return (
                <div key={link.href} className="flex items-center">
                  {index > 0 && (
                    <span className="mx-2 h-3.5 w-px bg-edge/70" aria-hidden="true" />
                  )}
                  <Link
                    href={link.href}
                    className={cn(
                      "relative px-1 py-1 text-body-sm font-medium transition-colors duration-150",
                      active
                        ? "text-fg-inverse"
                        : "text-fg-light hover:text-fg-inverse",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    {link.label}
                    {active && (
                      <span className="absolute inset-x-0 -bottom-2.5 h-0.5 bg-accent" />
                    )}
                  </Link>
                </div>
              );
            })}

            {/* Help utility -- desktop */}
            {helpSections.length > 0 && (
              <div className="ml-3 flex items-center border-l border-edge/70 pl-3">
                <button
                  onClick={() => setHelpOpenPath(old => old === path ? null : path)}
                  className={cn(
                    "flex items-center gap-1 py-1 text-body-sm font-medium transition-colors duration-150",
                    helpOpen
                      ? "text-fg-inverse"
                      : "text-fg-light hover:text-fg-inverse",
                  )}
                  aria-expanded={helpOpen}
                >
                  Help
                  <svg
                    className={cn("h-3 w-3 transition-transform duration-200", helpOpen && "rotate-180")}
                    fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Right side — auth + theme toggle + mobile hamburger */}
          <div className="ml-auto flex items-center gap-1.5">
            {!loading && !user && (
              <Link
                href="/login"
                className="hidden ui-control px-3 py-1.5 text-xs font-medium text-fg-inverse sm:inline-flex"
              >
                Sign in
              </Link>
            )}
            {!loading && user && (
              <div className="hidden items-center gap-2 sm:flex">
                <AccountMenu />
              </div>
            )}

            <ThemeToggle />

            {/* Mobile hamburger */}
            <button
              className="ui-control flex h-9 w-9 items-center justify-center rounded-md text-fg-light md:hidden"
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
            {links.map(link => {
              const active =
                path === link.href || path.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition",
                    active
                      ? "border border-edge/80 bg-surface-alt/80 text-fg-inverse"
                      : "text-fg-light hover:bg-surface-alt/55 hover:text-fg-inverse",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
            {helpSections.length > 0 && (
              <button
                onClick={() => { setHelpOpenPath(old => old === path ? null : path); setMobileOpen(false); }}
                className="rounded-md px-3 py-2 text-left text-sm font-medium text-fg-light transition hover:bg-surface-alt/55 hover:text-fg-inverse"
              >
                Help
              </button>
            )}
            <div className="mt-2 border-t border-edge/40 pt-2">
              {!loading && !user && (
                <Link href="/login" className="block rounded-md border border-edge/80 bg-surface-alt/70 px-3 py-2 text-center text-sm font-medium text-fg-inverse transition hover:border-edge-hover hover:text-fg-inverse">
                  Sign in
                </Link>
              )}
              {!loading && user && (
                <div className="flex flex-col gap-2">
                  <Link
                    href="/profile"
                    className="rounded-md px-3 py-2 text-sm font-medium text-fg-light transition hover:bg-surface-alt/55 hover:text-fg-inverse"
                  >
                    Profile
                  </Link>
                  <button onClick={handleSignOut} className="ui-control rounded-md px-3 py-2 text-sm font-medium">
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
                      <li key={j} className="text-xs text-fg-light leading-relaxed">
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

