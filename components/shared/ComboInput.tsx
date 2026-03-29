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
      <label htmlFor={id} className="text-xs font-medium text-[#8fbfc0]">
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
          className="w-full rounded-lg border border-[#2d4e5e] bg-[#192e3a] px-3 py-2 pr-7 text-sm text-[#F5FBE6] placeholder-[#3d6e7a] outline-none transition focus:border-[#FE7F2D]/60 disabled:opacity-50"
        />
        {suggestions.length > 0 && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={handleChevron}
            aria-label="Toggle suggestions"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6a9ca0] hover:text-[#c5dcd8]"
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
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#2d4e5e] bg-[#233D4D] py-1 shadow-xl"
        >
          {visible.map(s => (
            <li key={s}>
              <button
                type="button"
                onClick={() => handleSelect(s)}
                className={`w-full px-3 py-2 text-left text-sm transition hover:bg-[#192e3a] ${
                  s === value ? "font-medium text-[#F5FBE6]" : "text-[#c5dcd8]"
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
