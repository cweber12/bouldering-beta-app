"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/utils/cn";
import { useClickOutside } from "@/hooks/useClickOutside";
import { buildCompareUrl } from "@/utils/compareUrl";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClimbOptionsDropdownProps {
  /** S3 key of the climb run (used to build the console URL). */
  climbKey: string;
  /** Route context — when provided, compare navigation locks to this route. */
  state?: string;
  area?: string;
  route?: string;
  /**
   * Optional custom trigger element. When provided, the default icon button is
   * replaced with this node and a click on it toggles the dropdown.
   */
  trigger?: React.ReactNode;
  /** "sm" uses a smaller 28px trigger; default uses 32px with better touch target. */
  size?: "sm" | "default";
}

// ---------------------------------------------------------------------------
// ClimbOptionsDropdown
//
// Three route-photo action options that all open the climb console:
//   - Select Route Photo  (gallery file picker)
//   - Take a Photo        (camera capture on mobile)
//   - Use Route Image     (navigate directly; the console loads the image)
//
// Opens upward from the trigger. Closes on outside click.
// ---------------------------------------------------------------------------

export default function ClimbOptionsDropdown({ climbKey, state, area, route, trigger, size = "default" }: ClimbOptionsDropdownProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on any click outside the container
  useClickOutside(containerRef, () => setOpen(false), open);

  /** Opens the climb console, scoped to this route with this climb pre-loaded;
   *  the user switches to "Compare Multiple" on the page to add others. */
  const handleAction = () => {
    setOpen(false);
    router.push(buildCompareUrl(climbKey, { state, area, route }));
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Trigger */}
      {trigger ? (
        <div onClick={() => setOpen((o) => !o)}>
          {trigger}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn("ui-control flex items-center justify-center backdrop-blur-sm", size === "sm" ? "h-7 w-7" : "h-8 w-8")}
          aria-label="Climb options"
          aria-expanded={open}
        >
          {/* Vertical ellipsis */}
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="3" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="8" cy="13" r="1.5" />
          </svg>
        </button>
      )}

      {/* Dropdown panel */}
      {open && (
        <div className="ui-popover absolute top-full left-0 z-60 mt-2 w-44 overflow-hidden">
          {/* Action rows — each opens the climb console for this climb. */}
          <div className="py-1">
            {/* Select Route Photo */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-fg-secondary transition hover:bg-inset/80 hover:text-fg"
            >
              <svg
                className="h-3.5 w-3.5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Select Route Photo
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleAction}
            />

            {/* Take a Photo */}
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-fg-secondary transition hover:bg-inset/80 hover:text-fg"
            >
              <svg
                className="h-3.5 w-3.5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Take a Photo
            </button>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={handleAction}
            />

            {/* Use Route Image */}
            <button
              type="button"
              onClick={handleAction}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-fg-secondary transition hover:bg-inset/80 hover:text-fg"
            >
              <svg
                className="h-3.5 w-3.5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Use Route Image
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
