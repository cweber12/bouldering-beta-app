"use client";

import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import type { FrameReviewMark, WrongStretch } from "@/utils/harnessGroundTruthScaffold";

export type DetectionFrameStatus = "detected" | "weak" | "missing" | "flip";

export interface DetectionFrame {
  timestamp: number;
  /**
   * The detector's verdict for this frame, when a detection run produced one.
   * Omitted on a bare Detection Frame grid (calibration reviews the ViTPose seed
   * over the uniform grid, where no detector has run), which renders neutral
   * cells and no flagged stretches.
   */
  status?: DetectionFrameStatus;
}

export interface DetectionFrameStepperProps {
  frames: DetectionFrame[];
  /**
   * Optional per-frame thumbnail (data/object URL), parallel to `frames`. When a
   * frame's thumbnail is present it fills the film-strip cell as a still; while
   * it is `undefined` the cell shows a status-colored placeholder that resolves
   * to the still once ready. Generation lives outside this component (see
   * `useDetectionThumbnails`) so it stays presentational and reusable.
   */
  thumbnails?: (string | undefined)[];
  /**
   * Optional per-frame Ground Truth review mark, parallel to `frames`. When
   * present, human-flagged (Wrong / Absent) and seeded-absent frames render a
   * distinct marker under the thumbnail so the author can jump straight to the
   * frames worth a second look; ordinary auto frames show none.
   */
  frameMarks?: (FrameReviewMark | undefined)[];
  /**
   * Derived Wrong stretches (frameIndex ranges) for the Ground Truth review. When
   * present, a continuous caution bar spans each stretch — bridging seeded-absent
   * gaps so a wrong-person episode reads as one span — and the Jump control walks
   * to the start of the next Wrong stretch. When omitted (a detection run), the
   * bar and Jump fall back to the detector's weak/missing stretches.
   */
  wrongStretches?: WrongStretch[];
  currentIndex: number;
  onSeek: (index: number) => void;
  onAnnotate?: (index: number) => void;
  onTogglePlay?: () => void;
  isPlaying?: boolean;
  className?: string;
}

/**
 * Marker colour under each cell for its review mark (auto shows no marker). The
 * `flagged-wrong` dot is dropped — the continuous Wrong-stretch bar above the
 * strip carries that signal, so a per-frame dot would be redundant. The
 * seeded-absent dot is kept so a no-detection gap stays individually legible
 * under the bar.
 */
