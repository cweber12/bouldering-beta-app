"use client";

import { useCallback, useRef } from "react";
import { DEFAULT_CROP, type CropFraction } from "@/utils/cropFraction";

// Re-export the plain-data crop types/constants (defined in utils/cropFraction
// to keep the hook/pipeline layers free of React imports) so component callers
// can keep importing them from this component.
export { DEFAULT_CROP, type CropFraction };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CropBoxOverlayProps {
  box: CropFraction;
  onChange: (box: CropFraction) => void;
  disabled?: boolean;
  /**
   * Border-radius applied to the crop-window border so it matches the
   * containing media element's rounded corners (e.g. "0.75rem" for rounded-xl).
   * Defaults to "4px" for a subtle modern rounding.
   */
  borderRadius?: string;
  /**
   * Color used for the crop box border and corner/edge handles.
   * Pass an rgba string so the box reads clearly on any background.
   * Defaults to white ("rgba(255,255,255,0.90)").
   */
  color?: string;
  /** Show the rule-of-thirds grid inside the crop window. Off by default for a cleaner UI. */
  showGrid?: boolean;
  /**
   * Fires when the user taps (not drags) an empty area of the overlay — i.e.
   * outside the crop window and its handles. Reports the tap as a fractional
   * point [0, 1] of the container. Used to seed climber-identity tracking by
   * tapping directly on the climber.
   */
  onTap?: (point: { x: number; y: number }) => void;
  /**
   * Render as a bare tap surface — no crop window, mask, or handles, and the
   * whole area reports taps via {@link onTap}. Used for "tap the climber"
   * selection before any box exists, so the box never blocks the tap.
   */
  tapOnly?: boolean;
  /**
   * Render the crop window read-only: it shows the box + mask but has **no
   * resize handles and no drag**, while still reporting taps via {@link onTap}.
   * Used for the landmark-derived Climber box, which the user re-positions by
   * tapping a different climber rather than resizing (ADR 0013).
   */
  locked?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

const CURSOR_MAP: Record<HandleId, string> = {
  nw: "nw-resize",
  n: "n-resize",
  ne: "ne-resize",
  e: "e-resize",
  se: "se-resize",
  s: "s-resize",
  sw: "sw-resize",
  w: "w-resize",
  move: "move",
};

/** Minimum size of the crop box as a fraction of the container. */
const MIN_SIZE = 0.05;

/** Invisible hit area around each handle for easier touch interaction. */
const HIT_AREA_PX = 36;

/** Max pointer travel (px) for a press-release to count as a tap, not a drag. */
const TAP_MOVE_TOLERANCE_PX = 6;

/** Length of each corner tick in px. */
const SEG_LEN = 12;
/** Thickness of handle line segments in px. */
const SEG_W = 2;

/**
 * Returns the inline style for the visible handle knob.
 * Handles have no individual box-shadow — contrast comes from the unified
 * dark outer ring on the main border element, keeping the design cohesive.
 */
function getHandleKnobStyle(id: HandleId, color: string): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    pointerEvents: "none",
    boxSizing: "border-box",
  };
  const thick = `${SEG_W}px solid ${color}`;
  switch (id) {
    case "nw": return { ...base, width: SEG_LEN, height: SEG_LEN, borderTop: thick, borderLeft: thick };
    case "ne": return { ...base, width: SEG_LEN, height: SEG_LEN, borderTop: thick, borderRight: thick };
    case "sw": return { ...base, width: SEG_LEN, height: SEG_LEN, borderBottom: thick, borderLeft: thick };
    case "se": return { ...base, width: SEG_LEN, height: SEG_LEN, borderBottom: thick, borderRight: thick };
    case "n":  return { ...base, width: SEG_LEN - 2, height: SEG_W, background: color };
    case "s":  return { ...base, width: SEG_LEN - 2, height: SEG_W, background: color };
    case "e":  return { ...base, width: SEG_W, height: SEG_LEN - 2, background: color };
    case "w":  return { ...base, width: SEG_W, height: SEG_LEN - 2, background: color };
    default: return base;
  }
}

