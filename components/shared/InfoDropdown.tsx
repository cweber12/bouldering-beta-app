interface InfoDropdownProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

/**
 * Accessible disclosure accordion using native <details>/<summary>.
 * No JavaScript needed — the browser handles expand/collapse.
 */
export default function InfoDropdown({ title, children, defaultOpen = false }: InfoDropdownProps) {
  return (
    <details
      open={defaultOpen}
      className="group w-full rounded-lg border border-zinc-800 bg-zinc-900"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-zinc-300 select-none transition hover:text-zinc-100">
        <span>{title}</span>
        {/* Chevron rotates when open */}
        <svg
          className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="border-t border-zinc-800 px-4 py-3 text-sm leading-relaxed text-zinc-400">
        {children}
      </div>
    </details>
  );
}
