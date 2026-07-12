"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Leading glyph — a sized `<svg>` (h-4 w-4). */
  icon: ReactNode;
  /** Always-visible text label shown beside the icon. */
  label: string;
}

/**
 * Shared scan-flow top-bar control: a plateless icon paired with an always-visible
 * text label. Replaces the bare icon-only toolbar buttons so every top-bar action
 * reads at a glance. Composes `.ui-icon-btn` for the colour / hover / active
 * (aria-expanded, aria-pressed) states, then adds the icon+label layout. Forwards
 * its ref and remaining button props so it can drive popover triggers.
 */
const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton(
  { icon, label, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "ui-icon-btn flex h-8 items-center gap-1.5 px-2 text-xs font-medium",
        className,
      )}
      {...rest}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
});

export default ToolbarButton;
