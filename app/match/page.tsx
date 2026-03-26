"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import LoadingGate from "@/components/shared/LoadingGate";
import InfoDropdown from "@/components/shared/InfoDropdown";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { usePoseVideo } from "@/hooks/usePoseVideo";
import { getAttempt, saveAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Load an attempt from a JSON saved with "Save to device"
// ---------------------------------------------------------------------------

function loadAttemptFromJson(raw: unknown): RouteAttempt {
  if (!raw || typeof raw !== "object") throw new Error("Invalid attempt data.");
  const obj = raw as Record<string, unknown>;
  // Re-hydrate descriptors from number[] → Uint8Array
  if (obj.orbFeatures && typeof obj.orbFeatures === "object") {
    const orb = obj.orbFeatures as Record<string, unknown>;
    if (Array.isArray(orb.descriptors)) {
      orb.descriptors = new Uint8Array(orb.descriptors as number[]);
    }
  }
  return obj as unknown as RouteAttempt;
}

// ---------------------------------------------------------------------------
// Inner component (uses useSearchParams — wrapped in Suspense below)
// ---------------------------------------------------------------------------

function MatchPageInner() {
  const searchParams = useSearchParams();
  const urlAttemptId = searchParams.get("id") ?? "";

  const { cv } = useOpenCV();
  const { matchImage, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();

  const [attemptId, setAttemptId] = useState<string>(() => urlAttemptId);
  const [attempt, setAttempt] = useState<RouteAttempt | null>(() =>
    urlAttemptId ? (getAttempt(urlAttemptId) ?? null) : null,
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const imagePreviewUrlRef = useRef<string | null>(null);

  const { videoUrl, status: videoStatus, errorMessage: videoError } = usePoseVideo(
    cv,
    imageFile,
    attemptId || null,
    matchResult,
  );

  // Clean up image preview on unmount
  useEffect(() => {
    return () => {
      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    };
  }, []);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    const url = URL.createObjectURL(file);
    imagePreviewUrlRef.current = url;
    setImagePreviewUrl(url);
    setImageFile(file);
    if (cv && attemptId) matchImage(file, attemptId, cv);
  }

  function handleLoadFromDevice(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        const loaded = loadAttemptFromJson(parsed);
        setAttemptId(loaded.id);
        setAttempt(loaded);
        // Back-fill sessionStore so the downstream hooks can find it
        saveAttempt(loaded);
      } catch (err) {
        console.error("[MatchPage] Failed to parse attempt JSON:", err);
        alert("Could not load attempt file — the JSON may be corrupted.");
      }
    };
    reader.readAsText(file);
  }

  const isMatching = matchStatus === "matching";
  const isMatchDone = matchStatus === "done";
  const isRenderingVideo = videoStatus === "rendering";
  const isVideoReady = videoStatus === "ready";
  const hasAttempt = !!attempt;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10 flex flex-col gap-8">
      {/* ------------------------------------------------------------------ */}
      {/* Page header                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Route Matching</h1>
          <p className="text-sm text-zinc-400">
            Upload a photo of the route and we&apos;ll overlay your recorded skeleton onto it using
            the ORB reference features extracted on the Upload page.
          </p>
        </div>
        <Link href="/upload" className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300 transition">
          ← Back to upload
        </Link>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Info dropdowns                                                      */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col gap-3">
        <InfoDropdown title="How does route matching work?">
          <p>
            ORB features are extracted from your uploaded photo, then matched to the ORB
            features recorded from the first frame of your video using a{" "}
            <strong className="text-zinc-300">Brute-Force Hamming matcher</strong> with a
            Lowe ratio test (0.7). The surviving correspondences are used to compute a{" "}
            <strong className="text-zinc-300">homography (perspective transform)</strong> via
            RANSAC. This transform maps every skeleton keypoint from video-frame coordinates
            onto the route photo.
          </p>
        </InfoDropdown>

        <InfoDropdown title="What does the pose overlay video show?">
          <p>
            Each frame of the recorded climb is drawn as a skeleton on top of your route photo.
            The skeleton uses the 17 MoveNet COCO keypoints connected by{" "}
            <strong className="text-zinc-300">16 limb edges</strong>. Keypoints with confidence
            below 0.3 are hidden. The video is encoded as a{" "}
            <strong className="text-zinc-300">WebM</strong> file using the browser&apos;s{" "}
            <code className="text-zinc-300">MediaRecorder</code> API — no server needed.
          </p>
        </InfoDropdown>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Attempt source — session or load from device                       */}
      {/* ------------------------------------------------------------------ */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4 flex flex-col gap-3">
        <p className="text-sm font-medium text-zinc-300">Attempt data</p>

        {hasAttempt ? (
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-mono text-zinc-300">{attempt!.id}</span>
              <span className="text-xs text-zinc-500">
                {attempt!.frames.length} pose frames ·{" "}
                {attempt!.orbFeatures?.keypoints.length ?? 0} ORB keypoints
              </span>
            </div>
            <span className="text-xs font-medium text-emerald-400">Loaded</span>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            No attempt loaded. Process a video on the{" "}
            <Link href="/upload" className="text-zinc-300 hover:underline">
              Upload page
            </Link>{" "}
            or load a saved JSON below.
          </p>
        )}

        <div className="flex flex-col gap-2 pt-1 border-t border-zinc-800">
          <p className="text-xs text-zinc-500">Load from device (.json saved on upload page)</p>
          <label className="flex cursor-pointer items-center gap-2 self-start rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200">
            <svg
              className="h-3.5 w-3.5"
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
            Choose attempt file
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleLoadFromDevice}
            />
          </label>
        </div>

        {/* Cloud placeholder */}
        <button
          disabled
          title="Cloud loading coming soon"
          className="self-start flex cursor-not-allowed items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-600"
        >
          <svg
            className="h-3.5 w-3.5"
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
          Load from cloud (coming soon)
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Route image upload                                                  */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col gap-4">
        <label
          className={[
            "flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-8 py-6 text-sm transition",
            !hasAttempt || isMatching
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
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5"
            />
          </svg>
          <span>{isMatching ? "Matching…" : "Select a route photo"}</span>
          <span className="text-xs text-zinc-600">JPG, PNG, WebP accepted</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={!hasAttempt || isMatching}
            onChange={handleImageChange}
          />
        </label>

        {imagePreviewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imagePreviewUrl}
            alt="Route photo preview"
            className="max-h-80 w-full rounded-xl border border-zinc-700 bg-zinc-900 object-contain"
          />
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Match statistics                                                    */}
      {/* ------------------------------------------------------------------ */}
      {isMatchDone && matchResult && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4 flex flex-col gap-1">
          <p className="text-sm font-medium text-zinc-300">Match statistics</p>
          <div className="mt-2 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xl font-bold text-zinc-100">{matchResult.matches.length}</p>
              <p className="text-xs text-zinc-500">good matches</p>
            </div>
            <div>
              <p className="text-xl font-bold text-zinc-100">{matchResult.queryKeypoints}</p>
              <p className="text-xs text-zinc-500">query keypoints</p>
            </div>
            <div>
              <p className="text-xl font-bold text-zinc-100">
                {matchResult.referenceKeypoints}
              </p>
              <p className="text-xs text-zinc-500">reference keypoints</p>
            </div>
          </div>
          {matchResult.matches.length < 10 && (
            <p className="mt-3 text-xs text-amber-400">
              Fewer than 10 matches — the homography may be unstable. Try a closer or better-lit
              photo of the same wall section.
            </p>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Video rendering progress                                            */}
      {/* ------------------------------------------------------------------ */}
      {isRenderingVideo && (
        <p className="text-center text-sm text-zinc-400">Rendering pose overlay video…</p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Pose overlay video                                                  */}
      {/* ------------------------------------------------------------------ */}
      {isVideoReady && videoUrl && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-zinc-300">Pose overlay</p>
          <video
            src={videoUrl}
            controls
            loop
            playsInline
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900"
          />
          <a
            href={videoUrl}
            download={`${attemptId}-pose-overlay.webm`}
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
            Download pose overlay video (.webm)
          </a>
        </div>
      )}

      {/* Errors */}
      {(matchStatus === "error" || videoStatus === "error") && (
        <p className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {matchError ?? videoError}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export
// ---------------------------------------------------------------------------

export default function MatchPage() {
  return (
    <LoadingGate>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            Loading…
          </div>
        }
      >
        <MatchPageInner />
      </Suspense>
    </LoadingGate>
  );
}
