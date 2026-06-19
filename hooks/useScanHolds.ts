"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  limbContactAt,
  projectStoredHolds,
  type Hold,
  type HoldProjector,
} from "@/pipeline/holdDetection";
import { saveAttempt, type RouteAttempt, type StoredHold } from "@/storage/sessionStore";
import type { PoseFrame } from "@/pipeline/poseDetection";

/** A stored Hold paired with its re-derived 1-based first-use rank, for the editor list. */
export interface HoldEntry {
  hold: StoredHold;
  order: number;
}

export interface ScanHoldsResult {
  /**
   * Holds projected into the Run's own video-pixel space, with `firstUseTime`
   * rebased to the Detection Preview clock, ready for the preview FramePlayer.
   */
  previewHolds: Hold[];
  /** Stored Holds sorted by first use, each with its re-derived number. */
  entries: HoldEntry[];
  /** Number of authored Holds. */
  count: number;
  /**
   * Snap a new Hold to one of the four extremities at the given preview-clock
   * time (the moment the limb is on the hold). Returns false when the Run is not
   * editable or the limb is absent in the nearest frame.
   */
  addLimb: (kind: "hand" | "foot", side: "left" | "right", previewTime: number) => boolean;
  /** Remove a Hold; the rest renumber automatically. */
  removeHold: (hold: StoredHold) => void;
}

/** Nearest pose frame to an absolute video time (linear scan; frames are sorted). */
function nearestFrame(sorted: PoseFrame[], t: number): PoseFrame | null {
  if (sorted.length === 0) return null;
  let best = sorted[0];
  let bestD = Math.abs(best.timestamp - t);
  for (let i = 1; i < sorted.length; i++) {
    const d = Math.abs(sorted[i].timestamp - t);
    if (d < bestD) {
      best = sorted[i];
      bestD = d;
    }
  }
  return best;
}

/**
 * Manages the editable **Holds** of a Fixed Capture Run on the Detection Preview
 * (ADR 0009). Seeds from the Run's scan-time auto-detected `holds`, lets the User
 * add (snap-to-limb) and remove markers, re-derives the numbering from first-use
 * order, and writes the result back to the Run so it is saved and shown — through
 * the homography — on the Route Overlay and Compare.
 *
 * `editable` is the Fixed-Capture gate: a Panning Capture Run has no single
 * whole-Route frame to author on, so editing is disabled and its Holds stay on
 * the on-the-fly path.
 */
export function useScanHolds(attempt: RouteAttempt | null, editable: boolean): ScanHoldsResult {
  const [holds, setHolds] = useState<StoredHold[]>([]);

  // (Re-)seed from the Run's stored Holds when the editable active attempt
  // changes. Adjusting state during render (guarded by the seed key) rather than
  // in an effect avoids a wasted render and re-seeding after our own saves —
  // `persist` replaces the attempt object but keeps its id, so the key is stable.
  const seedKey = attempt && editable ? attempt.id : null;
  const seededKeyRef = useRef<string | null | undefined>(undefined);
  if (seededKeyRef.current !== seedKey) {
    seededKeyRef.current = seedKey;
    setHolds(seedKey && attempt ? attempt.holds ?? [] : []);
  }

  // Video-space projector + the preview-clock rebasing offset (the first detected
  // frame's timestamp, mirroring how the preview skeleton frames are rebased).
  const ctx = useMemo(() => {
    if (!attempt) return null;
    const { width, height } = attempt.videoMeta;
    const sorted = [...attempt.frames].sort((a, b) => a.timestamp - b.timestamp);
    const firstDetected = sorted.find((f) => f.keypoints.length > 0);
    return { width, height, sorted, offset: firstDetected ? firstDetected.timestamp : 0 };
  }, [attempt]);

  const previewHolds = useMemo<Hold[]>(() => {
    if (!ctx) return [];
    const project: HoldProjector = (pt) => ({ x: pt.x * ctx.width, y: pt.y * ctx.height });
    return projectStoredHolds(holds, project).map((h) => ({
      ...h,
      firstUseTime: h.firstUseTime - ctx.offset,
    }));
  }, [holds, ctx]);

  // Editor list — sorted by first use with the same deterministic tie-break the
  // projected numbering uses (monotonic scaling preserves the normalized order).
  const entries = useMemo<HoldEntry[]>(() => {
    return [...holds]
      .sort(
        (a, b) =>
          a.firstUseTime - b.firstUseTime ||
          a.x - b.x ||
          a.y - b.y ||
          a.kind.localeCompare(b.kind) ||
          (a.side ?? "right").localeCompare(b.side ?? "right"),
      )
      .map((hold, idx) => ({ hold, order: idx + 1 }));
  }, [holds]);

  const persist = useCallback(
    (next: StoredHold[]) => {
      setHolds(next);
      if (attempt) saveAttempt({ ...attempt, holds: next });
    },
    [attempt],
  );

  const addLimb = useCallback(
    (kind: "hand" | "foot", side: "left" | "right", previewTime: number): boolean => {
      if (!ctx || !editable) return false;
      const frame = nearestFrame(ctx.sorted, previewTime + ctx.offset);
      if (!frame) return false;
      const pt = limbContactAt(frame, kind, side);
      if (!pt) return false;
      // The add-frame timestamp is the Hold's first-use/reveal time.
      persist([...holds, { x: pt.x, y: pt.y, kind, side, firstUseTime: frame.timestamp }]);
      return true;
    },
    [ctx, editable, holds, persist],
  );

  const removeHold = useCallback(
    (target: StoredHold) => {
      persist(holds.filter((h) => h !== target));
    },
    [holds, persist],
  );

  return { previewHolds, entries, count: holds.length, addLimb, removeHold };
}
