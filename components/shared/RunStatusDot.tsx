import { cn } from "@/utils/cn";

interface RunStatusDotProps {
  runType?: string | null;
  className?: string;
}

/**
 * Minimal run-type indicator: a small green (send) / amber (attempt) dot.
 * Used where a full text badge would be too heavy — e.g. the compare metadata
 * line, where date/time carry the signal and the dot just flags the outcome.
 */
export default function RunStatusDot({ runType, className }: RunStatusDotProps) {
  const isSend = runType === "send";
  return (
    <span
      className={cn(
        "h-2.5 w-2.5 shrink-0 rounded-full",
        isSend ? "bg-send" : "bg-attempt",
        className,
      )}
      title={isSend ? "Send" : "Attempt"}
      aria-label={isSend ? "Send" : "Attempt"}
      role="img"
    />
  );
}
