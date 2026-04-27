"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { cn } from "@/utils/cn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClimbDetailData {
  key: string;
  state: string;
  area: string;
  route: string;
  runType: string;
  timestamp: string;
  rating?: string;
  notes?: string;
  thumbnail?: string;
  coordinates?: { lat: number; lng: number };
}

interface ClimbDetailModalProps {
  climb: ClimbDetailData;
  onClose: () => void;
  /**
   * When provided, the Compare button calls this instead of navigating
   * directly to /compare. The parent (profile page) is responsible for
   * opening the CompareSelectSheet.
   */
  onCompare?: () => void;
}

// ---------------------------------------------------------------------------
// ClimbDetailModal — full-screen overlay showing climb info + image.
//
// Rendered via createPortal directly on document.body so it always sits above
// Leaflet's internal pane z-indices (which reach ~800).  z-[1001] ensures the
// modal paints on top of every map layer regardless of where the trigger
// lives in the DOM.
// ---------------------------------------------------------------------------

export default function ClimbDetailModal({ climb, onClose, onCompare }: ClimbDetailModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Guard against SSR — createPortal needs document.body.
  useEffect(() => setMounted(true), []);

  const isSend = climb.runType === "send";

  const viewUrl = `/view?key=${encodeURIComponent(climb.key)}`;

  const go = (url: string) => {
    onClose();
    router.push(url);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1001] flex items-center justify-center bg-surface/70 backdrop-blur-sm px-4 py-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${climb.route} climb detail`}
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-edge bg-surface shadow-2xl">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-surface/80 text-fg-secondary backdrop-blur transition hover:text-fg"
          aria-label="Close"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Image area — object-contain so the full climbing pose is always visible */}
        <div className="relative aspect-video w-full overflow-hidden rounded-t-2xl bg-inset">
          {climb.thumbnail ? (
            <Image
              src={climb.thumbnail}
              alt={`${climb.route} climb`}
              fill
              unoptimized
              className="object-contain"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-fg-muted/30">
              <svg className="h-16 w-16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            </div>
          )}

          {/* Run type badge */}
          <span
            className={cn(
              "absolute top-3 left-3 rounded px-2 py-1 text-xs font-bold uppercase tracking-wider",
              isSend ? "bg-send/80 text-fg-inverse" : "bg-attempt/80 text-fg-inverse",
            )}
          >
            {climb.runType}
          </span>

        </div>

        {/* Detail section */}
        <div className="px-5 py-4">
          <h2 className="text-base font-semibold text-fg">{climb.route}</h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            {climb.area} &middot; {climb.state}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-fg-muted">{climb.timestamp}</span>
            {climb.rating && (
              <span className="rounded bg-accent/20 px-1.5 py-0.5 text-xs font-medium text-accent">
                {climb.rating}
              </span>
            )}
            {climb.coordinates && (
              <span className="text-xs text-fg-muted">
                {climb.coordinates.lat.toFixed(4)}, {climb.coordinates.lng.toFixed(4)}
              </span>
            )}
          </div>

          {climb.notes && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-fg-secondary">{climb.notes}</p>
          )}

          {/* Action row — exactly three distinct actions */}
          <div className="mt-4 flex flex-col gap-2">
            {/* Primary: view overlaid on a route photo */}
            <button
              type="button"
              onClick={() => go(viewUrl)}
              className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition hover:bg-accent-hover"
            >
              View on route photo
            </button>

            <div className="flex gap-2">
              {/* Secondary: capture a new route photo on-device */}
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-edge px-4 py-2.5 text-sm font-medium text-fg-secondary transition hover:border-edge-hover hover:text-fg"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Take a photo
              </button>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={() => go(viewUrl)}
              />

              {/* Tertiary: compare to another climb of the same route */}
              <button
                type="button"
                onClick={() => {
                  if (onCompare) {
                    onClose();
                    onCompare();
                  }
                }}
                disabled={!onCompare}
                className="flex-1 rounded-xl border border-edge px-4 py-2.5 text-sm font-medium text-fg-secondary transition hover:border-edge-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                Compare
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
