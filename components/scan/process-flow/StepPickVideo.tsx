"use client";

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
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6">
      <div className="w-full rounded-3xl border border-edge/40 bg-surface-alt/35 p-5 shadow-xl shadow-black/10 sm:p-7">
        <div className="mb-5 flex flex-col gap-2">
          <p className="text-label tracking-label text-fg-muted uppercase">Start Scan</p>
          <h2 className="text-xl font-semibold text-fg">Choose your video source</h2>
          <p className="text-sm text-fg-secondary">
            Upload an existing climb clip or record a new one. You can crop and tune settings in the next step.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr]">
          {/* Primary: Choose existing file */}
          <label className="group relative flex cursor-pointer items-center gap-4 overflow-hidden rounded-2xl border border-accent/40 bg-accent/10 px-4 py-4 text-left transition-colors duration-150 hover:bg-accent/15">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/20 text-accent">
              <svg
                className="h-7 w-7"
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
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold text-fg">Upload video</span>
              <span className="text-xs text-fg-secondary">Primary path: fastest way to start</span>
            </div>
            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-inverse">
              Recommended
            </span>
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>

          {/* Secondary: Record with camera */}
          <button
            type="button"
            onClick={onCamera}
            className="group flex items-center gap-3 rounded-2xl border border-edge/60 bg-surface-alt/60 px-4 py-4 text-left transition-colors duration-150 hover:border-edge-hover hover:bg-surface-alt/80"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-inset text-fg-secondary group-hover:text-fg">
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
                />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-fg">Record from camera</span>
              <span className="text-xs text-fg-secondary">Good for on-the-spot attempts</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
