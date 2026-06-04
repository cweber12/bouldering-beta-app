"use client";

import { cn } from "@/utils/cn";

type RunType = "send" | "attempt";

type RunTypeBadgeVariant = "surface" | "overlay";

interface RunTypeBadgeProps {
  runType?: string | null;
  variant?: RunTypeBadgeVariant;
  className?: string;
  label?: string;
}

function normalizeRunType(runType?: string | null): RunType {
  return runType === "send" ? "send" : "attempt";
}

/**
 * Shared run-type badge primitive for send/attempt styling.
 */
export default function RunTypeBadge({
  runType,
  variant = "surface",
  className,
  label,
}: RunTypeBadgeProps) {
  const normalized = normalizeRunType(runType);

  const toneClass =
    variant === "overlay"
      ? normalized === "send"
        ? "bg-send/80 text-fg-inverse"
        : "bg-attempt/80 text-fg-inverse"
      : normalized === "send"
      ? "bg-send-surface text-send"
      : "bg-attempt-surface text-attempt";

  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-xs font-medium capitalize",
        toneClass,
        className,
      )}
    >
      {label ?? normalized}
    </span>
  );
}
