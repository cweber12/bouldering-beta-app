"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import LoadingGate from "@/components/layout/LoadingGate";
import ToolPageShell from "@/components/layout/ToolPageShell";
import RouteConsole from "@/components/route/RouteConsole";
import type { ConsoleMode } from "@/utils/routeUrl";

/**
 * Coerce a useParams() value to a single decoded string.
 *
 * Route context lives in the path (percent-encoded by `buildRouteUrl`), and
 * `useParams()` may hand it back still-encoded. We decode here so values like
 * "Midnight%20Lightning" become "Midnight Lightning" — the exact form stored in
 * the S3 key, which the rail/console match against. Decoding is a no-op when the
 * value is already decoded (a literal space is never re-encoded).
 */
function seg(v: string | string[] | undefined): string {
  const raw = Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function RoutePageInner() {
  const params = useParams();
  const sp = useSearchParams();

  const userId = seg(params.userId);
  const state = seg(params.state);
  const area = seg(params.area);
  const route = seg(params.route);

  // Selected climbs + mode ride in the query (keys CSV; ?key= single alias).
  const csv = sp.get("keys");
  const single = sp.get("key");
  const initialKeys = csv
    ? csv.split(",").map((k) => k.trim()).filter(Boolean)
    : single
    ? [single]
    : [];
  const modeParam = sp.get("mode");
  const initialMode: ConsoleMode | null =
    modeParam === "single" || modeParam === "multiple" ? modeParam : null;

  return (
    <RouteConsole
      userId={userId}
      state={state}
      area={area}
      route={route}
      initialKeys={initialKeys}
      initialMode={initialMode}
    />
  );
}

export default function RouteConsolePage() {
  return (
    <LoadingGate>
      <ToolPageShell>
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
              Loading&#8230;
            </div>
          }
        >
          <RoutePageInner />
        </Suspense>
      </ToolPageShell>
    </LoadingGate>
  );
}
