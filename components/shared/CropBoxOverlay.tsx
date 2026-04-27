"use client";

import { useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Crop region expressed as fractions of the container dimensions.
 * All values are in [0, 1] relative to the image/video natural dimensions.
 */
export interface CropFraction {
  /** Left edge fraction [0, 1] */
  x: number;
  /** Top edge fraction [0, 1] */
  y: number;
  /** Width fraction [0, 1] */
  w: number;
  /** Height fraction [0, 1] */
  h: number;
}

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

/** Length of each L-bracket arm in px — large enough to look like part of the border. */
const SEG_LEN = 22;
/** Thickness of handle line segments in px. */
const SEG_W = 3;

/** Default crop box: slight inset from edges. */
export const DEFAULT_CROP: CropFraction = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };

/**
 * Returns the inline style for the visible handle knob.
 * Handles have no individual box-shadow — contrast comes from the unified
 * dark outer ring on the main border element, keeping the design cohesive.
 */
function getHandleKnobStyle(id: HandleId, cr: string, color: string): React.CSSProperties {
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
    case "nw": return { ...base, width: SEG_LEN, height: SEG_LEN, borderTop: thick, borderLeft: thick, borderTopLeftRadius: cr };
    case "ne": return { ...base, width: SEG_LEN, height: SEG_LEN, borderTop: thick, borderRight: thick, borderTopRightRadius: cr };
    case "sw": return { ...base, width: SEG_LEN, height: SEG_LEN, borderBottom: thick, borderLeft: thick, borderBottomLeftRadius: cr };
    case "se": return { ...base, width: SEG_LEN, height: SEG_LEN, borderBottom: thick, borderRight: thick, borderBottomRightRadius: cr };
    case "n":  return { ...base, width: SEG_LEN, height: SEG_W, background: color };
    case "s":  return { ...base, width: SEG_LEN, height: SEG_W, background: color };
    case "e":  return { ...base, width: SEG_W, height: SEG_LEN, background: color };
    case "w":  return { ...base, width: SEG_W, height: SEG_LEN, background: color };
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
  borderRadius = "4px",
  color = "rgba(255,255,255,0.90)",
}: CropBoxOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

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

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

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
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Dark overlay: 4 strips outside the crop window */}
      <div
        className="absolute left-0 right-0 top-0 pointer-events-none"
        style={{ background: "rgba(0,0,0,0.52)", height: pct(y) }}
      />
      <div
        className="absolute left-0 right-0 bottom-0 pointer-events-none"
        style={{ background: "rgba(0,0,0,0.52)", top: pct(y + h) }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          background: "rgba(0,0,0,0.52)",
          top: pct(y),
          left: 0,
          width: pct(x),
          bottom: pct(1 - y - h),
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          background: "rgba(0,0,0,0.52)",
          top: pct(y),
          left: pct(x + w),
          right: 0,
          bottom: pct(1 - y - h),
        }}
      />

      {/* Rule-of-thirds grid inside the crop window */}
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
            className="absolute top-0 bottom-0"
            style={{ left: `${(f * 100).toFixed(3)}%`, width: "1px", background: "rgba(255,255,255,0.16)" }}
          />
        ))}
        {[1 / 3, 2 / 3].map((f) => (
          <div
            key={`h${f}`}
            className="absolute left-0 right-0"
            style={{ top: `${(f * 100).toFixed(3)}%`, height: "1px", background: "rgba(255,255,255,0.16)" }}
          />
        ))}
      </div>

      {/* Crop window border + move target.
          Single unified box-shadow provides contrast without individual handle shadows. */}
      <div
        className="absolute box-border"
        style={{
          left: pct(x),
          top: pct(y),
          width: pct(w),
          height: pct(h),
          border: `1.5px solid ${color}`,
          borderRadius,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.60)",
          cursor: disabled ? "default" : CURSOR_MAP["move"],
        }}
        onPointerDown={disabled ? undefined : (e) => startDrag(e, "move")}
      />

      {/* Resize handles — large invisible hit area with visible L-bracket / bar knob.
          No individual shadows: the border's boxShadow provides the necessary contrast. */}
      {!disabled &&
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
            <div style={getHandleKnobStyle(id, borderRadius, color)} />
          </div>
        ))}
    </div>
  );
}
