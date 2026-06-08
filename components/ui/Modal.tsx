"use client";

import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";
import { useEscapeKey } from "@/hooks/useEscapeKey";

// ---------------------------------------------------------------------------
// Modal — portal + backdrop shell shared by centered dialogs and bottom
// sheets. Owns the createPortal call, the standardised backdrop
// (`bg-surface/70 backdrop-blur-sm`), the z-index token, ESC-to-close and
// close-on-backdrop-click. Callers supply only the panel content + styling.
// ---------------------------------------------------------------------------

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible label for the dialog. */
  ariaLabel: string;
  /** Vertical placement of the panel: "center" (default) or "bottom" (sheet). */
  placement?: "center" | "bottom";
  /** Close when the backdrop (outside the panel) is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Extra classes on the full-screen container (e.g. padding, responsive
   *  alignment overrides such as `sm:items-center`). */
  containerClassName?: string;
  /** Classes for the panel wrapper (size, radius, animation, overflow). */
  panelClassName?: string;
  /** Stacking z-index utility. Defaults to `z-fullscreen`; ClimbDetailModal
   *  overrides to paint above Leaflet's internal map panes. */
  zClassName?: string;
  children: ReactNode;
}

export default function Modal({
  open,
  onClose,
  ariaLabel,
  placement = "center",
  closeOnBackdrop = true,
  containerClassName,
  panelClassName,
  zClassName = "z-fullscreen",
  children,
}: ModalProps) {
  useEscapeKey(onClose, open);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className={cn(
        "fixed inset-0 flex justify-center bg-surface/70 backdrop-blur-sm",
        placement === "bottom" ? "items-end" : "items-center",
        zClassName,
        containerClassName,
      )}
      onClick={
        closeOnBackdrop
          ? (e) => {
              if (e.target === e.currentTarget) onClose();
            }
          : undefined
      }
    >
      <div className={cn("relative", panelClassName)}>{children}</div>
    </div>,
    document.body,
  );
}
