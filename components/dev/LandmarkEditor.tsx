"use client";

/**
 * Dev-only Ground Truth landmark-correction editor.
 *
 * Renders one Detection Frame paused from the video and lets the author drag the
 * **core body joints** into place, place a joint the scaffold missed (or seed a
 * whole absent frame), translate the whole skeleton when the pose is right but
 * offset, or accept the frame as-is. Non-core BlazePose points draw faintly for
 * context and are not editable. Any edit marks the frame verified; the parent
 * persists to `ground-truth.json`. A zoom/pan viewport keeps small joints
 * grabbable in portrait video, and every status line renders outside the frame.
 * See docs/adr/0018 and issue 04. Rendered only in the development harness.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { dark } from "@/utils/theme";
import { getTopology } from "@/utils/poseConstants";
import {
  jointDrift,
  moveJoint,
  removeJoint,
  setJoint,
  translateJoints,
  type DriftReadout,
} from "@/utils/harnessGroundTruthScaffold";
import {
  CORE_JOINT_NAMES,
  type GroundTruthFrame,
  type GroundTruthJoint,
  type GroundTruthState,
} from "@/utils/harnessGroundTruth";

type Pos = { x: number; y: number };

export interface LandmarkEditorProps {
  videoSrc: string;
  /** Native video dimensions — the canvas draws at this resolution. */
  videoWidth: number;
  videoHeight: number;
  /** The Detection Frame being authored. */
  frame: GroundTruthFrame;
  /** The scaffold seed for this frame's joints — the drift baseline. */
  seedJoints: Record<string, GroundTruthJoint>;
  /** Non-core scaffold keypoints (video-normalised) drawn faintly for context. */
  contextKeypoints: Record<string, Pos>;
  /** Called with the frame's new joints after a drag / place / translate (marks verified). */
  onEditJoints: (joints: Record<string, GroundTruthJoint>) => void;
  /** Set the frame's GT state (present / absent / skip); marks verified. */
  onSetState: (state: GroundTruthState) => void;
  /** Toggle one core joint's `occluded` flag (marks verified). */
  onToggleOccluded: (name: string) => void;
  /** Accept the frame's landmarks as-is (marks verified without editing). */
  onAccept: () => void;
  className?: string;
}

const STATE_OPTIONS: readonly { value: GroundTruthState; label: string; hint: string }[] = [
  { value: "present", label: "Present", hint: "Climber is here — pose scored" },
  { value: "absent", label: "Absent", hint: "No climber — a detected pose here is a false positive" },
  { value: "skip", label: "Skip", hint: "Exclude this frame from scoring" },
];

const { keypointNames, skeletonEdges } = getTopology("mediapipe");
const NAME_BY_INDEX = keypointNames;

/** Hit radius (screen px) for grabbing a joint. */
const HIT_RADIUS_PX = 20;
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const ZOOM_STEP = 0.5;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Compact joint label: "left_shoulder" → "L shoulder". */
function shortLabel(name: string): string {
  return name.replace(/^left_/, "L ").replace(/^right_/, "R ").replace(/_/g, " ");
}

