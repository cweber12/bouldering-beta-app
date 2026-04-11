"use client";

import { useCallback, useRef, useState } from "react";
import { useGeocoding, type GeocodeResult } from "@/hooks/useGeocoding";
import { cn } from "@/utils/cn";

export interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when the user selects a geocoded result with lat/lng. */
  onCoordinateSelect?: (lat: number, lng: number) => void;
  placeholder?: string;
  className?: string;
  label?: string;
  id?: string;
}

/**
 * Text input with Nominatim-backed location autocomplete dropdown.
 *
 * Debounces at 500 ms. Shows up to 5 suggestions. Selecting a suggestion
 * fills the text field with its short name and optionally calls
 * `onCoordinateSelect` with the lat/lng.
 */
export default function LocationAutocomplete({
  value,
  onChange,
  onCoordinateSelect,
  placeholder = "Search location…",
  className = "",
  label,
  id,
}: LocationAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const { searchLocation, loading } = useGeocoding();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputId = id ?? "location-autocomplete";

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      onChange(q);
      searchLocation(q, (results) => {
        setSuggestions(results);
        setOpen(results.length > 0);
      });
    },
    [onChange, searchLocation],
  );

  const handleSelect = useCallback(
    (result: GeocodeResult) => {
      onChange(result.shortName);
      if (onCoordinateSelect) onCoordinateSelect(result.lat, result.lng);
      setSuggestions([]);
      setOpen(false);
    },
    [onChange, onCoordinateSelect],
  );

  // Close dropdown when clicking outside.
  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node | null)) {
      setOpen(false);
    }
  }, []);

  return (
    <div ref={containerRef} className="relative" onBlur={handleBlur}>
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1 block text-xs font-medium text-fg-secondary"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={handleChange}
          onFocus={() => setOpen(suggestions.length > 0)}
          placeholder={placeholder}
          className={cn("w-full rounded-lg border border-edge bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-placeholder focus:border-accent focus:outline-none", className)}
          autoComplete="off"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-muted">
            …
          </span>
        )}
      </div>

      {open && (
        <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-edge bg-surface shadow-lg">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur before click
                  handleSelect(s);
                }}
                className="w-full px-3 py-2 text-left text-sm text-fg transition hover:bg-inset focus:outline-none"
              >
                <span className="block font-medium">{s.shortName}</span>
                <span className="block truncate text-xs text-fg-muted">{s.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
