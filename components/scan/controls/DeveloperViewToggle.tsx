"use client";

import { useAdvancedView } from "@/hooks/useAdvancedView";
import { cn } from "@/utils/cn";

/**
 * The one app-wide "Developer view" switch. Reads/writes the persisted
 * useAdvancedView preference, so every instance stays in sync. Off by default;
 * flipping it on reveals the engineering-grade scan surfaces (feature points,
 * match statistics, model/ORB internals) that are hidden from the normal flow.
 *
 * Visual: mirrors the panning switch in the detection settings popover.
 */
export default function DeveloperViewToggle({ className }: { className?: string }) {
  const { advanced, toggle } = useAdvancedView();
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-medium text-fg-secondary">Developer view</span>
        <span className="text-xs text-fg-muted">Show feature points &amp; match stats</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={advanced}
        aria-label="Developer view"
        onClick={toggle}
        className={cn(
          "ui-chip-toggle shrink-0 rounded-md px-2.5 py-1 text-xs font-medium",
          advanced ? "border-accent/50 bg-accent/15 text-fg" : "",
        )}
      >
        {advanced ? "On" : "Off"}
      </button>
    </div>
  );
}
