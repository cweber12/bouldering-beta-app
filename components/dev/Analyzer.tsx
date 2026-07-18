"use client";

/**
 * Dev-only Analyze step — one production detection run over a Test Video.
 *
 * The run itself — load, production scan, probed-frame scoring, append-only
 * post — lives in {@link useAnalyzeRun}, shared with the batch sweep so a
 * manual Analyze and a batch entry post identical runs. This component is the
 * eyeball view on top: the skeleton over the video with its Adaptive Crop
 * trace, the Detection Frame filmstrip, the run's ScanDiagnostics, and — when
 * the video carries accepted Ground Truth — the verdicts.
 *
 * Analyze is a deliberate act: it is reached from the corpus list and never
 * fires off the back of accepting Ground Truth. See docs/adr/0017 and 0018.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnalyzeRun, type AnalyzeRunItem } from "@/hooks/useAnalyzeRun";
import { useDetectionThumbnails } from "@/hooks/useDetectionThumbnails";
import { type RouteAttempt } from "@/storage/sessionStore";
import ScanLoadingBar from "@/components/scan/process-flow/ScanLoadingBar";
import FramePlayer, { type FramePlayerHandle } from "@/components/skeleton/FramePlayer";
import DetectionFrameStepper from "@/components/dev/DetectionFrameStepper";
import DiagnosticsPanel from "@/components/dev/DiagnosticsPanel";
import ScoringSummary from "@/components/dev/ScoringSummary";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { findScoredRow } from "@/utils/harnessScoring";
import { summarizeGridAlignment } from "@/utils/harnessDetectionGrid";
import { getTopology } from "@/utils/poseConstants";
import { type SkeletonStyle } from "@/pipeline/overlay/skeletonOverlay";
import type { RenderedSkeletonFrame } from "@/pipeline/overlay/skeletonRenderer";

/** The corpus fields the Analyze step needs. */
export type AnalyzerItem = AnalyzeRunItem;

interface FirstFrameSkeleton {
  frames: RenderedSkeletonFrame[];
  duration: number;
  fps: number;
  startOffsetSec: number;
}

/**
 * Build the video-space skeleton animation for the rendered run, mirroring the
 * app/scan firstFrameSkeletonData memo: start playback at the first detected
 * frame and map normalised keypoints into video-pixel space.
 */
function buildFirstFrameSkeleton(attempt: RouteAttempt | null): FirstFrameSkeleton | null {
  if (!attempt) return null;
  const { frames, videoMeta } = attempt;
  if (!frames.length) return null;
  const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);
  const firstDetected = sorted.find((f) => f.keypoints.length > 0);
  if (!firstDetected) return null;
  const firstTs = firstDetected.timestamp;
  const lastTs = sorted[sorted.length - 1].timestamp;
  const duration = Math.max(lastTs - firstTs, 0.1);
  const rendered: RenderedSkeletonFrame[] = sorted
    .filter((f) => f.timestamp >= firstTs)
    .map((f) => ({
      timestamp: f.timestamp - firstTs,
      keypoints: Object.fromEntries(
        f.keypoints.map((kp) => [
          kp.name,
          { x: kp.x * videoMeta.width, y: kp.y * videoMeta.height },
        ]),
      ),
    }));
  return { frames: rendered, duration, fps: videoMeta.fps ?? 30, startOffsetSec: firstTs };
}

function findFrameIndexByTime(frames: { timestamp: number }[], time: number): number {
  if (frames.length === 0) return 0;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].timestamp <= time) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo].timestamp <= time ? lo : 0;
}

