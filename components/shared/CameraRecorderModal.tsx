"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  onCapture: (file: File) => void;
  onClose: () => void;
}

export default function CameraRecorderModal({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: true })
      .then(stream => {
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setReady(true);
      })
      .catch(err => {
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
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "";
    const mr = new MediaRecorder(
      streamRef.current,
      mimeType ? { mimeType } : undefined,
    );
    mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
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
    recorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Record a video"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-t-2xl shadow-2xl sm:rounded-2xl"
        style={{ backgroundColor: "#143D60" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Camera preview */}
        <div className="relative aspect-video w-full bg-black">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
          />
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
          {error ? null : !recording ? (
            <button
              onClick={startRecording}
              disabled={!ready}
              className="flex-1 rounded-xl py-3 text-sm font-semibold text-[#DDEB9D] transition disabled:opacity-40"
              style={{ backgroundColor: "#EB5B00" }}
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
            onClick={onClose}
            className="rounded-xl border px-5 py-3 text-sm font-medium transition hover:text-[#DDEB9D]"
            style={{ borderColor: "#1c5277", color: "#8dc4d8" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
