"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { buildRouteUrl, type ConsoleMode } from "@/utils/routeUrl";

// ---------------------------------------------------------------------------
// Legacy /compare → /route redirect.
//
// The climb console moved to the dedicated per-user URL
// `/route/{userId}/{state}/{area}/{route}`. Old links carry the climb keys (and
// optionally state/area/route) in the query string. The owner userId and the
// route context are both recoverable from the climb key itself
// (`RouteData/{userId}/{state}/{area}/{route}/run-….json`), so even links that
// omit the route context still resolve.
// ---------------------------------------------------------------------------

function CompareRedirect() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user, loading } = useAuth();

  useEffect(() => {
    const csv = sp.get("keys");
    const single = sp.get("key");
    const keys = csv
      ? csv
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean)
      : single
        ? [single]
        : [];

    // Recover owner + route context from the first key when the query omits them.
    const segs = keys[0]?.split("/");
    const ownerFromKey = segs?.[1];
    const userId = ownerFromKey || user?.uid;
    // Wait for auth only when we couldn't derive the owner from a key.
    if (!userId) {
      if (!loading) router.replace("/routes");
      return;
    }

    const state = sp.get("state") || segs?.[2] || "";
    const area = sp.get("area") || segs?.[3] || "";
    const route = sp.get("route") || segs?.[4] || "";

    const modeParam = sp.get("mode");
    const mode: ConsoleMode | undefined =
      modeParam === "single" || modeParam === "multiple" ? modeParam : undefined;

    router.replace(buildRouteUrl(userId, { state, area, route }, { keys, mode }));
  }, [sp, user, loading, router]);

  return (
    <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
      Opening route&#8230;
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <CompareRedirect />
    </Suspense>
  );
}
