"use client";

import ProcessFlowShell from "@/components/scan/process-flow/ProcessFlowShell";

export interface StepPickVideoProps {
  onFile: (file: File) => void;
  onCamera: () => void;
}

export default function StepPickVideo({ onFile, onCamera }: StepPickVideoProps) {
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  }

  return (
    <ProcessFlowShell
      step={1}
      totalSteps={4}
      stepName="Choose clip"
      purpose="Film or pick a video of your climb — we'll trace your movement and place it on the route."
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full divide-y divide-edge/40 overflow-hidden rounded-(--radius-panel) border border-edge/55">
          {/* Upload existing file — primary path, listed first */}
          <label className="group flex cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-card/40">
            <svg className="h-5 w-5 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <span className="flex flex-1 items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-fg">Upload video</span>
              <span className="text-xs text-fg-muted">MP4, MOV, WebM</span>
            </span>
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>

          {/* Record with camera */}
          <button
            type="button"
            onClick={onCamera}
            className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-card/40"
          >
            <svg className="h-5 w-5 shrink-0 text-fg-secondary group-hover:text-fg" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span className="flex flex-1 items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-fg">Record from camera</span>
              <span className="text-xs text-fg-muted">Use device camera</span>
            </span>
          </button>
        </div>
      </div>
    </ProcessFlowShell>
  );
}
