"use client";

import { useEffect, useRef, useState } from "react";
import LoadingGate from "@/components/shared/LoadingGate";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useTFModel } from "@/hooks/useTFModel";
import { useVideoProcessor } from "@/hooks/useVideoProcessor";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { usePoseVideo } from "@/hooks/usePoseVideo";
import { getAttempt } from "@/storage/sessionStore";

function AppReady() {
  const { cv } = useOpenCV();
  const { model } = useTFModel();
  const { process, status, orbStatus, currentFrame, totalFrames, attemptId, errorMessage } =
    useVideoProcessor(100);
  const { matchImage, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();
  const [routeImageFile, setRouteImageFile] = useState<File | null>(null);
  const { videoUrl, status: videoStatus, errorMessage: videoError } = usePoseVideo(
    cv,
    routeImageFile,
    attemptId,
    matchStatus === "done" ? matchResult : null,
  );
  const loggedRef = useRef(false);

  // Log runtime confirmation once.
  useEffect(() => {
    if (cv && model && !loggedRef.current) {
      loggedRef.current = true;
      console.info("[App] Both runtimes ready. cv:", cv, "| pose model:", model);
    }
  }, [cv, model]);

  // Log processing results when done.
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
    if (file && model && cv) process(file, model, cv);
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
      <h1 className="text-2xl font-semibold tracking-tight">Bouldering Beta</h1>

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
          </p>
        </div>
      )}

      {status === "done" && orbStatus !== "ready" && (
        <p className="text-sm text-zinc-400">
          {orbStatus === "extracting" ? "Extracting ORB reference features…" : orbStatus === "failed" ? "ORB extraction failed — image matching unavailable." : "Done — check the console for frame data."}
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

export default function Home() {
  return (
    <LoadingGate>
      <AppReady />
    </LoadingGate>
  );
}
