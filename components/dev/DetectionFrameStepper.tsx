"use client";

import type { KeyboardEvent } from "react";
import { useMemo } from "react";
import { cn } from "@/utils/cn";
import type { FrameReviewMark } from "@/utils/harnessGroundTruthScaffold";

export type DetectionFrameStatus = "detected" | "weak" | "missing" | "flip";

export interface DetectionFrame {
  timestamp: number;
  status: DetectionFrameStatus;
}

export interface DetectionFrameStepperProps {
  frames: DetectionFrame[];
  /**
   * Optional per-frame Ground Truth review mark, parallel to `frames`. When
   * present, human-flagged (Wrong / Absent) and seeded-absent frames render a
   * distinct marker under the bar so the author can jump straight to the frames
   * worth a second look; ordinary auto frames show none.
   */
  frameMarks?: (FrameReviewMark | undefined)[];
  currentIndex: number;
  onSeek: (index: number) => void;
  onAnnotate?: (index: number) => void;
  onTogglePlay?: () => void;
  isPlaying?: boolean;
  className?: string;
}

/** Marker colour under each bar for its review mark (auto shows no marker). */
const MARK_TONE: Record<FrameReviewMark, string | null> = {
  auto: null,
  "seeded-absent": "bg-fg-muted",
  "flagged-wrong": "bg-caution",
  "flagged-absent": "bg-danger",
};

/** Short label appended to the bar title for authoring feedback. */
const MARK_LABEL: Record<FrameReviewMark, string | null> = {
  auto: null,
  "seeded-absent": "seeded absent",
  "flagged-wrong": "flagged wrong",
  "flagged-absent": "flagged absent",
};

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
  frameMarks,
  currentIndex,
  onSeek,
  onAnnotate,
  onTogglePlay,
  isPlaying = false,
  className,
}: DetectionFrameStepperProps) {
  const stretches = useMemo(() => buildStretches(frames), [frames]);
  const nextStretch = useMemo(
    () => findNextStretch(stretches, currentIndex),
    [stretches, currentIndex],
  );
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
              const mark = frameMarks?.[index];
              const marker = mark ? MARK_TONE[mark] : null;
              const markLabel = mark ? MARK_LABEL[mark] : null;
              const label = markLabel
                ? `${formatTime(frame.timestamp)} · ${STATUS_LABEL[frame.status]} · ${markLabel}`
                : `${formatTime(frame.timestamp)} · ${STATUS_LABEL[frame.status]}`;
              return (
                <div key={`${frame.timestamp}-${index}`} className="flex flex-col items-center gap-0.5">
                  <button
                    type="button"
                    title={label}
                    aria-label={`Seek to ${formatTime(frame.timestamp)} (${STATUS_LABEL[frame.status]})`}
                    onClick={() => seekIndex(index)}
                    className={cn(
                      "h-8 w-2 rounded-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                      STATUS_TONE[frame.status],
                      active && "scale-y-125 ring-2 ring-fg ring-offset-1 ring-offset-surface",
                    )}
                  />
                  {/* Fixed-height slot keeps bar bottoms aligned; coloured per review mark. */}
                  <span
                    aria-hidden="true"
                    data-testid={marker ? "frame-mark-marker" : undefined}
                    data-mark={mark}
                    className={cn("h-1 w-2 rounded-full", marker ?? "bg-transparent")}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