export default function LandmarkEditor({
  videoSrc,
  videoWidth,
  videoHeight,
  frame,
  seedJoints,
  contextKeypoints,
  onEditJoints,
  onSetState,
  onToggleOccluded,
  onAccept,
  className,
}: LandmarkEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameReadyRef = useRef(false);
  const [translateMode, setTranslateMode] = useState(false);
  const [activeJoint, setActiveJoint] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pos>({ x: 0, y: 0 });

  // Latest joints/context for the draw + pointer maths without stale closures.
  // Synced in effects (never during render) so pointer handlers read fresh values.
  const jointsRef = useRef(frame.joints);
  const contextRef = useRef(contextKeypoints);
  useEffect(() => {
    jointsRef.current = frame.joints;
  }, [frame.joints]);
  useEffect(() => {
    contextRef.current = contextKeypoints;
  }, [contextKeypoints]);

  const drift: DriftReadout = useMemo(
    () => jointDrift(seedJoints, frame.joints),
    [seedJoints, frame.joints],
  );
  const placedNames = Object.keys(frame.joints);
  const hasJoints = placedNames.length > 0;

  /** Merged position lookup: an edited joint overrides the context point. */
  const posOf = useCallback((name: string): Pos | null => {
    return jointsRef.current[name] ?? contextRef.current[name] ?? null;
  }, []);

  // Draw the paused frame + context skeleton + core-joint handles.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const w = videoWidth || video.videoWidth || 16;
    const h = videoHeight || video.videoHeight || 9;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    if (frameReadyRef.current && video.videoWidth > 0) {
      ctx.drawImage(video, 0, 0, w, h);
    } else {
      ctx.fillStyle = dark.surfaceAlt;
      ctx.fillRect(0, 0, w, h);
    }

    const unit = Math.min(w, h);
    const px = (p: Pos) => ({ x: p.x * w, y: p.y * h });

    // Faint context skeleton — every edge whose endpoints we can place.
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = Math.max(1.5, unit * 0.0035);
    for (const [a, b] of skeletonEdges) {
      const pa = posOf(NAME_BY_INDEX[a]);
      const pb = posOf(NAME_BY_INDEX[b]);
      if (!pa || !pb) continue;
      const A = px(pa);
      const B = px(pb);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }
    // Faint dots for non-core context points.
    const coreNames = new Set(Object.keys(jointsRef.current));
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    for (const name of Object.keys(contextRef.current)) {
      if (coreNames.has(name)) continue;
      const p = px(contextRef.current[name]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.5, unit * 0.004), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Editable core joints.
    const rHandle = Math.max(5, unit * 0.012);
    for (const name of Object.keys(jointsRef.current)) {
      const j = jointsRef.current[name];
      const p = px(j);
      const active = name === activeJoint;
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, active ? rHandle * 1.4 : rHandle, 0, Math.PI * 2);
      ctx.fillStyle = j.occluded ? "transparent" : dark.accent;
      ctx.strokeStyle = j.occluded ? dark.caution : "rgba(255,255,255,0.9)";
      ctx.lineWidth = Math.max(2, unit * 0.004);
      if (!j.occluded) ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }, [videoWidth, videoHeight, activeJoint, posOf]);

  // Seek the video to this frame; draw once the frame is decoded.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    frameReadyRef.current = false;
    const onSeeked = () => {
      frameReadyRef.current = true;
      draw();
    };
    video.addEventListener("seeked", onSeeked);
    const applyTime = () => {
      try {
        video.currentTime = frame.timestamp;
      } catch {
        /* not seekable yet — the loadeddata handler retries */
      }
    };
    if (video.readyState >= 1) applyTime();
    else video.addEventListener("loadeddata", applyTime, { once: true });
    return () => video.removeEventListener("seeked", onSeeked);
  }, [frame.timestamp, draw]);

  // Redraw when the joints, context, active handle, or ready state change.
  useEffect(() => {
    draw();
  }, [draw, frame.joints, contextKeypoints]);

  // ── Zoom / pan ────────────────────────────────────────────────────────────
  const clampPan = useCallback((p: Pos, z: number): Pos => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return p;
    const maxX = (rect.width * (z - 1)) / 2;
    const maxY = (rect.height * (z - 1)) / 2;
    return { x: clamp(p.x, -maxX, maxX), y: clamp(p.y, -maxY, maxY) };
  }, []);

  /**
   * Zoom to `next`, keeping the content under (clientX, clientY) fixed on screen.
   * With `transform-origin: center`, screen = C + pan + z·(local − C); solving for
   * a fixed cursor point gives pan' = d·(1 − z'/z) + (z'/z)·pan, d = cursor − C.
   * Omitting the cursor zooms about the centre (the toolbar buttons).
   */
  const zoomAt = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const z2 = clamp(next, ZOOM_MIN, ZOOM_MAX);
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) {
        setZoom(z2);
        return;
      }
      if (z2 === 1) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        return;
      }
      const r = z2 / zoom;
      const dx = clientX != null ? clientX - rect.left - rect.width / 2 : 0;
      const dy = clientY != null ? clientY - rect.top - rect.height / 2 : 0;
      setZoom(z2);
      setPan(clampPan({ x: dx * (1 - r) + r * pan.x, y: dy * (1 - r) + r * pan.y }, z2));
    },
    [zoom, pan, clampPan],
  );

  // Wheel-to-zoom toward the cursor, via a non-passive listener so the page /
  // scroll container never scrolls while zooming. Held in a ref so the listener
  // attaches once but always calls the latest closure.
  const zoomAtRef = useRef(zoomAt);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomAtRef.current = zoomAt;
    zoomRef.current = zoom;
  }, [zoomAt, zoom]);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      zoomAtRef.current(
        zoomRef.current + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP),
        e.clientX,
        e.clientY,
      );
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // ── Pointer interaction ─────────────────────────────────────────────────
  const dragRef = useRef<
    | { mode: "joint"; name: string }
    | { mode: "translate"; startX: number; startY: number; joints: Record<string, GroundTruthJoint> }
    | { mode: "pan"; startX: number; startY: number; panX: number; panY: number }
    | null
  >(null);

  /** Client px → normalised video coords, using the (possibly zoomed) canvas rect. */
  const toNorm = useCallback((clientX: number, clientY: number): Pos => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  }, []);

  /** Nearest core joint within the hit radius (screen px), or null. */
  const hitJoint = useCallback((norm: Pos): string | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    let best: string | null = null;
    let bestDist = HIT_RADIUS_PX;
    for (const name of Object.keys(jointsRef.current)) {
      const j = jointsRef.current[name];
      const dx = (j.x - norm.x) * rect.width;
      const dy = (j.y - norm.y) * rect.height;
      const dist = Math.hypot(dx, dy);
      if (dist <= bestDist) {
        bestDist = dist;
        best = name;
      }
    }
    return best;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const norm = toNorm(e.clientX, e.clientY);

      // Shift-click a joint to toggle its occluded flag (no drag).
      if (e.shiftKey) {
        const name = hitJoint(norm);
        if (name) {
          e.preventDefault();
          onToggleOccluded(name);
          return;
        }
      }

      // Placing a missing joint: drop it here, then drag to fine-tune.
      if (placing) {
        onEditJoints(setJoint(jointsRef.current, placing, norm.x, norm.y));
        dragRef.current = { mode: "joint", name: placing };
        setActiveJoint(placing);
        setPlacing(null);
        (e.target as Element).setPointerCapture?.(e.pointerId);
        e.preventDefault();
        return;
      }

      if (translateMode && Object.keys(jointsRef.current).length > 0) {
        dragRef.current = {
          mode: "translate",
          startX: norm.x,
          startY: norm.y,
          joints: jointsRef.current,
        };
        setActiveJoint(null);
        (e.target as Element).setPointerCapture?.(e.pointerId);
        e.preventDefault();
        return;
      }

      const name = hitJoint(norm);
      if (name) {
        dragRef.current = { mode: "joint", name };
        setActiveJoint(name);
        (e.target as Element).setPointerCapture?.(e.pointerId);
        e.preventDefault();
        return;
      }

      // Empty grab while zoomed → pan the viewport.
      if (zoom > 1) {
        dragRef.current = {
          mode: "pan",
          startX: e.clientX,
          startY: e.clientY,
          panX: pan.x,
          panY: pan.y,
        };
        (e.target as Element).setPointerCapture?.(e.pointerId);
        e.preventDefault();
      }
    },
    [toNorm, hitJoint, placing, translateMode, zoom, pan, onEditJoints, onToggleOccluded],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.mode === "pan") {
        setPan(clampPan({ x: drag.panX + (e.clientX - drag.startX), y: drag.panY + (e.clientY - drag.startY) }, zoom));
        return;
      }
      const norm = toNorm(e.clientX, e.clientY);
      if (drag.mode === "joint") {
        onEditJoints(moveJoint(jointsRef.current, drag.name, norm.x, norm.y));
      } else {
        onEditJoints(translateJoints(drag.joints, norm.x - drag.startX, norm.y - drag.startY));
      }
    },
    [toNorm, onEditJoints, clampPan, zoom],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setActiveJoint(null);
  }, []);

  // Right-click a joint to delete it (a mis-placed point, or one to drop).
  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const name = hitJoint(toNorm(e.clientX, e.clientY));
      if (!name) return;
      e.preventDefault();
      onEditJoints(removeJoint(jointsRef.current, name));
      setActiveJoint(null);
      setPlacing(null);
    },
    [hitJoint, toNorm, onEditJoints],
  );

  const empty = frame.state === "absent" || !hasJoints;
  const unplaced = CORE_JOINT_NAMES.filter((n) => !frame.joints[n]);
  const occludedCount = Object.values(frame.joints).filter((j) => j.occluded).length;

  const hint =
    frame.state === "absent"
      ? "Marked absent — no climber here, so a detected pose scores as a false positive. Set Present to author joints."
      : frame.state === "skip"
        ? "Marked skip — this frame is excluded from scoring. Set Present to include it."
        : placing
          ? `Click on the video to place ${shortLabel(placing).trim()}.`
          : empty
            ? "This frame has no core joints. Pick a joint below, then click on the video to place it — or mark it Absent if the climber is off-screen."
            : unplaced.length > 0
              ? "Drag to correct; shift-click a joint to toggle occluded; right-click to delete. Missing joints are outlined below — pick one, then click on the video. Scroll to zoom."
              : "Drag to correct; shift-click a joint to toggle occluded; right-click to delete. Scroll to zoom toward the cursor, drag the background to pan.";

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {/* Toolbar — always outside the frame. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Per-frame GT state — present / absent / skip. */}
        <div
          role="group"
          aria-label="Frame state"
          className="flex items-center gap-0.5 rounded-md bg-surface-alt p-0.5"
        >
          {STATE_OPTIONS.map((opt) => {
            const active = frame.state === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                title={opt.hint}
                onClick={() => {
                  setPlacing(null);
                  setTranslateMode(false);
                  onSetState(opt.value);
                }}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition",
                  active ? "bg-accent text-fg-inverse" : "text-fg-muted hover:text-fg",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            setTranslateMode((v) => !v);
            setPlacing(null);
          }}
          disabled={!hasJoints || frame.state !== "present"}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50",
            translateMode ? "bg-accent text-fg-inverse" : "bg-surface-alt text-fg",
          )}
        >
          {translateMode ? "Translate: on" : "Translate whole pose"}
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="rounded-md bg-send/80 px-3 py-1.5 text-xs font-medium text-fg-inverse"
        >
          Accept as-is
        </button>

        <div className="flex items-center gap-1 rounded-md bg-surface-alt px-1.5 py-1">
          <button
            type="button"
            onClick={() => zoomAt(zoom - ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            className="h-6 w-6 rounded text-sm font-semibold text-fg disabled:opacity-40"
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="w-10 text-center text-xs tabular-nums text-fg-muted">
            {zoom.toFixed(1)}×
          </span>
          <button
            type="button"
            onClick={() => zoomAt(zoom + ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            className="h-6 w-6 rounded text-sm font-semibold text-fg disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>
          {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
            <button
              type="button"
              onClick={() => zoomAt(1)}
              className="ml-1 rounded px-1.5 text-xs text-fg-muted hover:text-fg"
            >
              reset
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3 text-xs tabular-nums text-fg-muted">
          {frame.verified && <span className="text-send">verified</span>}
          <span>
            drift max {(drift.maxDist * 100).toFixed(1)}% · mean {(drift.meanDist * 100).toFixed(1)}%
          </span>
          <span>{drift.movedJoints} moved</span>
          {occludedCount > 0 && <span className="text-caution">{occludedCount} occluded</span>}
        </div>
      </div>

      {/* Joint palette — placed joints are filled; missing joints are outlined. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {CORE_JOINT_NAMES.map((name) => {
          const placed = frame.joints[name];
          const isPlaced = !!placed;
          const isOccluded = !!placed?.occluded;
          const isPlacing = placing === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() =>
                isPlaced ? onToggleOccluded(name) : setPlacing((p) => (p === name ? null : name))
              }
              className={cn(
                "rounded px-2 py-0.5 text-xs transition",
                isPlacing
                  ? "bg-accent text-fg-inverse ring-2 ring-accent/60"
                  : isOccluded
                    ? "bg-caution-surface text-caution"
                    : isPlaced
                      ? "bg-send-surface text-send"
                      : "border border-edge/60 text-fg-muted hover:text-fg",
              )}
              title={
                isPlaced
                  ? `Toggle ${name} ${isOccluded ? "visible" : "occluded"}`
                  : `Place ${name}`
              }
            >
              {shortLabel(name).trim()}
              {isOccluded && " ∅"}
            </button>
          );
        })}
      </div>

      {/* Hint — outside the frame so it never sits over the video. */}
      <p className="min-h-5 text-xs text-fg-secondary">{hint}</p>

      {/* Viewport: clips the zoomed canvas; height-limited to the screen. */}
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={onContextMenu}
        className={cn(
          "relative mx-auto flex min-h-0 select-none items-center justify-center overflow-hidden rounded-lg border border-edge/40 bg-surface-alt",
          placing ? "cursor-copy" : translateMode ? "cursor-move" : "cursor-crosshair",
        )}
        style={{
          aspectRatio: `${videoWidth || 16} / ${videoHeight || 9}`,
          maxHeight: "calc(100dvh - var(--nav-h) - 15rem)",
          touchAction: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full object-contain"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        />
        <video ref={videoRef} src={videoSrc} muted playsInline preload="auto" className="hidden" />
      </div>
    </div>
  );
}
