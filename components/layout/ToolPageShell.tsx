import { cn } from "@/utils/cn";

interface ToolPageShellProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Shared route shell for tool-style pages that must fit within the viewport
 * under the sticky nav. Child regions can still use local overflow.
 */
export default function ToolPageShell({ children, className }: ToolPageShellProps) {
  return (
    <main
      className={cn(
        "h-[calc(100dvh-var(--nav-h))] min-h-0 w-full flex flex-col overflow-hidden",
        className,
      )}
    >
      {children}
    </main>
  );
}
