"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

const PUBLIC_TABS = [
  { href: "/", label: "Home" },
  { href: "/docs", label: "Docs" },
] as const;

const AUTH_TABS = [
  { href: "/", label: "Home" },
  { href: "/upload", label: "Upload" },
  { href: "/match", label: "Match" },
  { href: "/compare", label: "Compare" },
  { href: "/docs", label: "Docs" },
] as const;

export default function NavBar() {
  const path = usePathname();
  const router = useRouter();
  const { user, loading, signOut } = useAuth();

  const tabs = user ? AUTH_TABS : PUBLIC_TABS;

  async function handleSignOut() {
    await signOut();
    router.push("/");
  }

  return (
    <nav
      className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur"
      aria-label="Main navigation"
    >
      <div className="mx-auto flex max-w-4xl items-center gap-1 px-6">
        <span className="mr-6 py-3 text-sm font-semibold text-zinc-200 tracking-tight">
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
                  ? "border-zinc-200 font-medium text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
              aria-current={active ? "page" : undefined}
            >
              {tab.label}
            </Link>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          {!loading && !user && (
            <Link
              href="/login"
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
            >
              Sign in
            </Link>
          )}
          {!loading && user && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500 truncate max-w-[160px]">
                {user.email}
              </span>
              <button
                onClick={handleSignOut}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
