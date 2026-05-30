"use client";

import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface ProcessFlowShellProps {
  step: number;
  totalSteps: number;
  title: string;
  subtitle: string;
  children: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}

export default function ProcessFlowShell({
  step,
  totalSteps,
  title,
  subtitle,
  children,
  primaryAction,
  secondaryAction,
  className,
}: ProcessFlowShellProps) {
  const progressPct = Math.round((step / totalSteps) * 100);

  return (
    <section
      className={cn("flex h-full min-h-0 flex-col", className)}
      aria-label="Scan process flow"
    >
      <header className="sticky top-12 z-20 border-b border-edge/40 bg-surface/95 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col" role="status" aria-live="polite">
              <p className="text-label tracking-label text-fg-muted uppercase">
                Step {step} of {totalSteps}
              </p>
              <h1 className="truncate text-base font-semibold text-fg sm:text-lg">{title}</h1>
              <p className="line-clamp-2 text-body-sm text-fg-secondary">{subtitle}</p>
            </div>
            <span className="hidden rounded-full border border-edge/50 bg-card/70 px-2.5 py-1 text-xs font-medium text-fg-secondary sm:inline-flex">
              {progressPct}%
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-inset"
            role="progressbar"
            aria-label="Process progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPct}
          >
            <div
              className="h-full rounded-full bg-accent motion-flow-progress"
              style={{ width: `${progressPct}%` }}
              aria-hidden="true"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 motion-flow-enter">{children}</div>

      {(primaryAction || secondaryAction) && (
        <footer className="sticky bottom-0 z-20 border-t border-edge/40 bg-surface/95 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="mx-auto flex w-full max-w-5xl items-center gap-2">
            {secondaryAction && <div className="shrink-0">{secondaryAction}</div>}
            {primaryAction && <div className="ml-auto">{primaryAction}</div>}
          </div>
        </footer>
      )}
    </section>
  );
}