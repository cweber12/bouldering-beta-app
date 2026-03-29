"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import InfoDropdown from "@/components/shared/InfoDropdown";

const PUBLIC_TABS = [
  { href: "/", label: "Home" },
  { href: "/docs", label: "Docs" },
] as const;

const AUTH_TABS = [
  { href: "/", label: "Home" },
  { href: "/upload", label: "Upload" },
  { href: "/match", label: "View" },
  { href: "/compare", label: "Compare" },
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
  "/upload": [
    {
      title: "What this page does",
      bullets: [
        "Upload a climbing video and this page analyses it entirely in your browser â€” nothing is sent to a third-party server.",
        "MoveNet Lightning tracks your skeleton joint-by-joint on every sampled frame of the video.",
        "ORB feature matching simultaneously memorises the unique texture of the wall from the first video frame.",
        "The result is a compact .json file you take to the View page to overlay your movement onto a still route photo.",
      ],
    },
    {
      title: "Entering route information",
      bullets: [
        "State / Region, Area, and Route organise saved climbs so they group correctly when loaded on the View and Compare pages.",
        "Set Run type to Attempt if you did not top the route, or Send if you completed it â€” shown as a coloured badge throughout the app.",
        "Grade / Rating and Notes are optional â€” add them to help identify and compare climbs later.",
        "All fields can be filled in or changed before or after processing.",
      ],
    },
    {
      title: "Filming and lighting",
      bullets: [
        "Mount the camera on a tripod or fixed surface â€” any camera movement prevents accurate wall-feature matching.",
        "Keep the entire route and climber visible throughout the clip; nobody should pass between the camera and the climber.",
        "Shoot in consistent, even light â€” harsh backlight, direct sun, deep shade, or mixed indoor/outdoor light all reduce accuracy.",
        "Overhead gym fluorescents can cast uneven shadows; chalk dust or a fogged lens reduces sharpness â€” note any issues in Shooting conditions before processing.",
        "Keep the clip short â€” only the section containing the climb is needed.",
      ],
    },
    {
      title: "Processing, testing, and saving",
      bullets: [
        "After selecting a video, scrub to a representative frame, then drag the Climber crop box around the area the climber moves through and the Background (ORB) crop over the wall texture.",
        "Click Process video. A progress bar shows frames analysed. Processing runs entirely in the browser.",
        "Once complete, click View on route photo to test the skeleton overlay immediately on the View page.",
        "Save the .json to your device or to S3 â€” it can be reloaded on the View page in any future session without re-processing the video.",
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
        "Drag the crop handles to focus on the wall surface â€” rock texture, holds, and chalk marks are ideal features for matching.",
        "Exclude sky, trees, gear, people, and the floor â€” these change between sessions and spoil the match.",
        "The crop should roughly correspond to the background (ORB) crop you set on the Upload page.",
        "If matching produces few good matches, try re-cropping to include more distinctive wall texture.",
      ],
    },
  ],
  "/compare": [
    {
      title: "Comparing multiple climbs",
      bullets: [
        "Load up to 4 climbs and overlay their skeletons onto the same route photo to compare movement and timing.",
        "Side by side mode shows every climb in its own panel â€” use Play all to sync playback simultaneously.",
        "Overlay mode composites all skeletons onto a single image so you can directly compare body positions frame-by-frame.",
        "Each climb gets a unique colour; adjust using the colour picker next to each slot.",
      ],
    },
    {
      title: "Loading climbs and matching",
      bullets: [
        "First select a route photo, then load each climb slot from your saved S3 data.",
        "Crop the route photo to focus on the wall texture before clicking Apply & View.",
        "All loaded climbs are matched against the same photo â€” you only need to crop and apply once.",
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
      className="sticky top-0 z-50 border-b border-edge bg-surface-alt/95 backdrop-blur"
      aria-label="Main navigation"
    >
      <div ref={helpRef} className="relative mx-auto max-w-4xl px-6">
        <div className="flex items-center gap-1">
          <span className="mr-6 py-3 text-sm font-semibold text-fg tracking-tight">
            Route Renderer
          </span>

          {tabs.map(tab => {
            const active =
              tab.href === "/"
                ? path === "/"
                : path === tab.href || path.startsWith(tab.href + "/");
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={[
                  "border-b-2 px-3 py-3 text-sm transition",
                  active
                    ? "border-accent font-medium text-fg"
                    : "border-transparent text-fg-muted hover:text-fg-light",
                ].join(" ")}
                aria-current={active ? "page" : undefined}
              >
                {tab.label}
              </Link>
            );
          })}

          {/* Help tab â€” shown when the current page has help content */}
          {helpSections.length > 0 && (
            <button
              onClick={() => setHelpOpenPath(old => old === path ? null : path)}
              className={[
                "flex items-center gap-1 border-b-2 px-3 py-3 text-sm transition",
                helpOpen
                  ? "border-accent font-medium text-fg"
                  : "border-transparent text-fg-muted hover:text-fg-light",
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

          <div className="ml-auto flex items-center gap-2">
            {!loading && !user && (
              <Link
                href="/login"
                className="rounded-lg border border-edge px-3 py-1.5 text-xs text-fg-secondary transition hover:border-edge-hover hover:text-fg"
              >
                Sign in
              </Link>
            )}
            {!loading && user && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-fg-muted truncate max-w-[160px]">
                  {user.email}
                </span>
                <button
                  onClick={handleSignOut}
                  className="rounded-lg border border-edge px-3 py-1.5 text-xs text-fg-secondary transition hover:border-edge-hover hover:text-fg"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Help panel dropdown */}
        {helpOpen && helpSections.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-40 border-b border-edge bg-surface-alt shadow-xl">
            <div className="px-6 py-5 flex flex-col gap-3">
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

