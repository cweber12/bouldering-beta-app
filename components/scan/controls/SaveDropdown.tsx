"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Shared save / device-storage dropdown used in the Scan step toolbars.
// ---------------------------------------------------------------------------

export interface SaveDropdownProps {
  s3Saved: boolean;
  s3Loading: boolean;
  savedRouteDirHandle: FileSystemDirectoryHandle | null;
  onUpload: () => void;
  onSaveToDevice: () => void;
  onDeleteFromDevice: () => void;
  /** Left-aligns the panel by default; pass "right" for toolbars where the
   *  button sits at the far right of its container. */
  dropdownAlign?: "left" | "right";
  /** Extra classes applied to the outer wrapper (e.g. `ml-auto`). */
  containerClassName?: string;
  /** Fired when the dropdown opens so the parent can close other dropdowns. */
  onOpen?: () => void;
}

export default function SaveDropdown({
  s3Saved,
  s3Loading,
  savedRouteDirHandle,
  onUpload,
  onSaveToDevice,
  onDeleteFromDevice,
  dropdownAlign = "left",
  containerClassName = "",
  onOpen,
}: SaveDropdownProps) {
  const [open, setOpen] = useState(false);

  function toggle() {
    if (!open) onOpen?.();
    setOpen((p) => !p);
  }

  return (
    <div className={`relative ${containerClassName}`}>
      <button
        type="button"
        onClick={toggle}
        className={[
          "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
          open
            ? "border-accent/60 bg-accent/10 text-accent"
            : s3Saved
            ? "border-send/30 bg-send-surface text-send"
            : "border-edge bg-card text-fg-secondary hover:border-edge-hover hover:text-fg-secondary",
        ].join(" ")}
      >
        <svg
          className="h-3.5 w-3.5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
          />
        </svg>
        {s3Saved ? "Saved" : "Save"}
        <svg
          className={["h-3 w-3 transition-transform", open ? "rotate-180" : ""].join(" ")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className={[
            "absolute top-full z-20 mt-1.5 w-52 rounded-xl border border-edge/50 bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl animate-fade-in",
            dropdownAlign === "right" ? "right-0" : "left-0",
          ].join(" ")}
        >
          <button
            onClick={() => { setOpen(false); onUpload(); }}
            disabled={s3Loading}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-fg-secondary transition hover:bg-card hover:text-fg disabled:opacity-50"
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
              />
            </svg>
            {s3Saved ? "Uploaded" : "Upload"}
          </button>
          <button
            onClick={() => { setOpen(false); onSaveToDevice(); }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-fg-secondary transition hover:bg-card hover:text-fg"
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            Download to Device
          </button>
          {savedRouteDirHandle && (
            <button
              onClick={() => { setOpen(false); onDeleteFromDevice(); }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-danger transition hover:bg-danger-surface"
            >
              <svg
                className="h-3.5 w-3.5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                />
              </svg>
              Delete from device
            </button>
          )}
        </div>
      )}
    </div>
  );
}
