"use client";

import type { KeyboardEvent } from "react";
import { useMemo } from "react";
import { cn } from "@/utils/cn";

export type DetectionFrameStatus = "detected" | "weak" | "missing" | "flip";

export interface DetectionFrame {
  timestamp: number;
  status: DetectionFrameStatus;
}

export interface DetectionFrameStepperProps {
  frames: DetectionFrame[];
  currentIndex: number;
  onSeek: (index: number) => void;
  onAnnotate?: (index: number) => void;
  onTogglePlay?: () => void;
  isPlaying?: boolean;
  className?: string;
}

interface Stretch {
  start: number;
  end: number;
}

const STATUS_TONE: Record<DetectionFrameStatus, string> = {
  detected: "bg-send",
  weak: "bg-caution",
  missing: "bg-danger",
  flip: "bg-surface-alt border border-edge",
};

const STATUS_LABEL: Record<DetectionFrameStatus, string> = {
  detected: "detected",
  weak: "weak",
  missing: "missing",
  flip: "flip",
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function buildStretches(frames: DetectionFrame[]): Stretch[] {
  const stretches: Stretch[] = [];
  let start = -1;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const flagged = frame.status === "weak" || frame.status === "missing";
    if (flagged) {
      if (start < 0) start = index;
      continue;
    }
    if (start >= 0) {
      stretches.push({ start, end: index - 1 });
      start = -1;
    }
  }

  if (start >= 0) {
    stretches.push({ start, end: frames.length - 1 });
  }

  return stretches;
}

function findNextStretch(stretches: Stretch[], currentIndex: number): Stretch | null {
  for (const stretch of stretches) {
    if (stretch.start > currentIndex) return stretch;
  }
  return null;
}

export default function DetectionFrameStepper({
  frames,
  currentIndex,
  onSeek,
  onAnnotate,
  onTogglePlay,
  isPlaying = false,
  className,
}: DetectionFrameStepperProps) {
  const stretches = useMemo(() => buildStretches(frames), [frames]);
  const nextStretch = useMemo(() => findNextStretch(stretches, currentIndex), [stretches, currentIndex]);
  const stepPx = 13;
  const trackWidth = frames.length > 0 ? frames.length * stepPx - 4 : 0;

  function seekIndex(index: number) {
    if (index < 0 || index >= frames.length) return;
    onSeek(index);
    onAnnotate?.(index);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekIndex(Math.max(0, currentIndex - 1));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      seekIndex(Math.min(frames.length - 1, currentIndex + 1));
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      onTogglePlay?.();
    }
  }

  return (
    <section
      tabIndex={0}
      role="group"
      onKeyDown={handleKeyDown}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-edge/50 bg-surface px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        className,
      )}
      aria-label="Detection frame stepper"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onTogglePlay?.()}
          disabled={!onTogglePlay}
          className="rounded-md bg-surface-alt px-3 py-1.5 text-xs font-medium text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => seekIndex(Math.max(0, currentIndex - 1))}
          disabled={frames.length === 0 || currentIndex <= 0}
          className="rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          Prev frame
        </button>
        <button
          type="button"
          onClick={() => seekIndex(Math.min(frames.length - 1, currentIndex + 1))}
          disabled={frames.length === 0 || currentIndex >= frames.length - 1}
          className="rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next frame
        </button>
        <button
          type="button"
          onClick={() => nextStretch && seekIndex(nextStretch.start)}
          disabled={!nextStretch}
          className="rounded-md bg-caution-surface px-3 py-1.5 text-xs font-medium text-caution disabled:cursor-not-allowed disabled:opacity-50"
        >
          Jump to next flagged stretch
        </button>
        <div className="ml-auto text-xs text-fg-muted">
          Frame {frames.length === 0 ? 0 : currentIndex + 1} / {frames.length}
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="relative" style={{ width: `${trackWidth}px`, minWidth: "100%" }}>
          {stretches.map((stretch) => {
            const left = stretch.start * stepPx;
            const width = Math.max(6, (stretch.end - stretch.start + 1) * stepPx - 2);
            return (
              <div
                key={`${stretch.start}-${stretch.end}`}
                aria-hidden="true"
                data-testid="flagged-stretch"
                className="absolute inset-y-1 rounded-md border border-caution-border bg-caution-surface/40"
                style={{ left, width }}
              />
            );
          })}

          <div className="relative flex items-end gap-0.5 py-1">
            {frames.map((frame, index) => {
              const active = index === currentIndex;
              return (
                <button
                  key={`${frame.timestamp}-${index}`}
                  type="button"
                  title={`${formatTime(frame.timestamp)} · ${STATUS_LABEL[frame.status]}`}
                  aria-label={`Seek to ${formatTime(frame.timestamp)} (${STATUS_LABEL[frame.status]})`}
                  onClick={() => seekIndex(index)}
                  className={cn(
                    "h-8 w-2 rounded-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                    STATUS_TONE[frame.status],
                    active && "scale-y-125 ring-2 ring-fg ring-offset-1 ring-offset-surface",
                  )}
                />
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
