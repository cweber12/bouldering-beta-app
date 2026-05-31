"use client";

import { cn } from "@/utils/cn";

interface LoadingSpinnerProps {
  className?: string;
}

/**
 * Shared spinner primitive used by loading states across the app.
 */
export default function LoadingSpinner({ className }: LoadingSpinnerProps) {
  return (
    <div
      className={cn(
        "animate-spin rounded-full border-edge h-8 w-8 border-4 border-t-fg",
        className,
      )}
      aria-hidden="true"
    />
  );
}
