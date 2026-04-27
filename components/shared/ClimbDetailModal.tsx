"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import ClimbOptionsDropdown from "@/components/shared/ClimbOptionsDropdown";
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
}

// ---------------------------------------------------------------------------
// ClimbDetailModal — full-screen overlay showing climb info + image
// ---------------------------------------------------------------------------

export default function ClimbDetailModal({ climb, onClose }: ClimbDetailModalProps) {
  const router = useRouter();
  const isSend = climb.runType === "send";

  const viewUrl = `/view?key=${encodeURIComponent(climb.key)}`;
  const compareUrl = [
    `/compare?key=${encodeURIComponent(climb.key)}`,
    climb.state && `state=${encodeURIComponent(climb.state)}`,
    climb.area && `area=${encodeURIComponent(climb.area)}`,
    climb.route && `route=${encodeURIComponent(climb.route)}`,
  ]
    .filter(Boolean)
    .join("&");

  const go = (url: string) => {
    onClose();
    router.push(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface/70 backdrop-blur-sm px-4 py-6"
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

        {/* Image area — top of card (fixes rounded-t-2xl alignment) */}
        <div className="relative aspect-video w-full overflow-hidden rounded-t-2xl bg-inset">
          {climb.thumbnail ? (
            <Image
              src={climb.thumbnail}
              alt={`${climb.route} climb`}
              fill
              unoptimized
              className="object-cover"
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

          {/* Expand to full view button */}
          <button
            type="button"
            onClick={() => go(viewUrl)}
            className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-surface/80 px-2.5 py-1 text-xs font-medium text-fg backdrop-blur-sm transition hover:bg-surface"
            aria-label="View on route photo"
          >
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            View
          </button>
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

          {/* Explicit action row — View, Compare, overflow options */}
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => go(viewUrl)}
              className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition hover:bg-accent-hover"
            >
              View on Photo
            </button>
            <button
              type="button"
              onClick={() => go(compareUrl)}
              className="flex-1 rounded-xl border border-edge px-4 py-2.5 text-sm font-medium text-fg-secondary transition hover:border-edge-hover hover:text-fg"
            >
              Compare
            </button>
            {/* Overflow: photo selection + additional navigation */}
            <ClimbOptionsDropdown
              climbKey={climb.key}
              state={climb.state}
              area={climb.area}
              route={climb.route}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
