import { useCallback, useRef, useState } from "react";

export interface GeocodeResult {
  displayName: string;
  /** Short human-readable name (city, state, country). */
  shortName: string;
  lat: number;
  lng: number;
  /** Structured address parts (available from reverse geocoding). */
  address?: {
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

/** Nominatim reverse-geocode result shape (subset). */
interface NominatimReverse {
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

/** Nominatim forward-search result shape (subset). */
interface NominatimSearch {
  display_name: string;
  lat: string;
  lon: string;
}

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT_HEADER = { "Accept-Language": "en" };

function buildShortName(address: NominatimReverse["address"]): string {
  if (!address) return "";
  const city = address.city ?? address.town ?? address.village ?? address.county ?? "";
  const state = address.state ?? "";
  const country = address.country ?? "";
  return [city, state, country].filter(Boolean).join(", ");
}

export interface UseGeocodingResult {
  /** Reverse-geocode a lat/lng pair → human-readable location. */
  reverseGeocode: (lat: number, lng: number) => Promise<GeocodeResult | null>;
  /** Debounced autocomplete search. Calls `onResults` with suggestions. */
  searchLocation: (query: string, onResults: (r: GeocodeResult[]) => void) => void;
  loading: boolean;
  error: string | null;
}

/**
 * Nominatim-backed geocoding hook.
 *
 * `searchLocation` is debounced at 500 ms to respect the 1 req/s rate limit.
 */
export function useGeocoding(): UseGeocodingResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reverseGeocode = useCallback(
    async (lat: number, lng: number): Promise<GeocodeResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`;
        const res = await fetch(url, { headers: USER_AGENT_HEADER });
        if (!res.ok) throw new Error("Reverse geocode failed.");
        const data = (await res.json()) as NominatimReverse;
        return {
          displayName: data.display_name,
          shortName: buildShortName(data.address),
          lat,
          lng,
          address: data.address,
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Geocode error.");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const searchLocation = useCallback(
    (query: string, onResults: (r: GeocodeResult[]) => void): void => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      if (query.trim().length < 2) {
        onResults([]);
        return;
      }

      debounceTimer.current = setTimeout(async () => {
        setLoading(true);
        setError(null);
        try {
          const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
          const res = await fetch(url, { headers: USER_AGENT_HEADER });
          if (!res.ok) throw new Error("Search failed.");
          const data = (await res.json()) as NominatimSearch[];
          onResults(
            data.map((item) => ({
              displayName: item.display_name,
              shortName: item.display_name.split(",").slice(0, 2).join(",").trim(),
              lat: parseFloat(item.lat),
              lng: parseFloat(item.lon),
            })),
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : "Search error.");
          onResults([]);
        } finally {
          setLoading(false);
        }
      }, 500);
    },
    [],
  );

  return { reverseGeocode, searchLocation, loading, error };
}
