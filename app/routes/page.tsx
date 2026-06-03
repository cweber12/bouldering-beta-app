"use client";

import { useAuth } from "@/hooks/useAuth";
import ToolPageShell from "@/components/shared/ToolPageShell";
import RoutesView from "@/components/routes/RoutesView";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

// ---------------------------------------------------------------------------
// /routes — the route-grouped collection (route list + map). Replaces the
// per-run grid as the default Collection surface. Auth is enforced by proxy.ts;
// this page only waits for the Firebase user to resolve so it can scope the
// fetch to the owner's uid.
// ---------------------------------------------------------------------------

export default function RoutesPage() {
  const { user, loading } = useAuth();

  if (loading || !user) {
    return (
      <ToolPageShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <LoadingSpinner className="h-10 w-10" />
          <p className="text-sm text-fg-muted">Loading your routes&#8230;</p>
        </div>
      </ToolPageShell>
    );
  }

  return (
    <ToolPageShell>
      <RoutesView userId={user.uid} />
    </ToolPageShell>
  );
}
