"use client";

/**
 * Dev-only landing-replay clip authoring route.
 *
 * Private maintainer tooling: turn one saved Fixed Capture Run into one checked-in
 * replay item. The flow is pick a Run → choose an 8-second window → attach a Route
 * Photo → run the existing ORB match → download the JSON.
 *
 * Everything expensive happens here, once: the ORB match and gated homography come
 * from {@link useImageMatcher}, the photo-space Holds from {@link useHolds}, and the
 * serializer bakes **both** coordinate spaces into the item so the landing hero only
 * ever lerps and crossfades (see the PRD's design invariant).
 *
 * Composition only — there is no new matching, homography, or Skeleton-transform
 * code in this file. It is unlinked (no nav entry), rendered only in development,
 * and reads exclusively through the authenticated, user-scoped S3 endpoints.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useS3Storage } from "@/hooks/useS3Storage";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { useHolds } from "@/hooks/useHolds";
import { saveAttempt, type RouteAttempt } from "@/storage/sessionStore";
import type { PoseFrame } from "@/pipeline/pose/poseDetection";
import {
  buildTransformedKeypoints,
  drawSkeleton,
  type OverlayPoint,
} from "@/pipeline/overlay/skeletonOverlay";
import { applyHomographyMatrix } from "@/pipeline/matching/homography";
import { REPLAY_CLIP_SECONDS } from "@/pipeline/overlay/landingReplayItem";
import {
  buildLandingReplayItem,
  buildLandingReplayFile,
  type AuthoredHold,
} from "@/pipeline/overlay/landingReplaySerializer";
import { capToPixelBudget, compressImageToWebpDataUrl } from "@/utils/imageHelpers";
import { formatRunTimestamp } from "@/utils/formatRunTimestamp";

const IS_DEV = process.env.NODE_ENV === "development";

/** Height in CSS px of the main preview canvases. */
const PREVIEW_H = 300;
/** Height in CSS px of the two window-endpoint thumbnails. */
const ENDPOINT_H = 120;

// ---------------------------------------------------------------------------
// Run listing
// ---------------------------------------------------------------------------

interface RunOption {
  key: string;
  id: string;
  state: string;
  area: string;
  route: string;
  runType: string;
}

/**
 * Parse a run object key into a pickable option.
 * `RouteData/{userId}/{state}/{area}/{route}/{run-id}-{attempt|send}.json`
 * (legacy `attempt-{ts}.json` has no type suffix). Heavy `.data.json` siblings
 * and non-run objects (e.g. `route-image.json`) return null.
 */
function parseRunKey(key: string): RunOption | null {
  const parts = key.split("/");
  if (parts.length !== 6) return null;
  const file = parts[5];
  if (file.endsWith(".data.json")) return null;
  const m = file.match(/^((?:run|attempt)-\d+)(?:-(attempt|send))?\.json$/);
  if (!m) return null;
  return {
    key,
    id: m[1],
    state: parts[2],
    area: parts[3],
    route: parts[4],
    runType: m[2] ?? "attempt",
  };
}

/** Slug for the exported clip id — lowercase, hyphenated, alphanumeric only. */
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "route"
  );
}

// ---------------------------------------------------------------------------
// Pose helpers
// ---------------------------------------------------------------------------

/** Frames that actually carry a detected pose, in chronological order. */
function detectedFrames(frames: PoseFrame[]): PoseFrame[] {
  return frames.filter((f) => f.keypoints.length > 0).sort((a, b) => a.timestamp - b.timestamp);
}

/** The detected frame nearest to absolute time `t`. Null when there are none. */
function frameAt(frames: PoseFrame[], t: number): PoseFrame | null {
  if (frames.length === 0) return null;
  let best = frames[0];
  let bestDelta = Math.abs(best.timestamp - t);
  for (const f of frames) {
    const delta = Math.abs(f.timestamp - t);
    if (delta < bestDelta) {
      best = f;
      bestDelta = delta;
    }
  }
  return best;
}

/** A pose's keypoints in normalized [0,1] source space, ready for OverlayCanvas. */
function normalizedSourcePoints(frame: PoseFrame | null): Record<string, OverlayPoint> {
  const out: Record<string, OverlayPoint> = {};
  if (!frame) return out;
  for (const kp of frame.keypoints) out[kp.name] = { x: kp.x, y: kp.y, score: kp.score };
  return out;
}

