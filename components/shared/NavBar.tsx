"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Home" },
  { href: "/upload", label: "Upload" },
  { href: "/match", label: "Match" },
  { href: "/docs", label: "Docs" },
] as const;

export default function NavBar() {
  const path = usePathname();

  return (
    <nav
      className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur"
      aria-label="Main navigation"
    >
      <div className="mx-auto flex max-w-4xl items-center gap-1 px-6">
        <span className="mr-6 py-3 text-sm font-semibold text-zinc-200 tracking-tight">
          Bouldering Beta
        </span>
        {TABS.map(tab => {
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
                  ? "border-zinc-200 font-medium text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
              aria-current={active ? "page" : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
