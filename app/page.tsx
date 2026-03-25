"use client";

import { useEffect, useRef } from "react";
import LoadingGate from "@/components/shared/LoadingGate";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useTFModel } from "@/hooks/useTFModel";
import { useVideoProcessor } from "@/hooks/useVideoProcessor";
import { getAttempt } from "@/storage/sessionStore";

function AppReady() {
  const { cv } = useOpenCV();
  const { model } = useTFModel();
  const { process, status, currentFrame, totalFrames, attemptId, errorMessage } =
    useVideoProcessor(100);
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
        `[App] Processing complete. frames=${attempt?.frames.length ?? 0}`,
        attempt?.frames[0] ?? "no frames",
      );
    }
  }, [status, attemptId]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && model) process(file, model);
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

      {status === "done" && (
        <p className="text-sm text-emerald-400">
          Done — check the console for frame data (attempt {attemptId}).
        </p>
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
