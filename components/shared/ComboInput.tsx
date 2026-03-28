"use client";

import { useId, useRef, useState } from "react";

interface ComboInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Text input with a custom dropdown of suggestions populated from S3.
 *
 * Shows all existing values on focus; filters as the user types.
 * Free text entry is always allowed — suggestions are additive, not restrictive.
 */
export default function ComboInput({
  label,
  value,
  onChange,
  suggestions,
  placeholder,
  disabled = false,
}: ComboInputProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // dirty = user has typed since last focus; controls filter vs show-all
  const [dirty, setDirty] = useState(false);

  const visible = dirty && value
    ? suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()))
    : suggestions;

  function handleFocus() {
    setDirty(false);
    setOpen(true);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDirty(true);
    onChange(e.target.value);
    setOpen(true);
  }

  function handleBlur() {
    setOpen(false);
    setDirty(false);
  }

  function handleSelect(s: string) {
    onChange(s);
    setDirty(false);
    setOpen(false);
  }

  function handleChevron(e: React.MouseEvent) {
    // Prevent input from blurring when the chevron is clicked.
    e.preventDefault();
    if (disabled) return;
    if (open) {
      setOpen(false);
      setDirty(false);
    } else {
      setDirty(false);
      setOpen(true);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-zinc-400">
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 pr-7 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-zinc-500 disabled:opacity-50"
        />
        {suggestions.length > 0 && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={handleChevron}
            aria-label="Toggle suggestions"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        )}
      </div>
      {open && visible.length > 0 && (
        <ul
          onMouseDown={e => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
        >
          {visible.map(s => (
            <li key={s}>
              <button
                type="button"
                onClick={() => handleSelect(s)}
                className={`w-full px-3 py-2 text-left text-sm transition hover:bg-zinc-800 ${
                  s === value ? "font-medium text-zinc-100" : "text-zinc-300"
                }`}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
