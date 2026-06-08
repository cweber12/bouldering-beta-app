"use client";

import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface ProcessFlowShellProps {
  step: number;
  totalSteps: number;
  /** Short step name shown inline in the footer bar (e.g. "Set detection"). */
  stepName: string;
  /** Dynamic, actionable instruction shown muted after the step name. Truncates. */
  instruction?: ReactNode;
  /** Compact status control (e.g. quality chip) rendered in the footer's right
   *  cluster. Any popover it owns should open upward (the bar sits at the bottom). */
  accessory?: ReactNode;
  /** When set, renders an icon-only back arrow at the far left of the footer bar
   *  (left of the step text) that navigates to the previous step. */
  onBack?: () => void;
  /** Slim top bar (mirrors the footer) carrying plateless utility controls that
   *  used to float over the media. Rendered above the step content only when set. */
  toolbar?: ReactNode;
  children: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}

/**
 * Wizard chrome for the scan flow. The step content fills the viewport; a single
 * slim bottom bar carries the step indicator + instruction on the left and the
 * step's actions on the right. There is no top banner or progress bar — the
 * "Step N/M" text is the progress signal, and the reclaimed space goes to the
 * media preview.
 */
export default function ProcessFlowShell({
  step,
  totalSteps,
  stepName,
  instruction,
  accessory,
  onBack,
  toolbar,
  children,
  primaryAction,
  secondaryAction,
  className,
}: ProcessFlowShellProps) {
  const hasActions = accessory || secondaryAction || primaryAction;

  return (
    <section
      className={cn("flex h-full min-h-0 flex-col", className)}
      aria-label="Scan process flow"
    >
      {toolbar && (
        <header className="shrink-0 border-b border-edge/60 bg-surface px-4 py-2.5 sm:px-6">
          <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
            {toolbar}
          </div>
        </header>
      )}

      <div className="flex-1 min-h-0 motion-flow-enter">{children}</div>

      <footer className="shrink-0 border-t border-edge/60 bg-surface px-4 py-2.5 sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          {/* Back to previous step */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to previous step"
              title="Back"
              className="ui-control -ml-1 flex h-8 w-8 shrink-0 items-center justify-center p-0 text-fg-muted"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>
          )}

          {/* Step indicator + dynamic instruction */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5" role="status" aria-live="polite">
            <span className="shrink-0 text-label tracking-label uppercase text-fg-secondary">
              Step {step}/{totalSteps}
            </span>
            <span className="shrink-0 text-fg-muted" aria-hidden="true">·</span>
            <span className="shrink-0 text-sm font-medium text-fg">{stepName}</span>
            {instruction && (
              <>
                <span className="shrink-0 text-fg-muted" aria-hidden="true">—</span>
                <span className="truncate text-sm text-fg-secondary">{instruction}</span>
              </>
            )}
          </div>

          {/* Actions */}
          {hasActions && (
            <div className="flex shrink-0 items-center gap-2">
              {accessory}
              {secondaryAction}
              {primaryAction}
            </div>
          )}
        </div>
      </footer>
    </section>
  );
}
