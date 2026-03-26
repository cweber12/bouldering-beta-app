"use client";

import { useCallback, useRef, useState } from "react";
import { estimateFrame, type PoseFrame } from "@/pipeline/poseDetection";
import { extractFeatures } from "@/pipeline/orbDetector";
import { saveAttempt, type VideoMeta } from "@/storage/sessionStore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PoseDetector = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export type ProcessingStatus = "idle" | "processing" | "done" | "error";
export type OrbStatus = "idle" | "extracting" | "ready" | "failed";

export interface VideoProcessorResult {
  /** Start processing the supplied video File. */
  process: (file: File, detector: PoseDetector, cv: CV) => Promise<void>;
  status: ProcessingStatus;
  /** Tracks background ORB extraction after the seek loop completes. */
  orbStatus: OrbStatus;
  /** Frame index currently being processed (0-based). */
  currentFrame: number;
  /** Total frames to process (known after video metadata loads). */
  totalFrames: number;
  /** The attempt ID written to sessionStore, available when status === "done". */
  attemptId: string | null;
  errorMessage: string | null;
}

/**
 * Seeks through a video file frame-by-frame, runs pose estimation on each
 * frame, and writes the result to the session store.
 *
 * Processing happens entirely in the browser — no network calls.
 *
 * @param frameIntervalMs - How far apart sampled frames are (default 100 ms).
 *                          Lower = more frames = slower and more data.
 */
export function useVideoProcessor(frameIntervalMs = 100): VideoProcessorResult {
  const [status, setStatus] = useState<ProcessingStatus>("idle");
  const [orbStatus, setOrbStatus] = useState<OrbStatus>("idle");
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef(false);

  const process = useCallback(
    async (file: File, detector: PoseDetector, cv: CV) => {
      abortRef.current = false;
      setStatus("processing");
      setOrbStatus("idle");
      setCurrentFrame(0);
      setTotalFrames(0);
      setAttemptId(null);
      setErrorMessage(null);

      // Create an offscreen video element — never attached to the DOM.
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      const objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;

      // Create a canvas for drawing individual frames.
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        setStatus("error");
        setErrorMessage("Could not get 2D canvas context.");
        URL.revokeObjectURL(objectUrl);
        return;
      }

      try {
        // Wait for the browser to read the video dimensions and duration.
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error("Failed to load video metadata."));
        });

        const { duration, videoWidth, videoHeight } = video;
        canvas.width = videoWidth;
        canvas.height = videoHeight;

        // Calculate how many frames we'll sample.
        const frameCount = Math.ceil((duration * 1000) / frameIntervalMs);
        setTotalFrames(frameCount);

        const videoMeta: VideoMeta = {
          name: file.name,
          duration,
          fps: frameCount / duration,
          width: videoWidth,
          height: videoHeight,
        };

        const frames: PoseFrame[] = [];
        const id = `attempt-${Date.now()}`;
        let referenceImageData: ImageData | null = null;

        for (let i = 0; i < frameCount; i++) {
          if (abortRef.current) break;

          const seekTime = (i * frameIntervalMs) / 1000;

          // Seek and wait for the frame to be ready.
          await new Promise<void>((resolve, reject) => {
            video.onseeked = () => resolve();
            video.onerror = () => reject(new Error(`Seek failed at ${seekTime}s`));
            video.currentTime = Math.min(seekTime, duration);
          });

          ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

          // Save the first frame as the ORB reference — extracted after the loop
          // so the seek loop is never blocked waiting for the WASM worker.
          if (i === 0) {
            referenceImageData = ctx.getImageData(0, 0, videoWidth, videoHeight);
          }

          const frame = await estimateFrame(detector, canvas, video.currentTime);
          if (frame) frames.push(frame);

          setCurrentFrame(i + 1);
        }

        // Save the attempt and unblock the UI immediately — don't wait for ORB.
        saveAttempt({ id, videoMeta, frames, orbFeatures: null, matchesPerFrame: null });
        setAttemptId(id);
        setStatus("done");

        console.info(
          `[useVideoProcessor] Done. attempt=${id} totalFrames=${frames.length}`,
          frames[0] ?? "no frames detected",
        );

        // Extract ORB features from the reference frame on the main thread.
        // OpenCV is already initialised here, so this is synchronous and reliable.
        if (referenceImageData) {
          setOrbStatus("extracting");
          try {
            const orbFeatures = extractFeatures(cv, referenceImageData);
            saveAttempt({ id, videoMeta, frames, orbFeatures, matchesPerFrame: null });
            setOrbStatus("ready");
            console.info(
              `[useVideoProcessor] ORB reference ready. keypoints=${orbFeatures.keypoints.length}`,
            );
          } catch (orbErr) {
            setOrbStatus("failed");
            console.warn("[useVideoProcessor] ORB reference extraction failed:", orbErr);
          }
        } else {
          setOrbStatus("failed");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[useVideoProcessor] Error:", err);
        setStatus("error");
        setErrorMessage(msg);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    },
    [frameIntervalMs],
  );

  return { process, status, orbStatus, currentFrame, totalFrames, attemptId, errorMessage };
}
