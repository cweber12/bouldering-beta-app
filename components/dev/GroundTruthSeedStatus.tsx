import { cn } from "@/utils/cn";
import type { GroundTruthGate } from "@/utils/harnessGroundTruthScaffold";

interface GroundTruthSeedStatusProps {
  gate: GroundTruthGate;
  posedCount: number;
  frameCount: number;
  onRetry: () => void;
  className?: string;
}

export default function GroundTruthSeedStatus({
  gate,
  posedCount,
  frameCount,
  onRetry,
  className,
}: GroundTruthSeedStatusProps) {
  if (gate.authoring === "ready") {
    return (
      <span
        className={cn("shrink-0 text-xs text-send", className)}
        title="Ground Truth seeded from the ViTPose reference model"
      >
        ViTPose seed · {posedCount}/{frameCount} posed
      </span>
    );
  }

  if (gate.authoring === "pending") {
    return (
      <span className={cn("shrink-0 text-xs text-fg-muted", className)}>
        Building ViTPose scaffold…
      </span>
    );
  }

  return (
    <div
      role="status"
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-sm text-caution",
        className,
      )}
    >
      <span className="min-w-0">
        Ground Truth review requires a ViTPose scaffold. {gate.reason}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-md bg-surface px-2.5 py-1 text-xs font-medium text-fg"
      >
        Retry ViTPose
      </button>
    </div>
  );
}
