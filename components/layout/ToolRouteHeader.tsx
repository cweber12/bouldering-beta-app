import { cn } from "@/utils/cn";

interface ToolRouteHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export default function ToolRouteHeader({
  title,
  subtitle,
  actions,
  className,
}: ToolRouteHeaderProps) {
  return (
    <header className={cn("shrink-0 border-b border-edge/30 px-4 py-2 sm:px-6", className)}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-fg">{title}</h1>
          {subtitle && <p className="truncate text-sm text-fg-secondary">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
