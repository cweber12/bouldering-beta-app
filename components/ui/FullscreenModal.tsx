"use client";

import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "@/hooks/useEscapeKey";

// ---------------------------------------------------------------------------
// FullscreenModal — edge-to-edge portal shell for the crop-adjustment
// fullscreen views. Owns the portal, the `fixed inset-0 z-fullscreen` flex
// column, the standard centered body wrapper, role/aria and ESC-to-close.
// Callers provide the `header` and optional `footer` chrome plus the body.
// ---------------------------------------------------------------------------

export interface FullscreenModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible label for the dialog. */
  ariaLabel: string;
  /** Top chrome — caller supplies its own `<header>` element. */
  header?: ReactNode;
  /** Bottom chrome — caller supplies its own `<footer>` element. */
  footer?: ReactNode;
  /** Body content, centered in the available vertical space. */
  children: ReactNode;
}

export default function FullscreenModal({
  open,
  onClose,
  ariaLabel,
  header,
  footer,
  children,
}: FullscreenModalProps) {
  useEscapeKey(onClose, open);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-fullscreen flex flex-col bg-surface"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {header}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4 min-h-0">
        {children}
      </div>
      {footer}
    </div>,
    document.body,
  );
}
