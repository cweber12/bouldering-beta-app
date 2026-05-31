"use client";

import Image from "next/image";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import RunTypeBadge from "@/components/shared/RunTypeBadge";
import { buildCompareUrl } from "@/utils/compareUrl";

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
}

// ---------------------------------------------------------------------------
// ClimbDetailModal — full-screen overlay showing climb info + image.
//
// Rendered via createPortal directly on document.body so it always sits above
// Leaflet's internal pane z-indices (which reach ~800).  z-[1001] ensures the
// modal paints on top of every map layer regardless of where the trigger
// lives in the DOM.
// ---------------------------------------------------------------------------

export default function ClimbDetailModal({ climb, onClose }: ClimbDetailModalProps) {
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  // Guard against SSR — createPortal needs document.body.
  const viewUrl = `/view?key=${encodeURIComponent(climb.key)}`;
  // Compare goes straight to the compare page, scoped to this route, with this
  // climb pre-loaded — the user adds others from the on-page rail.
  const compareUrl = buildCompareUrl(climb.key, {
    state: climb.state,
    area: climb.area,
    route: climb.route,
  });

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const go = (url: string) => {
    onClose();
    router.push(url);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-1001 flex items-center justify-center bg-surface/70 backdrop-blur-sm px-4 py-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${climb.route} climb detail`}
    >
      <div className="relative w-full max-w-lg rounded-md border border-edge/50 bg-(--color-surface) shadow-xl">
        {/* Close button */}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="ui-control absolute top-3 right-3 z-10 flex h-11 w-11 items-center justify-center rounded-md text-fg-secondary backdrop-blur"
          style={{ backgroundColor: "color-mix(in srgb, var(--color-surface) 85%, transparent)" }}
          aria-label="Close"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Image area — object-contain so the full climbing pose is always visible */}
        <div className="relative aspect-video w-full overflow-hidden rounded-t-md bg-(--color-inset)">
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
          <RunTypeBadge
            runType={climb.runType}
            variant="overlay"
            className="absolute top-3 left-3 rounded px-2 py-1 text-xs font-bold uppercase tracking-wider"
          />

        </div>

        {/* Detail section */}
        <div className="px-5 py-4">
          <h2 className="text-base font-semibold text-fg">{climb.route}</h2>
          <p className="mt-0.5 text-sm text-fg-secondary">
            {climb.area} &middot; {climb.state}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-fg-secondary">{climb.timestamp}</span>
            {climb.rating && (
              <span className="rounded bg-accent/20 px-1.5 py-0.5 text-xs font-medium text-accent">
                {climb.rating}
              </span>
            )}
            {climb.coordinates && (
              <span className="text-xs text-fg-secondary">
                {climb.coordinates.lat.toFixed(4)}, {climb.coordinates.lng.toFixed(4)}
              </span>
            )}
          </div>

          {climb.notes && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-fg">{climb.notes}</p>
          )}

          {/* Action row — View and Compare are co-equal primary paths */}
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex gap-2">
              {/* View this climb overlaid on a route photo */}
              <button
                type="button"
                onClick={() => go(viewUrl)}
                className="ui-control-primary flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                View
              </button>

              {/* Compare to other climbs on the same route */}
              <button
                type="button"
                onClick={() => go(compareUrl)}
                className="ui-control-primary flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 5.5A1.5 1.5 0 015.5 4h2A1.5 1.5 0 019 5.5v13A1.5 1.5 0 017.5 20h-2A1.5 1.5 0 014 18.5v-13z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 5.5A1.5 1.5 0 0116.5 4h2A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5h-2a1.5 1.5 0 01-1.5-1.5v-13z" />
                </svg>
                Compare
              </button>
            </div>

            {/* Secondary: capture a new route photo on-device, then view */}
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-1.5 rounded-md px-4 py-2 text-xs font-medium text-fg-secondary transition hover:bg-inset/60 hover:text-fg"
            >
              <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
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
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
