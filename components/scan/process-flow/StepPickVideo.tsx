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
      totalSteps={3}
      stepName="Choose a video"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6">
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Upload existing file */}
          <label className="group relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-lg border border-edge/55 bg-card/40 px-5 py-5 text-left transition-colors duration-150 hover:border-edge-hover hover:bg-card/60">
            <span className="absolute right-3 top-3 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
              Recommended
            </span>
            <span className="flex h-11 w-11 items-center justify-center rounded-md bg-accent/10 text-accent">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-fg">Upload video</span>
              <span className="text-xs text-fg-secondary">MP4, MOV, or WebM</span>
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
            className="group flex flex-col gap-3 rounded-lg border border-edge/55 bg-card/40 px-5 py-5 text-left transition-colors duration-150 hover:border-edge-hover hover:bg-card/60"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-md bg-inset text-fg-secondary group-hover:text-fg">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-fg">Record from camera</span>
              <span className="text-xs text-fg-secondary">Use your device camera</span>
            </span>
          </button>
        </div>
      </div>
    </ProcessFlowShell>
  );
}
