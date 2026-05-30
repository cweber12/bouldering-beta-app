"use client";

export interface FixSuggestion {
  id: string;
  title: string;
  detail: string;
  actionLabel: string;
  onAction: () => void;
}

interface FixSuggestionsPanelProps {
  suggestions: FixSuggestion[];
}

export default function FixSuggestionsPanel({ suggestions }: FixSuggestionsPanelProps) {
  if (!suggestions.length) return null;

  return (
    <section className="rounded-2xl border border-caution-border bg-caution-surface px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-caution">Suggested fixes</p>
      <div className="mt-2 flex flex-col gap-2">
        {suggestions.map((s) => (
          <div key={s.id} className="rounded-xl border border-caution-border/60 bg-surface-alt/40 px-3 py-2.5">
            <p className="text-xs font-semibold text-fg">{s.title}</p>
            <p className="mt-0.5 text-xs text-fg-secondary">{s.detail}</p>
            <button
              type="button"
              onClick={s.onAction}
              className="mt-2 rounded-lg border border-caution-border px-2.5 py-1.5 text-xs font-medium text-caution transition hover:bg-caution/10"
            >
              {s.actionLabel}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}