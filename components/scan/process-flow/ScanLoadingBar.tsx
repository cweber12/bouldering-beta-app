"use client";

interface ScanLoadingBarProps {
  progressPct: number;
  finishing: boolean;
}

export default function ScanLoadingBar({ progressPct, finishing }: ScanLoadingBarProps) {
  const width = Math.max(0, Math.min(100, finishing ? 100 : progressPct));
  return (
    <div className="h-1 bg-edge/30" aria-hidden="true">
      <div
        className="h-full bg-send transition-[width] duration-200"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}