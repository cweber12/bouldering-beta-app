"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";

interface Props {
  /** "video" (default) records a clip; "photo" captures a still frame. */
  mode?: "video" | "photo";
  onCapture: (file: File) => void;
  onClose: () => void;
}

export default function CameraRecorderModal({ mode = "video", onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // True only after the user clicks "Stop & save". Teardown paths
  // (ESC / backdrop / Cancel / unmount) leave it false so a recording that was
  // ended by closing the modal is discarded rather than emitted as a capture.
  const saveIntentRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const audioConstraint = mode === "video";

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: audioConstraint })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setReady(true);
      })
      .catch((err) => {
        if (!active) return;
        const name = err instanceof Error ? err.name : "";
        setError(
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? "Camera permission denied. Allow access in your browser settings and try again."
            : `Could not access camera: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    return () => {
      active = false;
      // Tear down without emitting: stop the recorder (intent flag stays false
      // so onstop discards) then release the camera tracks.
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "";
    const mr = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      // Only emit a capture when the user explicitly chose to save. A recording
      // ended by closing the modal is discarded.
      if (!saveIntentRef.current) {
        chunksRef.current = [];
        return;
      }
      const mime = mimeType || "video/webm";
      const ext = mime.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunksRef.current, { type: mime });
      const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: mime });
      onCapture(file);
    };
    mr.start();
    recorderRef.current = mr;
    setRecording(true);
  }

  function stopRecording() {
    saveIntentRef.current = true;
    recorderRef.current?.stop();
    setRecording(false);
  }

  function takePhoto() {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(file);
      },
      "image/jpeg",
      0.92,
    );
  }

  const ariaLabel = mode === "photo" ? "Take a photo" : "Record a video";

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={ariaLabel}
      placement="bottom"
      containerClassName="sm:items-center"
      panelClassName="w-full max-w-lg overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:rounded-2xl"
    >
      {/* Camera preview */}
      <div className="relative aspect-video w-full bg-black">
        <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
        {recording && (
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Recording
          </div>
        )}
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
            Starting camera&hellip;
          </div>
        )}
      </div>

      {error && (
        <div className="border-t border-red-800/40 bg-red-950/40 px-5 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="flex gap-3 p-4">
        {error ? null : mode === "photo" ? (
          <button
            onClick={takePhoto}
            disabled={!ready}
            className="flex-1 rounded-xl bg-accent py-3 text-sm font-semibold text-fg transition hover:bg-accent-hover disabled:opacity-40"
          >
            Take photo
          </button>
        ) : !recording ? (
          <button
            onClick={startRecording}
            disabled={!ready}
            className="flex-1 rounded-xl bg-accent py-3 text-sm font-semibold text-fg transition hover:bg-accent-hover disabled:opacity-40"
          >
            Start recording
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="flex-1 animate-pulse rounded-xl bg-red-600 py-3 text-sm font-semibold text-white transition hover:bg-red-500"
          >
            Stop &amp; save
          </button>
        )}
        <button
          ref={closeButtonRef}
          onClick={onClose}
          className="rounded-xl border border-edge px-5 py-3 text-sm font-medium text-fg-secondary transition hover:border-edge-hover hover:text-fg"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
