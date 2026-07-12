"use client";

import { useCallback, useRef } from "react";
import { type CropFraction } from "@/utils/cropFraction";

// ---------------------------------------------------------------------------
// DualCropOverlay — two nested, simultaneously-adjustable crop boxes for the
// detection step: the inner Climber box and the outer Route box. Unlike
// CropBoxOverlay (one box, reused by five other screens), this renders both with
// a deliberate z-order so each is directly grabbable:
//   • inside the climber  → moves the climber (climber layer is on top)
//   • the ring between     → moves the route
//   • each box's edge handles resize that box
// Containment physics (climber pushes route out, route can't cross inside the
// climber) live in the parent via utils/cropContainment — this component only
// emits the raw dragged box per target. See ADR 0014.
// ---------------------------------------------------------------------------

type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";
type Target = "climber" | "route";

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

/** Minimum size of a crop box as a fraction of the container. */
const MIN_SIZE = 0.05;
/** Invisible hit area around each handle for easier touch interaction. */
const HIT_AREA_PX = 36;
/** Length of each corner tick in px. */
const SEG_LEN = 12;
/** Thickness of handle line segments in px. */
const SEG_W = 2;

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
    case "nw":
      return { ...base, width: SEG_LEN, height: SEG_LEN, borderTop: thick, borderLeft: thick };
    case "ne":
      return { ...base, width: SEG_LEN, height: SEG_LEN, borderTop: thick, borderRight: thick };
    case "sw":
      return { ...base, width: SEG_LEN, height: SEG_LEN, borderBottom: thick, borderLeft: thick };
    case "se":
      return { ...base, width: SEG_LEN, height: SEG_LEN, borderBottom: thick, borderRight: thick };
    case "n":
      return { ...base, width: SEG_LEN - 2, height: SEG_W, background: color };
    case "s":
      return { ...base, width: SEG_LEN - 2, height: SEG_W, background: color };
    case "e":
      return { ...base, width: SEG_W, height: SEG_LEN - 2, background: color };
    case "w":
      return { ...base, width: SEG_W, height: SEG_LEN - 2, background: color };
    default:
      return base;
  }
}

interface DragState {
  target: Target;
  handle: HandleId;
  startX: number;
  startY: number;
  startBox: CropFraction;
}

interface DualCropOverlayProps {
  climber: CropFraction;
  route: CropFraction;
  /** Fires with the raw dragged Climber box (frame-clamped, not route-clamped). */
  onClimberChange: (box: CropFraction) => void;
  /** Fires with the raw dragged Route box (frame-clamped, not climber-clamped). */
  onRouteChange: (box: CropFraction) => void;
  climberColor?: string;
  routeColor?: string;
  disabled?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Apply a handle drag to a start box, clamped only to the frame [0, 1] and the
 * minimum size. Cross-box containment is the parent's job.
 */
function applyDrag(handle: HandleId, sb: CropFraction, dx: number, dy: number): CropFraction {
  let { x, y, w, h } = sb;
  switch (handle) {
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
  return { x, y, w, h };
}

export default function DualCropOverlay({
  climber,
  route,
  onClimberChange,
  onRouteChange,
  climberColor = "rgba(255,255,255,0.90)",
  routeColor = "rgba(251,191,36,0.90)",
  disabled = false,
}: DualCropOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const startDrag = useCallback(
    (e: React.PointerEvent, target: Target, handle: HandleId) => {
      if (disabled) return;
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        target,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startBox: { ...(target === "climber" ? climber : route) },
      };
    },
    [climber, route, disabled],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      const cont = containerRef.current;
      if (!d || !cont) return;
      const rect = cont.getBoundingClientRect();
      const dx = (e.clientX - d.startX) / rect.width;
      const dy = (e.clientY - d.startY) / rect.height;
      const next = applyDrag(d.handle, d.startBox, dx, dy);
      if (d.target === "climber") onClimberChange(next);
      else onRouteChange(next);
    },
    [onClimberChange, onRouteChange],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

  function boxLayer(box: CropFraction, color: string, target: Target) {
    const { x, y, w, h } = box;
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
      <>
        <div
          className="absolute box-border"
          style={{
            left: pct(x),
            top: pct(y),
            width: pct(w),
            height: pct(h),
            border: `1px solid ${color}`,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
            cursor: disabled ? "default" : CURSOR_MAP.move,
          }}
          onPointerDown={disabled ? undefined : (e) => startDrag(e, target, "move")}
        />
        {!disabled &&
          handles.map(([id, lx, ly]) => (
            <div
              key={`${target}-${id}`}
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
              onPointerDown={(e) => startDrag(e, target, id)}
            >
              <div style={getHandleKnobStyle(id, color)} />
            </div>
          ))}
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 select-none touch-none overflow-hidden"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Dark mask outside the Route window (4 strips) — the Route is what ORB
          analyses, so everything outside it is dimmed. The Climber draws as an
          inner outline with no extra mask. */}
      <div
        className="crop-overlay-mask absolute left-0 right-0 top-0 pointer-events-none"
        style={{ height: pct(route.y) }}
      />
      <div
        className="crop-overlay-mask absolute left-0 right-0 bottom-0 pointer-events-none"
        style={{ top: pct(route.y + route.h) }}
      />
      <div
        className="crop-overlay-mask absolute pointer-events-none"
        style={{
          top: pct(route.y),
          left: 0,
          width: pct(route.x),
          bottom: pct(1 - route.y - route.h),
        }}
      />
      <div
        className="crop-overlay-mask absolute pointer-events-none"
        style={{
          top: pct(route.y),
          left: pct(route.x + route.w),
          right: 0,
          bottom: pct(1 - route.y - route.h),
        }}
      />

      {/* Route layer below, Climber layer on top so the climber wins ties. */}
      {boxLayer(route, routeColor, "route")}
      {boxLayer(climber, climberColor, "climber")}
    </div>
  );
}
