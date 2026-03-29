interface InfoDropdownProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

/**
 * Accessible disclosure accordion using native <details>/<summary>.
 * No JavaScript needed â€” the browser handles expand/collapse.
 */
export default function InfoDropdown({ title, children, defaultOpen = false }: InfoDropdownProps) {
  return (
    <details
      open={defaultOpen}
      className="group w-full rounded-lg border border-edge bg-card"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-fg-light select-none transition hover:text-fg">
        <span>{title}</span>
        {/* Chevron rotates when open */}
        <svg
          className="h-4 w-4 shrink-0 text-fg-muted transition-transform duration-200 group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="border-t border-edge px-4 py-3 text-sm leading-relaxed text-fg-secondary">
        {children}
      </div>
    </details>
  );
}