interface DragState {
  handle: HandleId;
  startX: number;
  startY: number;
  startBox: CropFraction;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders an interactive draggable/resizable crop box overlay.
 *
 * Must be placed inside a `position: relative` container. It fills the
 * container via `position: absolute; inset: 0`.
 *
 * The `box` prop and `onChange` callback use fractional coordinates [0, 1]
 * relative to the container's rendered size. Multiply by the natural image/
 * video dimensions to obtain pixel coordinates for processing.
 */
export default function CropBoxOverlay({
  box,
  onChange,
  disabled = false,
  borderRadius = "2px",
  color = "rgba(255,255,255,0.90)",
  showGrid = false,
  onTap,
  tapOnly = false,
  locked = false,
}: CropBoxOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  // Tracks a potential tap on empty overlay area (no handle/border involved).
  const tapStartRef = useRef<{ x: number; y: number } | null>(null);

  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));

  const startDrag = useCallback(
    (e: React.PointerEvent, handle: HandleId) => {
      if (disabled) return;
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startBox: { ...box },
      };
    },
    [box, disabled],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dx = (e.clientX - dragRef.current.startX) / rect.width;
      const dy = (e.clientY - dragRef.current.startY) / rect.height;
      const sb = dragRef.current.startBox;
      let { x, y, w, h } = sb;

      switch (dragRef.current.handle) {
        case "move":
          x = clamp(sb.x + dx, 0, 1 - sb.w);
          y = clamp(sb.y + dy, 0, 1 - sb.h);
          break;
        case "nw":
          x = clamp(sb.x + dx, 0, sb.x + sb.w - MIN_SIZE);
          y = clamp(sb.y + dy, 0, sb.y + sb.h - MIN_SIZE);
          w = sb.x + sb.w - x;
          h = sb.y + sb.h - y;
          break;
        case "n":
          y = clamp(sb.y + dy, 0, sb.y + sb.h - MIN_SIZE);
          h = sb.y + sb.h - y;
          break;
        case "ne":
          y = clamp(sb.y + dy, 0, sb.y + sb.h - MIN_SIZE);
          w = clamp(sb.w + dx, MIN_SIZE, 1 - sb.x);
          h = sb.y + sb.h - y;
          break;
        case "e":
          w = clamp(sb.w + dx, MIN_SIZE, 1 - sb.x);
          break;
        case "se":
          w = clamp(sb.w + dx, MIN_SIZE, 1 - sb.x);
          h = clamp(sb.h + dy, MIN_SIZE, 1 - sb.y);
          break;
        case "s":
          h = clamp(sb.h + dy, MIN_SIZE, 1 - sb.y);
          break;
        case "sw":
          x = clamp(sb.x + dx, 0, sb.x + sb.w - MIN_SIZE);
          w = sb.x + sb.w - x;
          h = clamp(sb.h + dy, MIN_SIZE, 1 - sb.y);
          break;
        case "w":
          x = clamp(sb.x + dx, 0, sb.x + sb.w - MIN_SIZE);
          w = sb.x + sb.w - x;
          break;
      }

      onChange({ x, y, w, h });
    },
    [onChange],
  );

  // A pointerdown that reaches the root (children stop propagation) is a
  // candidate tap on empty area. Record its start so onPointerUp can decide
  // whether it was a tap or the beginning of a drag-elsewhere.
  const onRootPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || !onTap) return;
      tapStartRef.current = { x: e.clientX, y: e.clientY };
    },
    [disabled, onTap],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const wasDragging = dragRef.current !== null;
      dragRef.current = null;

      const tapStart = tapStartRef.current;
      tapStartRef.current = null;
      if (wasDragging || !tapStart || !onTap || !containerRef.current) return;

      const moved = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y);
      if (moved > TAP_MOVE_TOLERANCE_PX) return; // treat as drag, not tap

      const rect = containerRef.current.getBoundingClientRect();
      const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      onTap({ x, y });
    },
    [onTap],
  );

  // Tap-only: the whole overlay is a tap surface, no box to avoid.
  if (tapOnly) {
    return (
      <div
        ref={containerRef}
        className="absolute inset-0 select-none touch-none overflow-hidden"
        style={{ cursor: disabled ? "default" : "crosshair" }}
        onPointerDown={onRootPointerDown}
        onPointerUp={onPointerUp}
      />
    );
  }

  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  const { x, y, w, h } = box;

  // Handle positions: [id, left%, top%]
  const handles: Array<[HandleId, number, number]> = [
    ["nw", x, y],
    ["n", x + w / 2, y],
    ["ne", x + w, y],
    ["e", x + w, y + h / 2],
    ["se", x + w, y + h],
    ["s", x + w / 2, y + h],
    ["sw", x, y + h],
    ["w", x, y + h / 2],
  ];

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 select-none touch-none overflow-hidden"
      onPointerDown={onRootPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Dark overlay: 4 strips outside the crop window */}
      <div
        className="crop-overlay-mask absolute left-0 right-0 top-0 pointer-events-none"
        style={{ height: pct(y) }}
      />
      <div
        className="crop-overlay-mask absolute left-0 right-0 bottom-0 pointer-events-none"
        style={{ top: pct(y + h) }}
      />
      <div
        className="crop-overlay-mask absolute pointer-events-none"
        style={{
          top: pct(y),
          left: 0,
          width: pct(x),
          bottom: pct(1 - y - h),
        }}
      />
      <div
        className="crop-overlay-mask absolute pointer-events-none"
        style={{
          top: pct(y),
          left: pct(x + w),
          right: 0,
          bottom: pct(1 - y - h),
        }}
      />

      {/* Optional rule-of-thirds grid inside the crop window. */}
      {showGrid && (
        <div
          className="absolute pointer-events-none overflow-hidden"
          style={{
            left: pct(x),
            top: pct(y),
            width: pct(w),
            height: pct(h),
            borderRadius,
          }}
        >
          {[1 / 3, 2 / 3].map((f) => (
            <div
              key={`v${f}`}
              className="crop-overlay-gridline absolute top-0 bottom-0"
              style={{ left: `${(f * 100).toFixed(3)}%`, width: "1px" }}
            />
          ))}
          {[1 / 3, 2 / 3].map((f) => (
            <div
              key={`h${f}`}
              className="crop-overlay-gridline absolute left-0 right-0"
              style={{ top: `${(f * 100).toFixed(3)}%`, height: "1px" }}
            />
          ))}
        </div>
      )}

      {/* Crop window border + move target.
          Single unified box-shadow provides contrast without individual handle shadows. */}
      <div
        className="absolute box-border"
        style={{
          left: pct(x),
          top: pct(y),
          width: pct(w),
          height: pct(h),
          border: `1px solid ${color}`,
          borderRadius,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
          cursor: disabled || locked ? "default" : CURSOR_MAP["move"],
        }}
        onPointerDown={disabled || locked ? undefined : (e) => startDrag(e, "move")}
      />

      {/* Resize handles — large invisible hit area with visible L-bracket / bar knob.
          No individual shadows: the border's boxShadow provides the necessary contrast.
          Hidden when locked: the Climber box is landmark-derived, not resized. */}
      {!disabled && !locked &&
        handles.map(([id, lx, ly]) => (
          <div
            key={id}
            className="absolute"
            style={{
              left: pct(lx),
              top: pct(ly),
              width: HIT_AREA_PX,
              height: HIT_AREA_PX,
              transform: "translate(-50%, -50%)",
              cursor: CURSOR_MAP[id],
              touchAction: "none",
            }}
            onPointerDown={(e) => startDrag(e, id)}
          >
            <div style={getHandleKnobStyle(id, color)} />
          </div>
        ))}
    </div>
  );
}