export default function Analyzer({
  item,
  onBack,
  onDone,
}: {
  item: AnalyzerItem;
  onBack: () => void;
  /** Called after a run posts, so the corpus list's run count can refresh. */
  onDone: () => void | Promise<void>;
}) {
  const {
    loading,
    loadError,
    videoUrl,
    setup,
    groundTruth,
    truthStale,
    ready,
    phase,
    phaseError,
    post,
    runAttempt,
    runDiag,
    scoring,
    runFrames,
    cropTrace,
    firstFrameFile,
    currentFrame,
    totalFrames,
    processorStatus,
    run,
    cancel,
  } = useAnalyzeRun(item, onDone);

  const playerRef = useRef<FramePlayerHandle>(null);
  const [playing, setPlaying] = useState(true);
  const [frameIndex, setFrameIndex] = useState(0);
  const [showCrops, setShowCrops] = useState(true);

  // Reset the player to the top of each new run, adjusting state during render
  // (not in an effect) so the stale frame index never paints.
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  if (runDiag && runDiag.scanId !== lastRunId) {
    setLastRunId(runDiag.scanId);
    setPlaying(true);
    setFrameIndex(0);
  }

  const thumbnails = useDetectionThumbnails(videoUrl, runFrames, phase === "result");

  // Alignment-by-arithmetic: every probe the seek loop makes is an i x 100 ms
  // multiple, so a healthy run is wholly on the Detection Frame grid and pairs
  // with truth by set-intersection. Measured over the run's own detection frames
  // — the ones the payload carries and scoring pairs with truth, base samples
  // and Adaptive Refinement re-probes alike — rather than the filmstrip's
  // base-stride timeline, which never sees the refined frames. Surfaced so a
  // drift shows up here rather than as phantom `missing` verdicts.
  const alignment = useMemo(
    () => summarizeGridAlignment(runAttempt?.frames ?? []),
    [runAttempt],
  );

  // The verdict of the frame the player is on, for the summary chip.
  const currentRow = useMemo(() => {
    if (!scoring) return null;
    const frame = runFrames[frameIndex];
    return frame ? findScoredRow(scoring.rows, frame.timestamp) : null;
  }, [scoring, runFrames, frameIndex]);

  // The rendered skeleton is re-based to start at the first detected frame, so
  // the FramePlayer's clock is offset from the Detection Frame grid by this many
  // seconds. The stepper works in absolute video time.
  const skel = useMemo(() => buildFirstFrameSkeleton(runAttempt), [runAttempt]);
  const startOffset = skel?.startOffsetSec ?? 0;

  useEffect(() => {
    if (phase !== "result" || runFrames.length === 0) return;
    let raf = 0;
    const syncCurrentFrame = () => {
      // Player time is re-based to the first detection; the grid is absolute.
      const playerTime = playerRef.current?.getCurrentTime() ?? 0;
      const nextIndex = findFrameIndexByTime(runFrames, playerTime + startOffset);
      setFrameIndex((prev) => (prev === nextIndex ? prev : nextIndex));
      raf = requestAnimationFrame(syncCurrentFrame);
    };
    raf = requestAnimationFrame(syncCurrentFrame);
    return () => cancelAnimationFrame(raf);
  }, [phase, runFrames, startOffset]);

  const handleSeek = useCallback(
    (index: number) => {
      const frame = runFrames[index];
      if (!frame) return;
      setPlaying(false);
      setFrameIndex(index);
      playerRef.current?.pause();
      // The stepper timestamp is absolute video time; the player seeks in its
      // re-based clock, so subtract the first-detection offset.
      playerRef.current?.seek(frame.timestamp - startOffset);
    },
    [runFrames, startOffset],
  );

  const handleTogglePlay = useCallback(() => {
    setPlaying((isPlaying) => {
      const next = !isPlaying;
      if (next) playerRef.current?.play();
      else playerRef.current?.pause();
      return next;
    });
  }, []);

  const header = (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge/30 bg-surface px-4 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-fg">{item.routeFolder}</div>
        <div className="truncate font-mono text-xs text-fg-muted">{item.videoKey}</div>
      </div>
      <div className="flex items-center gap-2">
        {phase === "result" && post.status !== "idle" && (
          <span
            className={`max-w-xs truncate text-xs ${
              post.status === "failed"
                ? "text-danger"
                : post.status === "posted"
                  ? "text-send"
                  : "text-fg-muted"
            }`}
          >
            {post.message}
          </span>
        )}
        {phase === "result" && (
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={showCrops}
              onChange={(e) => setShowCrops(e.target.checked)}
              className="accent-accent"
            />
            Crops
          </label>
        )}
        {phase === "result" && (
          <button
            type="button"
            onClick={() => void run()}
            className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg"
          >
            Re-run Analyze
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded-md bg-send px-3 py-1.5 text-xs font-medium text-fg-inverse"
        >
          Back to corpus
        </button>
      </div>
    </div>
  );

  if (loadError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-danger">{loadError}</p>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md bg-surface-alt px-3 py-1.5 text-sm text-fg"
        >
          Back to corpus
        </button>
      </main>
    );
  }

  if (loading || !videoUrl) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-fg-muted">Loading {item.videoKey}…</p>
      </main>
    );
  }

  // ── In-run progress ──
  if (phase === "running") {
    const pct = totalFrames > 0 ? Math.min(100, Math.round((currentFrame / totalFrames) * 100)) : 0;
    const finishing =
      processorStatus === "done" || (totalFrames > 0 && currentFrame >= totalFrames);
    return (
      <div className="relative flex h-[calc(100dvh-var(--nav-h))] min-h-0 flex-col">
        <div className="absolute inset-x-0 top-0 z-10">
          <ScanLoadingBar progressPct={pct} finishing={finishing} />
        </div>
        <section className="flex h-full min-h-0 flex-col" aria-label="Analyzing Test Video">
          <header className="shrink-0 border-b border-edge/60 bg-surface px-4 py-2.5 sm:px-6">
            <div className="mx-auto flex h-7 w-full max-w-5xl items-center gap-3">
              <span className="text-sm font-medium text-fg">Analyzing Test Video</span>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 items-center justify-center bg-surface px-6">
            <div className="flex w-full max-w-md flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-fg-secondary">
                  {finishing ? "Preparing results" : "Detecting frames"}
                </span>
                <span className="text-sm font-semibold tabular-nums text-fg">{pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-edge/30" aria-hidden="true">
                <div
                  className="h-full bg-send transition-[width] duration-200"
                  style={{ width: `${finishing ? 100 : pct}%` }}
                />
              </div>
              <p className="font-mono text-xs text-fg-muted">
                {currentFrame} / {totalFrames || "?"} sampled frames
              </p>
            </div>
          </div>

          <footer className="shrink-0 border-t border-edge/60 bg-surface px-4 py-2.5 sm:px-6">
            <div className="mx-auto flex w-full max-w-5xl items-center justify-start">
              <button
                type="button"
                onClick={cancel}
                className="rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg"
              >
                Cancel run
              </button>
            </div>
          </footer>
        </section>
      </div>
    );
  }

  // ── The rendered run ──
  if (phase === "result") {
    const topo = getTopology(runAttempt?.poseBackend ?? "mediapipe");
    const topoStyle: SkeletonStyle = {
      skeletonEdges: topo.skeletonEdges,
      keypointNames: topo.keypointNames,
    };
    const orbKeypoints = runAttempt?.orbFeatures?.keypoints.map((kp) => kp.pt);

    return (
      <div className="flex h-[calc(100dvh-var(--nav-h))] min-h-0 flex-col">
        {header}
        <div className="flex min-h-0 flex-1 flex-col gap-3 bg-surface p-3">
          <DetectionFrameStepper
            frames={runFrames}
            thumbnails={thumbnails}
            currentIndex={frameIndex}
            onSeek={handleSeek}
            onTogglePlay={handleTogglePlay}
            isPlaying={playing}
            className="shrink-0"
          />
          {alignment.offGrid > 0 ? (
            <div
              role="status"
              className="shrink-0 rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-xs text-caution"
            >
              {alignment.offGrid} of {alignment.total} detection frames are off the 100 ms
              Detection Frame grid — those frames cannot pair with this video&apos;s Ground
              Truth. First off-grid probe: {alignment.offGridTimestamps[0]?.toFixed(4)}s.
            </div>
          ) : (
            <p className="shrink-0 text-xs tabular-nums text-fg-muted">
              {alignment.total} detection frames · all on the 100 ms Detection Frame grid
            </p>
          )}
          {scoring ? (
            <ScoringSummary scoring={scoring} currentRow={currentRow} />
          ) : truthStale ? (
            <p className="shrink-0 text-xs text-caution">
              Ground Truth is from an older calibration — this run cannot pair with it and
              posted unscored. Re-seed and re-accept the truth in calibration.
            </p>
          ) : (
            <p className="shrink-0 text-xs text-fg-muted">
              No accepted Ground Truth for this video — the run posted unscored.
            </p>
          )}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-edge/30 bg-surface">
            {firstFrameFile && skel ? (
              <FramePlayer
                ref={playerRef}
                imageFile={firstFrameFile}
                videoSrc={videoUrl}
                videoTimeOffset={skel.startOffsetSec}
                layers={[{ frames: skel.frames, style: topoStyle }]}
                duration={skel.duration}
                autoPlay
                hidePlayButton
                orbKeypoints={orbKeypoints}
                cropTrace={showCrops ? (cropTrace ?? undefined) : undefined}
                fit="contain"
                bare
                className="min-h-0 flex-1 rounded-none"
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-fg-muted">
                No climber detected — this run has no skeleton to show. See the diagnostics for
                why.
              </div>
            )}
            <DiagnosticsPanel record={runDiag} defaultOpen />
          </div>
        </div>
      </div>
    );
  }

  // ── Idle / error: the deliberate act of starting a run ──
  return (
    <div className="flex h-[calc(100dvh-var(--nav-h))] min-h-0 flex-col">
      {header}
      <div className="flex min-h-0 flex-1 items-center justify-center bg-surface p-8">
        <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
          <h2 className="text-lg font-semibold text-fg">Analyze</h2>
          {setup ? (
            <p className="text-sm text-fg-secondary">
              Runs the production detection pipeline over this Test Video with the saved Scan
              Setup ({setup.tier} tier{setup.panning ? ", panning" : ""}), renders the result,
              scores it against the video&apos;s Ground Truth, and posts the run.
            </p>
          ) : (
            <p className="rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-sm text-caution">
              This video has no saved Scan Setup. Calibrate it before analyzing.
            </p>
          )}
          {setup && !groundTruth && (
            <p className="rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-xs text-caution">
              No accepted Ground Truth for this video — the run will render and post unscored.
            </p>
          )}
          {setup && truthStale && (
            <p className="rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-xs text-caution">
              This video&apos;s Ground Truth was accepted under an older calibration — a run
              under the current Setup cannot pair with it and will post unscored. Re-seed
              and re-accept the truth in calibration first.
            </p>
          )}
          {phase === "error" && phaseError && (
            <p className="rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
              {phaseError}
            </p>
          )}
          {setup && !ready && (
            <div className="flex items-center gap-2 text-xs text-fg-muted">
              <LoadingSpinner />
              <span>Loading the detection model…</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => void run()}
            disabled={!ready}
            className="rounded-md bg-send px-4 py-2 text-sm font-medium text-fg-inverse disabled:opacity-50"
          >
            {phase === "error" ? "Run Analyze again" : "Run Analyze"}
          </button>
          {setup?.setupHash && (
            <p className="font-mono text-xs text-fg-muted">setup {setup.setupHash.slice(0, 12)}</p>
          )}
        </div>
      </div>
    </div>
  );
}
