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
    <div className="flex flex-1 flex-col items-center justify-start px-4 py-8">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="text-center">
            <p className=" font-semibold text-fg">
                Upload a Video
            </p>
            <p className="mt-1.5 text-sm text-fg-secondary leading-relaxed"> 
                Browse videos on your device or record a new one. 
                Make sure the camera remains still and captures your whole body 
                and the entire route for best results.
            </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {/* Choose existing file */}
          <label className="group flex cursor-pointer flex-col items-center gap-4 rounded-2xl border border-edge/50 bg-card/50 px-4 py-8 text-sm transition-all duration-200 hover:border-accent/50 hover:bg-card/80">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 transition group-hover:bg-accent/15">
              <svg
                className="h-7 w-7 text-accent"
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
            <div className="flex flex-col items-center gap-0.5 text-center">
              <span className="font-semibold uppercase text-fg">Browse</span>
            </div>
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
            className="group flex flex-col items-center gap-4 rounded-2xl border border-edge/50 bg-card/50 px-4 py-8 text-sm transition-all duration-200 hover:border-accent/50 hover:bg-card/80"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 transition group-hover:bg-accent/15">
              <svg
                className="h-7 w-7 text-accent"
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
            <div className="flex flex-col items-center gap-0.5 text-center">
              <span className="font-semibold uppercase text-fg">Record</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
