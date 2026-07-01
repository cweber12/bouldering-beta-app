/**
 * Fire-and-forget client helper that posts a diagnostics record to the dev-only
 * sink (`POST /api/diagnostics`). No-ops outside development so production never
 * attempts the write (the route 404s there anyway). Errors are swallowed — a
 * failed diagnostics append must never disrupt the scan/match flow.
 */

import type { ScanDiagnostics, MatchDiagnostics } from "@/pipeline/analysis/diagnostics";

export function shipDiagnostics(record: ScanDiagnostics | MatchDiagnostics): void {
  if (process.env.NODE_ENV !== "development") return;
  void fetch("/api/diagnostics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  }).catch((err) => {
    console.warn("[shipDiagnostics] failed:", err);
  });
}
