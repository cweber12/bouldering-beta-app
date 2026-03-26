"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import LoadingGate from "@/components/shared/LoadingGate";
import InfoDropdown from "@/components/shared/InfoDropdown";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useTFModel } from "@/hooks/useTFModel";
import { useVideoProcessor, type ClimbingMode } from "@/hooks/useVideoProcessor";
import { getAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Save attempt JSON to device
// ---------------------------------------------------------------------------

function saveAttemptToDevice(attempt: RouteAttempt) {
  const serializable = {
    ...attempt,
    orbFeatures: attempt.orbFeatures
      ? {
          ...attempt.orbFeatures,
          descriptors: Array.from(attempt.orbFeatures.descriptors),
        }
      : null,
  };
  const blob = new Blob([JSON.stringify(serializable, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${attempt.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Upload page inner (needs useSearchParams — wrapped in Suspense below)
// ---------------------------------------------------------------------------

function UploadPageInner() {
  const searchParams = useSearchParams();
  const mode = (searchParams.get("mode") ?? "indoor") as ClimbingMode;

  const { cv } = useOpenCV();
  const { model } = useTFModel();
  const { process, status, orbStatus, currentFrame, totalFrames, attemptId, errorMessage } =
    useVideoProcessor(100);

  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [frameStep, setFrameStep] = useState(5);
  const previewUrlRef = useRef<string | null>(null);

  const progressPct = totalFrames > 0 ? Math.round((currentFrame / totalFrames) * 100) : 0;
  const isProcessing = status === "processing";
  const isDone = status === "done";
  const orbReady = orbStatus === "ready";

  // Log when complete
  useEffect(() => {
    if (isDone && attemptId) {
      const attempt = getAttempt(attemptId);
      console.info(
        `[Upload] Done. frames=${attempt?.frames.length ?? 0} orbKP=${attempt?.orbFeatures?.keypoints.length ?? 0}`,
      );
    }
  }, [isDone, attemptId]);

  // Clean up video preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setVideoPreviewUrl(url);
    if (model && cv) process(file, model, cv, mode, frameStep);
  }

  function handleSaveToDevice() {
    if (!attemptId) return;
    const attempt = getAttempt(attemptId);
    if (attempt) saveAttemptToDevice(attempt);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10 flex flex-col gap-8">
      {/* ------------------------------------------------------------------ */}
      {/* Page header                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
              Video Analysis
            </h1>
            <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-0.5 text-xs font-medium capitalize text-zinc-300">
              {mode}
            </span>
          </div>
          <p className="text-sm text-zinc-400">
            Upload a climbing video to extract skeleton poses and ORB reference features. These
            are used on the Match page to overlay your movement onto a route photo.
          </p>
        </div>
        <Link
          href="/"
          className="shrink-0 text-xs text-zinc-500 transition hover:text-zinc-300"
        >
          ← Change mode
        </Link>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Info dropdowns                                                      */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col gap-3">
        <InfoDropdown title="How does video analysis work?">
          <p>
            The app steps through your video frame-by-frame (every 100 ms by default). For each
            sampled frame it draws the pixels onto an offscreen canvas and runs the{" "}
            <strong className="text-zinc-300">MoveNet Lightning</strong> pose model to detect 17
            body keypoints. All processing happens locally — no frames are sent to a server.
          </p>
          <p className="mt-2">
            After the seek loop finishes, ORB feature descriptors are extracted from the first
            frame. These are used later to align the route photo to the video coordinate space.
          </p>
        </InfoDropdown>

        <InfoDropdown title="What is pose detection?">
          <p>
            <strong className="text-zinc-300">MoveNet Lightning</strong> is a lightweight
            TensorFlow.js model that detects 17 COCO-topology keypoints (nose, shoulders, elbows,
            wrists, hips, knees, ankles) in under 10 ms per frame on most devices. Each keypoint
            includes an (x, y) position normalized to [0, 1] and a confidence score. Keypoints
            below a 0.3 confidence threshold are discarded.
          </p>
        </InfoDropdown>

        <InfoDropdown title="What are ORB features?">
          <p>
            <strong className="text-zinc-300">ORB (Oriented FAST and Rotated BRIEF)</strong> is a
            fast binary feature detector and descriptor. It detects corners and textures in the
            reference video frame and encodes them as compact 256-bit binary strings. When you
            upload a route photo on the Match page, ORB features are extracted from that image
            too, and the two sets are matched using a Hamming-distance BFMatcher with a Lowe
            ratio filter. The resulting correspondences are used to compute a homography (2D
            perspective transform) that maps pose keypoints onto the photo.
          </p>
        </InfoDropdown>

        {mode === "outdoor" && (
          <InfoDropdown title="Outdoor mode — hip crop & interpolation" defaultOpen>
            <p>
              Outdoor video is typically captured with a wide-angle lens, making the climber
              appear small in the frame. To improve pose accuracy, outdoor mode:
            </p>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>
                Runs full-frame pose detection on the first frame to find the initial hip position.
              </li>
              <li>
                For every N-th subsequent frame, crops a{" "}
                <strong className="text-zinc-300">±25% × frame size</strong> window centred on the
                previous hip position before running pose detection.
              </li>
              <li>
                Re-projects the crop-relative keypoints back to full-frame coordinates.
              </li>
              <li>
                Linearly interpolates keypoints between detected frames to fill the gaps.
              </li>
            </ul>
            <p className="mt-2">
              Lower N = more accurate, slower. Increase N for a quicker preview.
            </p>
          </InfoDropdown>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Outdoor frame-step control                                          */}
      {/* ------------------------------------------------------------------ */}
      {mode === "outdoor" && !isProcessing && !isDone && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4 flex flex-col gap-3">
          <label className="flex items-center justify-between text-sm">
            <span className="text-zinc-300 font-medium">Pose detection frequency</span>
            <span className="font-mono text-zinc-100">every {frameStep} frames</span>
          </label>
          <input
            type="range"
            min={1}
            max={30}
            value={frameStep}
            onChange={e => setFrameStep(Number(e.target.value))}
            className="w-full accent-zinc-200"
            aria-label="Frame step"
          />
          <p className="text-xs text-zinc-500">
            1 = pose on every sampled frame (slowest, most accurate) · 30 = pose every 30th
            frame (fastest, more interpolation)
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Video upload                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col gap-4">
        <label
          className={[
            "flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-8 py-6 text-sm transition",
            isProcessing
              ? "cursor-not-allowed border-zinc-800 text-zinc-600"
              : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
          ].join(" ")}
        >
          <svg
            className="h-6 w-6 text-zinc-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
            />
          </svg>
          <span>{isProcessing ? "Processing…" : "Select a climbing video"}</span>
          <span className="text-xs text-zinc-600">MP4, MOV, WebM accepted</span>
          <input
            type="file"
            accept="video/*"
            className="hidden"
            disabled={isProcessing}
            onChange={handleFileChange}
          />
        </label>

        {/* Video preview */}
        {videoPreviewUrl && (
          <video
            src={videoPreviewUrl}
            controls
            muted
            playsInline
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900"
          />
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Progress bar                                                        */}
      {/* ------------------------------------------------------------------ */}
      {isProcessing && (
        <div className="flex flex-col gap-2">
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-zinc-200 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-center text-xs text-zinc-400">
            Analysing frame {currentFrame} of {totalFrames} ({progressPct}%)
            {mode === "outdoor" && (
              <span className="ml-1.5 text-zinc-600">· pose every {frameStep} frames</span>
            )}
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Post-processing status                                              */}
      {/* ------------------------------------------------------------------ */}
      {isDone && orbStatus === "extracting" && (
        <p className="text-center text-sm text-zinc-400">Extracting ORB reference features…</p>
      )}
      {isDone && orbStatus === "failed" && (
        <p className="text-center text-sm text-amber-400">
          ORB extraction failed — image matching will be unavailable.
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Result actions                                                      */}
      {/* ------------------------------------------------------------------ */}
      {isDone && orbReady && attemptId && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 px-5 py-4">
            <p className="text-sm font-medium text-emerald-300">Analysis complete</p>
            <p className="mt-0.5 text-xs text-emerald-500">
              {getAttempt(attemptId)?.frames.length ?? 0} pose frames ·{" "}
              {getAttempt(attemptId)?.orbFeatures?.keypoints.length ?? 0} ORB keypoints extracted
            </p>
          </div>

          {/* Navigation to match page */}
          <Link
            href={`/match?id=${attemptId}`}
            className="flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200"
          >
            Match against a route photo
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>

          {/* Save to device */}
          <button
            onClick={handleSaveToDevice}
            className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            Save data to device ({attemptId}.json)
          </button>

          {/* Cloud upload placeholder */}
          <button
            disabled
            title="Cloud upload coming soon"
            className="flex cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-zinc-800 px-6 py-3 text-sm text-zinc-600"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
              />
            </svg>
            Upload to cloud (coming soon)
          </button>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <p className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page exports
// ---------------------------------------------------------------------------

export default function UploadPage() {
  return (
    <LoadingGate>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            Loading…
          </div>
        }
      >
        <UploadPageInner />
      </Suspense>
    </LoadingGate>
  );
}