/** The same pose projected through the gated homography, normalized to photo space. */
function normalizedPhotoPoints(
  frame: PoseFrame | null,
  homography: Float64Array | undefined,
  videoW: number,
  videoH: number,
  photoW: number,
  photoH: number,
): Record<string, OverlayPoint> {
  const out: Record<string, OverlayPoint> = {};
  if (!frame || !homography || photoW <= 0 || photoH <= 0) return out;
  const projected = buildTransformedKeypoints(frame, homography, videoW, videoH);
  for (const [name, pt] of Object.entries(projected)) {
    out[name] = { x: pt.x / photoW, y: pt.y / photoH, score: pt.score };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Preview canvas
// ---------------------------------------------------------------------------

interface OverlayCanvasProps {
  /** Keypoints in normalized [0,1] space. */
  points: Record<string, OverlayPoint>;
  /** Aspect ratio of the space the points live in. */
  aspect: { w: number; h: number };
  /** Rendered height in CSS px; width follows the aspect. */
  height: number;
  /** Optional backdrop drawn beneath the skeleton (the Route Photo). */
  background?: HTMLImageElement | null;
  /** Holds in normalized [0,1] space, drawn as rings. */
  holds?: Array<{ x: number; y: number; kind: "hand" | "foot" }>;
}

/**
 * Draws one pose (and optionally a backdrop + Holds) from normalized coordinates.
 * Both preview spaces — source video and Route Photo — reduce to the same call.
 */
function OverlayCanvas({ points, aspect, height, background, holds }: OverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ratio = aspect.h > 0 ? aspect.w / aspect.h : 3 / 4;
  const width = Math.max(1, Math.round(height * ratio));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (background) {
      ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
    }
    const scaled: Record<string, OverlayPoint> = {};
    for (const [name, pt] of Object.entries(points)) {
      scaled[name] = { x: pt.x * canvas.width, y: pt.y * canvas.height, score: pt.score };
    }
    if (Object.keys(scaled).length > 0) drawSkeleton(ctx, scaled);
    for (const hold of holds ?? []) {
      ctx.beginPath();
      ctx.arc(hold.x * canvas.width, hold.y * canvas.height, 7, 0, Math.PI * 2);
      ctx.strokeStyle = hold.kind === "hand" ? "#38bdf8" : "#fb923c";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [points, background, holds, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width, height }}
      className="rounded-md border border-edge/40 bg-surface-alt/40"
    />
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LandingClipPage() {
  const { user, loading: authLoading } = useAuth();
  const { ready: cvReady, cv } = useOpenCV();
  const { listAttempts, downloadAttempt, userPrefix } = useS3Storage();
  const {
    matchImage,
    reset: resetMatch,
    status: matchStatus,
    result: matchResult,
    errorMessage: matchError,
  } = useImageMatcher();

  const [runs, setRuns] = useState<RunOption[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<RouteAttempt | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Window start as an offset from the Run's first detected frame, in seconds.
  const [windowOffset, setWindowOffset] = useState(0);
  // Playhead within the window, clip-relative seconds in [0, REPLAY_CLIP_SECONDS].
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [photoImage, setPhotoImage] = useState<HTMLImageElement | null>(null);
  const [photoDims, setPhotoDims] = useState<{ w: number; h: number } | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedName, setExportedName] = useState<string | null>(null);

  const { holds } = useHolds(cv, attempt?.id ?? null, matchResult);

  // ── Run list ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!userPrefix) return;
    let cancelled = false;
    (async () => {
      try {
        const entries = await listAttempts(`${userPrefix}/`);
        if (cancelled) return;
        const options = entries
          .map((e) => parseRunKey(e.key))
          .filter((o): o is RunOption => o !== null)
          .sort((a, b) => b.id.localeCompare(a.id));
        setRuns(options);
      } catch (err) {
        if (!cancelled) setRunsError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userPrefix, listAttempts]);

  // ── Derived clip state ───────────────────────────────────────────────────

  const frames = useMemo(() => (attempt ? detectedFrames(attempt.frames) : []), [attempt]);
  const firstTs = frames.length > 0 ? frames[0].timestamp : 0;
  const lastTs = frames.length > 0 ? frames[frames.length - 1].timestamp : 0;
  const trackDuration = Math.max(0, lastTs - firstTs);
  const maxOffset = Math.max(0, trackDuration - REPLAY_CLIP_SECONDS);
  const windowStart = firstTs + Math.min(windowOffset, maxOffset);
  const windowEnd = windowStart + REPLAY_CLIP_SECONDS;

  // A Panning Capture has no single frame-0 reference to build a starfield or a
  // single gated homography from — Fixed Capture only, per the PRD's source rule.
  const unsupportedReason = !attempt
    ? null
    : (attempt.keyframes?.length ?? 0) > 0
      ? "This is a Panning Capture Run. Clip authoring supports Fixed Capture Runs only."
      : !attempt.orbFeatures
        ? "This Run has no reference ORB features, so it has no wall starfield to export."
        : frames.length === 0
          ? "This Run has no detected pose frames."
          : trackDuration < REPLAY_CLIP_SECONDS
            ? `This Run's pose track is only ${trackDuration.toFixed(1)}s — shorter than the ${REPLAY_CLIP_SECONDS}s clip.`
            : null;

  const videoW = attempt?.videoMeta.width ?? 9;
  const videoH = attempt?.videoMeta.height ?? 16;

  const startFrame = useMemo(() => frameAt(frames, windowStart), [frames, windowStart]);
  const endFrame = useMemo(() => frameAt(frames, windowEnd), [frames, windowEnd]);
  const playheadFrame = useMemo(
    () => frameAt(frames, windowStart + playhead),
    [frames, windowStart, playhead],
  );

  const sourcePoints = useMemo(() => normalizedSourcePoints(playheadFrame), [playheadFrame]);
  const startPoints = useMemo(() => normalizedSourcePoints(startFrame), [startFrame]);
  const endPoints = useMemo(() => normalizedSourcePoints(endFrame), [endFrame]);
  const photoPoints = useMemo(
    () =>
      normalizedPhotoPoints(
        playheadFrame,
        matchResult?.homography,
        videoW,
        videoH,
        photoDims?.w ?? 0,
        photoDims?.h ?? 0,
      ),
    [playheadFrame, matchResult, videoW, videoH, photoDims],
  );

  // Holds carry the FramePlayer's 0-based clock (useHolds subtracts the Run's
  // first timestamp), so absolute video time is that value plus `firstTs`.
  const absoluteHolds = useMemo<AuthoredHold[]>(
    () =>
      holds.map((h) => ({
        x: h.x,
        y: h.y,
        kind: h.kind,
        side: h.side,
        firstUseTime: h.firstUseTime + firstTs,
      })),
    [holds, firstTs],
  );

  const previewHolds = useMemo(
    () =>
      photoDims
        ? absoluteHolds
            .filter((h) => h.firstUseTime <= windowStart + playhead)
            .map((h) => ({ x: h.x / photoDims.w, y: h.y / photoDims.h, kind: h.kind }))
        : [],
    [absoluteHolds, photoDims, windowStart, playhead],
  );

  const aligned = matchStatus === "done" && Boolean(matchResult?.homography);
  const canExport = Boolean(attempt && !unsupportedReason && aligned && imageFile && photoDims);

  // ── Segment playback ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayhead((t) => (t + dt) % REPLAY_CLIP_SECONDS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const selectRun = useCallback(
    async (option: RunOption) => {
      setLoadingKey(option.key);
      setLoadError(null);
      setAttempt(null);
      setWindowOffset(0);
      setPlayhead(0);
      setPlaying(false);
      resetMatch();
      setExportedName(null);
      try {
        const loaded = await downloadAttempt(option.key);
        saveAttempt(loaded);
        setAttempt(loaded);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingKey(null);
      }
    },
    [downloadAttempt, resetMatch],
  );

  const attachPhoto = useCallback(
    async (file: File | null) => {
      setImageFile(file);
      setPhotoImage(null);
      setPhotoDims(null);
      setExportedName(null);
      resetMatch();
      if (!file || !attempt || !cv) return;

      // The matcher's photo pixel space is the decode-capped natural size — the
      // space its homography and query keypoints are expressed in, so previews
      // and the export normalize against it.
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        setPhotoImage(img);
        const capped = capToPixelBudget(img.naturalWidth, img.naturalHeight);
        setPhotoDims({ w: capped.width, h: capped.height });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;

      await matchImage(file, attempt.id, cv);
    },
    [attempt, cv, matchImage, resetMatch],
  );

  const handleExport = useCallback(async () => {
    if (!attempt || !imageFile || !photoDims || !matchResult?.homography) return;
    setExporting(true);
    setExportError(null);
    try {
      const webp = await compressImageToWebpDataUrl(imageFile);
      const h = matchResult.homography;
      const item = buildLandingReplayItem({
        id: `${attempt.id}-${slugify(attempt.route)}`,
        label: { area: attempt.area, route: attempt.route, rating: attempt.rating ?? "" },
        source: { w: attempt.videoMeta.width, h: attempt.videoMeta.height },
        photo: { w: webp.width, h: webp.height, webp: webp.dataUrl },
        photoSpace: photoDims,
        refFeatures: attempt.orbFeatures!,
        queryFeatures: matchResult.queryOrb,
        matches: matchResult.matches,
        frames: attempt.frames,
        windowStart,
        project: (x, y) => applyHomographyMatrix(h, x, y),
        holds: absoluteHolds,
      });

      const fileName = `landing-replay-${item.id}.json`;
      const blob = new Blob([JSON.stringify(buildLandingReplayFile([item]))], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setExportedName(fileName);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }, [attempt, imageFile, photoDims, matchResult, windowStart, absoluteHolds]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (!IS_DEV) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-fg-muted">Clip authoring is only available in development.</p>
      </main>
    );
  }

  if (!authLoading && !user) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="text-fg-muted">Sign in to author a landing replay clip from your Runs.</p>
        <Link href="/login?redirect=/dev/landing-clip" className="text-sm font-medium text-accent">
          Go to sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-fg">Landing replay clip authoring</h1>
        <p className="text-sm text-fg-muted">
          Pick a Fixed Capture Run, choose an {REPLAY_CLIP_SECONDS}-second window, attach the Route
          Photo, then export one replay item to check into the repo.
        </p>
      </header>

      {/* 1 — Run picker */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-fg">1 · Run</h2>
        {runsError && (
          <p className="rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
            {runsError}
          </p>
        )}
        {!runs && !runsError && <p className="text-sm text-fg-muted">Loading your Runs…</p>}
        {runs && runs.length === 0 && <p className="text-sm text-fg-muted">No saved Runs found.</p>}
        {runs && runs.length > 0 && (
          <ul className="max-h-56 overflow-y-auto rounded-md border border-edge/40">
            {runs.map((run) => {
              const ts = formatRunTimestamp(run.id);
              const selected = attempt?.id === run.id;
              return (
                <li key={run.key}>
                  <button
                    type="button"
                    onClick={() => selectRun(run)}
                    disabled={loadingKey !== null}
                    className={`flex w-full items-center gap-2 border-b border-edge/20 px-3 py-2 text-left text-sm transition last:border-b-0 hover:bg-inset/60 disabled:opacity-60 ${
                      selected ? "bg-inset/80 text-fg" : "text-fg-secondary"
                    }`}
                  >
                    <span className="font-medium text-fg">{run.route}</span>
                    <span className="text-xs text-fg-muted">
                      {run.area} · {run.state}
                    </span>
                    {ts && <span className="ml-auto text-xs text-fg-muted">{ts.date}</span>}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        run.runType === "send"
                          ? "bg-send-surface text-send"
                          : "bg-attempt-surface text-attempt"
                      }`}
                    >
                      {run.runType}
                    </span>
                    {loadingKey === run.key && (
                      <span className="text-xs text-fg-muted">loading…</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {loadError && (
          <p className="rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
            {loadError}
          </p>
        )}
        {unsupportedReason && (
          <p className="rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-sm text-caution">
            {unsupportedReason}
          </p>
        )}
      </section>

      {/* 2 — Window picker */}
      {attempt && !unsupportedReason && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-fg">
            2 · Clip window ({REPLAY_CLIP_SECONDS}s fixed)
          </h2>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            <span>
              Starts at {windowOffset.toFixed(1)}s of {trackDuration.toFixed(1)}s (window{" "}
              {windowOffset.toFixed(1)}–{(windowOffset + REPLAY_CLIP_SECONDS).toFixed(1)}s)
            </span>
            <input
              type="range"
              min={0}
              max={maxOffset}
              step={0.1}
              value={Math.min(windowOffset, maxOffset)}
              onChange={(e) => setWindowOffset(Number(e.target.value))}
              className="w-full"
            />
          </label>

          <div className="flex flex-wrap items-start gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-fg-muted">Window start</span>
              <OverlayCanvas
                points={startPoints}
                aspect={{ w: videoW, h: videoH }}
                height={ENDPOINT_H}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-fg-muted">Window end</span>
              <OverlayCanvas
                points={endPoints}
                aspect={{ w: videoW, h: videoH }}
                height={ENDPOINT_H}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-fg-muted">
                Segment playback · t = {playhead.toFixed(2)}s
              </span>
              <OverlayCanvas
                points={sourcePoints}
                aspect={{ w: videoW, h: videoH }}
                height={PREVIEW_H}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="rounded-md bg-send px-4 py-2 text-sm font-medium text-fg-inverse"
            >
              {playing ? "Pause segment" : "Play segment"}
            </button>
            <input
              type="range"
              min={0}
              max={REPLAY_CLIP_SECONDS}
              step={0.05}
              value={playhead}
              onChange={(e) => {
                setPlaying(false);
                setPlayhead(Number(e.target.value));
              }}
              className="flex-1"
            />
          </div>
        </section>
      )}

      {/* 3 — Route Photo + match */}
      {attempt && !unsupportedReason && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-fg">3 · Route Photo</h2>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-fg-muted">
              {cvReady ? "Attach the Route Photo to match against" : "Loading OpenCV…"}
            </span>
            <input
              type="file"
              accept="image/*"
              disabled={!cvReady}
              onChange={(e) => void attachPhoto(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-fg file:mr-3 file:rounded-md file:border-0 file:bg-surface-alt file:px-3 file:py-1.5 file:text-fg"
            />
          </label>

          {matchStatus === "matching" && <p className="text-sm text-fg-muted">Matching…</p>}
          {matchError && (
            <p className="rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
              {matchError}
            </p>
          )}
          {aligned && matchResult && (
            <>
              <p className="rounded-md border border-edge/40 bg-inset/40 px-3 py-2 text-sm text-fg-secondary">
                <span className="font-semibold text-send">Aligned</span> · {matchResult.matches.length}{" "}
                matches · {matchResult.queryKeypoints} photo keypoints ·{" "}
                {matchResult.referenceKeypoints} reference keypoints · {holds.length} Holds
                {photoDims ? ` · photo ${photoDims.w}×${photoDims.h}` : ""}
              </p>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-fg-muted">
                  Route Photo space at t = {playhead.toFixed(2)}s
                </span>
                <OverlayCanvas
                  points={photoPoints}
                  aspect={photoDims ?? { w: 4, h: 3 }}
                  height={PREVIEW_H}
                  background={photoImage}
                  holds={previewHolds}
                />
              </div>
            </>
          )}
        </section>
      )}

      {/* 4 — Export */}
      {attempt && !unsupportedReason && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-fg">4 · Export</h2>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={!canExport || exporting}
            className="self-start rounded-md bg-send px-4 py-2 text-sm font-medium text-fg-inverse disabled:opacity-50"
          >
            {exporting ? "Building…" : "Download replay item"}
          </button>
          <p className="text-xs text-fg-muted">
            Downloads a {`{ version: 1, items: [ … ] }`} file with this one clip. Merge it into the
            checked-in playlist by hand — nothing is written to the repo or to S3.
          </p>
          {exportError && (
            <p className="rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
              {exportError}
            </p>
          )}
          {exportedName && <p className="text-sm text-send">Exported {exportedName}</p>}
        </section>
      )}
    </main>
  );
}