const MARK_TONE: Record<FrameReviewMark, string | null> = {
  auto: null,
  "seeded-absent": "bg-fg-muted",
  "flagged-wrong": null,
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

/**
 * Film-strip cell height (px). Each thumbnail fills this height; its width
 * follows the frame's aspect ratio, so the strip reads like real film. Cell
 * widths are therefore dynamic, so the flagged-run rule is measured from the
 * live cell offsets rather than computed from a fixed step.
 */
const CELL_HEIGHT = 72;

/** Lookup key for a frame with no detector verdict (a bare grid frame). */
type StatusKey = DetectionFrameStatus | "none";

function statusKey(frame: DetectionFrame): StatusKey {
  return frame.status ?? "none";
}

/** Status-colored 2px border framing each thumbnail. */
const STATUS_BORDER: Record<StatusKey, string> = {
  detected: "border-2 border-send",
  weak: "border-2 border-caution",
  missing: "border-2 border-danger",
  flip: "border-2 border-dashed border-edge",
  none: "border-2 border-edge",
};

/** Fill for a cell whose thumbnail has not been generated yet (graceful fallback). */
const STATUS_PLACEHOLDER: Record<StatusKey, string> = {
  detected: "bg-send/40",
  weak: "bg-caution/40",
  missing: "bg-danger/40",
  flip: "bg-surface-alt",
  none: "bg-surface-alt",
};

const STATUS_LABEL: Record<StatusKey, string> = {
  detected: "detected",
  weak: "weak",
  missing: "missing",
  flip: "flip",
  none: "not analyzed",
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
  thumbnails,
  frameMarks,
  wrongStretches,
  currentIndex,
  onSeek,
  onAnnotate,
  onTogglePlay,
  isPlaying = false,
  className,
}: DetectionFrameStepperProps) {
  // The bar and Jump follow the review's Wrong stretches when supplied, else the
  // detector's weak/missing stretches (a detection run).
  const reviewMode = wrongStretches !== undefined;
  const stretches = useMemo<Stretch[]>(
    () => wrongStretches ?? buildStretches(frames),
    [wrongStretches, frames],
  );
  const nextStretch = useMemo(
    () => findNextStretch(stretches, currentIndex),
    [stretches, currentIndex],
  );
  const jumpLabel = reviewMode ? "Jump to next Wrong stretch" : "Jump to next flagged stretch";

  // Cell widths are aspect-driven (dynamic), so the flagged-run rule can't be
  // laid out by fixed pixel math. Measure each flagged stretch from the live cell
  // offsets and re-measure whenever thumbnails load (widths change) or the track
  // resizes.
  const trackRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [ruleRects, setRuleRects] = useState<{ key: string; left: number; width: number }[]>([]);

  const measureStretches = useCallback(() => {
    const rects = stretches
      .map((stretch) => {
        const startCell = cellRefs.current[stretch.start];
        const endCell = cellRefs.current[stretch.end];
        if (!startCell || !endCell) return null;
        const left = startCell.offsetLeft;
        const width = endCell.offsetLeft + endCell.offsetWidth - left;
        return { key: `${stretch.start}-${stretch.end}`, left, width };
      })
      .filter((rect): rect is { key: string; left: number; width: number } => rect !== null);
    setRuleRects(rects);
  }, [stretches]);

  useLayoutEffect(() => {
    measureStretches();
  }, [measureStretches, thumbnails, frames]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureStretches());
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureStretches]);

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
          {jumpLabel}
        </button>
        <div className="ml-auto text-xs text-fg-muted">
          Frame {frames.length === 0 ? 0 : currentIndex + 1} / {frames.length}
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        {/* pt-2 reserves the top strip for the flagged-run rule; the row is the
            positioned ancestor the measured rule offsets are relative to. */}
        <div ref={trackRef} className="relative flex w-max min-w-full items-start gap-0.5 pt-2">
          {ruleRects.map((rect) => (
            <div
              key={rect.key}
              aria-hidden="true"
              data-testid="flagged-stretch"
              className="absolute top-0 h-1 rounded-full bg-caution"
              style={{ left: rect.left, width: rect.width }}
            />
          ))}

          {frames.map((frame, index) => {
            const active = index === currentIndex;
            const thumbnail = thumbnails?.[index];
            const mark = frameMarks?.[index];
            const marker = mark ? MARK_TONE[mark] : null;
            const markLabel = mark ? MARK_LABEL[mark] : null;
            const key = statusKey(frame);
            const label = markLabel
              ? `${formatTime(frame.timestamp)} · ${STATUS_LABEL[key]} · ${markLabel}`
              : `${formatTime(frame.timestamp)} · ${STATUS_LABEL[key]}`;
            return (
              <div
                key={`${frame.timestamp}-${index}`}
                className="flex flex-col items-center gap-0.5"
              >
                <button
                  ref={(el) => {
                    cellRefs.current[index] = el;
                  }}
                  type="button"
                  title={label}
                  aria-label={`Seek to ${formatTime(frame.timestamp)} (${STATUS_LABEL[key]})`}
                  onClick={() => seekIndex(index)}
                  style={{ height: CELL_HEIGHT }}
                  className={cn(
                    "block w-fit shrink-0 overflow-hidden rounded-sm bg-surface-alt p-0 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                    STATUS_BORDER[key],
                    active && "ring-2 ring-fg ring-offset-1 ring-offset-surface",
                  )}
                >
                  {thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnail}
                      alt=""
                      aria-hidden="true"
                      onLoad={measureStretches}
                      className="block h-full w-auto"
                    />
                  ) : (
                    // Aspect-ratio placeholder (portrait ascent) so the strip has
                    // structure before thumbnails decode.
                    <span
                      aria-hidden="true"
                      className={cn("block h-full w-auto aspect-9/16", STATUS_PLACEHOLDER[key])}
                    />
                  )}
                </button>
                {/* Fixed-height slot keeps cells aligned; coloured per review mark. */}
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
    </section>
  );
}
