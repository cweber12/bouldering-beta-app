"use client";

import { useEffect, useRef, useState } from "react";
import LoadingGate from "@/components/shared/LoadingGate";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useTFModel } from "@/hooks/useTFModel";
import { useVideoProcessor, type ClimbingMode } from "@/hooks/useVideoProcessor";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { usePoseVideo } from "@/hooks/usePoseVideo";
import { getAttempt } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Mode selector
// ---------------------------------------------------------------------------

interface ModeSelectorProps {
  onSelect: (mode: ClimbingMode) => void;
}

function ModeSelector({ onSelect }: ModeSelectorProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-950 text-zinc-100 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Bouldering Beta</h1>
      <p className="text-sm text-zinc-400">Choose your climbing environment</p>
      <div className="flex gap-4">
        <button
          onClick={() => onSelect("indoor")}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-10 py-6 text-center text-sm font-medium text-zinc-200 transition hover:border-zinc-400 hover:bg-zinc-800"
        >
          <span className="block text-3xl mb-2">🏋️</span>
          Indoor
        </button>
        <button
          onClick={() => onSelect("outdoor")}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-10 py-6 text-center text-sm font-medium text-zinc-200 transition hover:border-zinc-400 hover:bg-zinc-800"
        >
          <span className="block text-3xl mb-2">🧗</span>
          Outdoor
        </button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Main app (runtimes loaded, mode chosen)
// ---------------------------------------------------------------------------

interface AppReadyProps {
  mode: ClimbingMode;
  onReset: () => void;
}

function AppReady({ mode, onReset }: AppReadyProps) {
  const { cv } = useOpenCV();
  const { model } = useTFModel();
  const { process, status, orbStatus, currentFrame, totalFrames, attemptId, errorMessage } =
    useVideoProcessor(100);
  const { matchImage, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();
  const [routeImageFile, setRouteImageFile] = useState<File | null>(null);
  const [frameStep, setFrameStep] = useState(5);
  const { videoUrl, status: videoStatus, errorMessage: videoError } = usePoseVideo(
    cv,
    routeImageFile,
    attemptId,
    matchStatus === "done" ? matchResult : null,
  );
  const loggedRef = useRef(false);

  useEffect(() => {
    if (cv && model && !loggedRef.current) {
      loggedRef.current = true;
      console.info("[App] Both runtimes ready. cv:", cv, "| pose model:", model);
    }
  }, [cv, model]);

  useEffect(() => {
    if (status === "done" && attemptId) {
      const attempt = getAttempt(attemptId);
      console.info(
        `[App] Processing complete. frames=${attempt?.frames.length ?? 0} orbKP=${attempt?.orbFeatures?.keypoints.length ?? 0}`,
        attempt?.frames[0] ?? "no frames",
      );
    }
  }, [status, attemptId]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && model && cv) process(file, model, cv, mode, frameStep);
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRouteImageFile(file);
    if (attemptId && cv) matchImage(file, attemptId, cv);
  }

  const progressPct = totalFrames > 0 ? Math.round((currentFrame / totalFrames) * 100) : 0;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 text-zinc-100 p-8">
      <div className="flex w-full max-w-sm items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Bouldering Beta</h1>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300 capitalize">
            {mode}
          </span>
          <button
            onClick={onReset}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition"
          >
            Change
          </button>
        </div>
      </div>

      {/* Outdoor-only: frame step control */}
      {mode === "outdoor" && status === "idle" && (
        <div className="flex w-full max-w-sm flex-col gap-2">
          <label className="flex items-center justify-between text-sm text-zinc-400">
            <span>Pose detection every N frames</span>
            <span className="font-mono text-zinc-200">{frameStep}</span>
          </label>
          <input
            type="range"
            min={1}
            max={30}
            value={frameStep}
            onChange={e => setFrameStep(Number(e.target.value))}
            className="w-full accent-zinc-200"
          />
          <p className="text-xs text-zinc-500">
            Lower = more accurate, slower. Higher = faster, gaps interpolated.
          </p>
        </div>
      )}

      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-8 py-6 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200">
        <span>Select a climbing video</span>
        <input
          type="file"
          accept="video/*"
          className="hidden"
          disabled={status === "processing"}
          onChange={handleFileChange}
        />
      </label>

      {status === "processing" && (
        <div className="flex w-full max-w-xs flex-col gap-2">
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-zinc-200 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-center text-xs text-zinc-400">
            Frame {currentFrame} / {totalFrames} ({progressPct}%)
            {mode === "outdoor" && (
              <span className="ml-2 text-zinc-500">· pose every {frameStep} frames</span>
            )}
          </p>
        </div>
      )}

      {status === "done" && orbStatus !== "ready" && (
        <p className="text-sm text-zinc-400">
          {orbStatus === "extracting"
            ? "Extracting ORB reference features…"
            : orbStatus === "failed"
              ? "ORB extraction failed — image matching unavailable."
              : "Done — check the console for frame data."}
        </p>
      )}

      {status === "done" && orbStatus === "ready" && (
        <p className="text-sm text-emerald-400">
          Done — check the console for frame data (attempt {attemptId}).
        </p>
      )}

      {status === "done" && orbStatus === "ready" && attemptId && (
        <div className="flex w-full max-w-sm flex-col gap-3">
          <p className="text-center text-xs text-zinc-400 uppercase tracking-widest">
            Match a route photo
          </p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-8 py-5 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200">
            <span>{matchStatus === "matching" ? "Extracting features…" : "Select a route image"}</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={matchStatus === "matching"}
              onChange={handleImageChange}
            />
          </label>

          {matchStatus === "done" && matchResult && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-5 py-4 text-sm">
              <p className="font-medium text-zinc-200">
                {matchResult.matches.length} strong match{matchResult.matches.length !== 1 ? "es" : ""}
              </p>
              <p className="mt-1 text-zinc-500">
                {matchResult.queryKeypoints} keypoints in image ·{" "}
                {matchResult.referenceKeypoints} in reference frame
              </p>
            </div>
          )}

          {matchStatus === "done" && videoStatus === "rendering" && (
            <p className="text-center text-xs text-zinc-400">Rendering pose video…</p>
          )}

          {matchStatus === "done" && videoStatus === "ready" && videoUrl && (
            <video
              src={videoUrl}
              controls
              loop
              autoPlay
              muted
              playsInline
              className="w-full rounded-xl border border-zinc-700"
            />
          )}

          {matchStatus === "done" && videoStatus === "error" && (
            <p className="text-sm text-red-400">Video error: {videoError}</p>
          )}

          {matchStatus === "error" && (
            <p className="text-sm text-red-400">Match error: {matchError}</p>
          )}
        </div>
      )}

      {status === "error" && (
        <p className="text-sm text-red-400">Error: {errorMessage}</p>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

function HomeInner() {
  const [mode, setMode] = useState<ClimbingMode | null>(null);

  if (!mode) return <ModeSelector onSelect={setMode} />;
  return <AppReady mode={mode} onReset={() => setMode(null)} />;
}

export default function Home() {
  return (
    <LoadingGate>
      <HomeInner />
    </LoadingGate>
  );
}
