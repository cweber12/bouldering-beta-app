"use client";

import { useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import CameraRecorderModal from "@/components/capture/CameraRecorderModal";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen/captured route photo. */
  onPhoto: (file: File) => void;
}

/**
 * Lets the user add a route photo two ways — snap one on the spot or pick an
 * existing file — each with a one-line note on what makes a good route photo.
 * Reuses CameraRecorderModal's photo mode for on-the-spot capture so a user can
 * shoot the route from a fresh angle without leaving the flow.
 */
export default function RoutePhotoChooser({ open, onClose, onPhoto }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showCamera, setShowCamera] = useState(false);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onPhoto(file);
  }

  return (
    <>
      <Modal
        open={open && !showCamera}
        onClose={onClose}
        ariaLabel="Add a route photo"
        placement="bottom"
        containerClassName="sm:items-center"
        panelClassName="w-full max-w-md overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:rounded-2xl"
      >
        <div className="flex flex-col gap-3 p-5">
          <div>
            <h2 className="text-base font-semibold text-fg">Add a route photo</h2>
            <p className="mt-1 text-sm text-fg-secondary">
              A clear, head-on photo of the whole route works best.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowCamera(true)}
            className="ui-control flex items-center gap-3 rounded-xl px-4 py-3 text-left"
          >
            <svg
              className="h-5 w-5 shrink-0 text-accent"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
              />
            </svg>
            <span className="flex flex-1 flex-col">
              <span className="text-sm font-semibold text-fg">Take photo</span>
              <span className="text-xs text-fg-muted">
                Snap the route now — try a different angle
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="ui-control flex items-center gap-3 rounded-xl px-4 py-3 text-left"
          >
            <svg
              className="h-5 w-5 shrink-0 text-fg-secondary"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
              />
            </svg>
            <span className="flex flex-1 flex-col">
              <span className="text-sm font-semibold text-fg">Choose from library</span>
              <span className="text-xs text-fg-muted">Pick an existing photo</span>
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileInput}
          />

          <button
            type="button"
            onClick={onClose}
            className="mt-1 self-center text-sm font-medium text-fg-secondary transition hover:text-fg"
          >
            Cancel
          </button>
        </div>
      </Modal>

      {open && showCamera && (
        <CameraRecorderModal
          mode="photo"
          onCapture={(file) => {
            setShowCamera(false);
            onPhoto(file);
          }}
          onClose={() => setShowCamera(false)}
        />
      )}
    </>
  );
}
