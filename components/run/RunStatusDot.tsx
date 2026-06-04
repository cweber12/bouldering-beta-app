import { cn } from "@/utils/cn";

interface RunStatusDotProps {
  runType?: string | null;
  className?: string;
}

/**
 * Minimal send indicator: a small green dot shown only for sends. Attempts
 * render nothing — the absence of a dot is the "attempt" signal. Used where a
 * full text badge would be too heavy (compare metadata line, overlay legend).
 */
export default function RunStatusDot({ runType, className }: RunStatusDotProps) {
  if (runType !== "send") return null;
  return (
    <span
      className={cn("h-2.5 w-2.5 shrink-0 rounded-full bg-send", className)}
      title="Send"
      aria-label="Send"
      role="img"
    />
  );
}
