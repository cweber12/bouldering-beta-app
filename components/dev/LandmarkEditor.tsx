"use client";

/**
 * Dev-only Ground Truth landmark-correction editor.
 *
 * Renders one Detection Frame paused from the video and lets the author drag the
 * **core body joints** into place, translate the whole skeleton when the pose is
 * right but offset, or accept the frame as-is. Non-core BlazePose points draw
 * faintly for context and are not editable. Any edit (drag / translate / accept)
 * marks the frame verified; the parent persists to `ground-truth.json`. A live
 * drag-distance readout gives authoring feedback — it is not a score. See
 * docs/adr/0018 and issue 04. Rendered only in the development harness.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { dark } from "@/utils/theme";
import { getTopology } from "@/utils/poseConstants";
import {
  jointDrift,
  moveJoint,
  translateJoints,
  type DriftReadout,
} from "@/utils/harnessGroundTruthScaffold";
import type { GroundTruthFrame, GroundTruthJoint } from "@/utils/harnessGroundTruth";

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
  /** Called with the frame's new joints after a drag / translate (marks verified). */
  onEditJoints: (joints: Record<string, GroundTruthJoint>) => void;
  /** Accept the frame's landmarks as-is (marks verified without dragging). */
  onAccept: () => void;
  className?: string;
}

const { keypointNames, skeletonEdges } = getTopology("mediapipe");
const NAME_BY_INDEX = keypointNames;

/** Hit radius (display px) for grabbing a joint. */
const HIT_RADIUS_PX = 20;

export default function LandmarkEditor({
  videoSrc,
  videoWidth,
  videoHeight,
  frame,
  seedJoints,
  contextKeypoints,
  onEditJoints,
  onAccept,
  className,
}: LandmarkEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameReadyRef = useRef(false);
  const [translateMode, setTranslateMode] = useState(false);
  const [activeJoint, setActiveJoint] = useState<string | null>(null);

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
    const rHandle = Math.max(5, unit * 0.011);
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

  // ── Pointer interaction ──────────────────────────────────────────────────
  const dragRef = useRef<
    | { mode: "joint"; name: string }
    | { mode: "translate"; startX: number; startY: number; joints: Record<string, GroundTruthJoint> }
    | null
  >(null);

  const toNorm = useCallback((clientX: number, clientY: number): Pos => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  }, []);

  /** Nearest core joint within the hit radius (display px), or null. */
  const hitJoint = useCallback((norm: Pos): string | null => {
    const rect = containerRef.current?.getBoundingClientRect();
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
      if (Object.keys(jointsRef.current).length === 0) return;
      const norm = toNorm(e.clientX, e.clientY);
      if (translateMode) {
        dragRef.current = {
          mode: "translate",
          startX: norm.x,
          startY: norm.y,
          joints: jointsRef.current,
        };
        setActiveJoint(null);
      } else {
        const name = hitJoint(norm);
        if (!name) return;
        dragRef.current = { mode: "joint", name };
        setActiveJoint(name);
      }
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
    },
    [toNorm, hitJoint, translateMode],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const norm = toNorm(e.clientX, e.clientY);
      if (drag.mode === "joint") {
        onEditJoints(moveJoint(jointsRef.current, drag.name, norm.x, norm.y));
      } else {
        onEditJoints(translateJoints(drag.joints, norm.x - drag.startX, norm.y - drag.startY));
      }
    },
    [toNorm, onEditJoints],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setActiveJoint(null);
  }, []);

  const editable = frame.state === "present" && Object.keys(frame.joints).length > 0;

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTranslateMode((v) => !v)}
          disabled={!editable}
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
        <div className="ml-auto flex items-center gap-3 text-xs tabular-nums text-fg-muted">
          {frame.verified && <span className="text-send">verified</span>}
          <span>
            drift max {(drift.maxDist * 100).toFixed(1)}% · mean {(drift.meanDist * 100).toFixed(1)}%
          </span>
          <span>{drift.movedJoints} moved</span>
        </div>
      </div>

      <div
        ref={containerRef}
        onPointerDown={editable ? onPointerDown : undefined}
        onPointerMove={editable ? onPointerMove : undefined}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          "relative mx-auto min-h-0 select-none overflow-hidden rounded-lg border border-edge/40 bg-surface-alt",
          editable ? (translateMode ? "cursor-move" : "cursor-crosshair") : "cursor-default",
        )}
        style={{
          aspectRatio: `${videoWidth || 16} / ${videoHeight || 9}`,
          maxHeight: "calc(100dvh - var(--nav-h) - 12rem)",
          touchAction: "none",
        }}
      >
        <canvas ref={canvasRef} className="block h-full w-full object-contain" />
        <video ref={videoRef} src={videoSrc} muted playsInline preload="auto" className="hidden" />
        {!editable && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-fg-muted">
            This frame is marked absent — no core joints to correct. Use Accept as-is to verify it.
          </div>
        )}
      </div>
    </div>
  );
}
