"use client";

import type { ReactNode } from "react";
import { cn } from "@/utils/cn";
import { useEscapeKey } from "@/hooks/useEscapeKey";

export interface PreviewSidebarProps {
  /** Whether the drawer is shown. */
  open: boolean;
  /** Close the drawer (X button, ESC, or backdrop click). */
  onClose: () => void;
  /** Heading shown in the drawer header. */
  title: string;
  /** Drawer body content. */
  children: ReactNode;
  className?: string;
}

/**
 * Right-edge overlay drawer for the Detection Preview controls (Holds, Climber).
 *
 * Renders as a full-height panel anchored to the **right edge of the preview
 * frame** — it must live inside a `relative` preview container. A transparent
 * backdrop fills that container so a click outside the panel (but on the
 * preview) closes it, while the toolbar buttons that toggle the drawer sit
 * above the container and stay clickable. ESC also closes.
 *
 * The drawer markup only renders while `open`, so callers that need their slider
 * state to survive a close keep that state in the parent component (which stays
 * mounted) and feed it into the controlled inputs passed as `children`.
 */
export default function PreviewSidebar({
  open,
  onClose,
  title,
  children,
  className,
}: PreviewSidebarProps) {
  useEscapeKey(onClose, open);
  if (!open) return null;

  return (
    <>
      {/* Transparent backdrop — outside-click dismiss, preview stays visible. */}
      <div className="absolute inset-0 z-20" onClick={onClose} aria-hidden="true" />

      <aside
        role="dialog"
        aria-label={title}
        className={cn(
          "absolute inset-y-0 right-0 z-30 flex w-72 max-w-[85%] flex-col border-l border-edge bg-card shadow-xl",
          className,
        )}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-edge/60 px-3 py-2">
          <span className="text-xs font-semibold text-fg">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="ui-icon-btn flex h-7 w-7 items-center justify-center"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">{children}</div>
      </aside>
    </>
  );
}
