import { useCallback, useState } from "react";

export interface GeoCoords {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface UseGeolocationResult {
  coords: GeoCoords | null;
  loading: boolean;
  error: string | null;
  /** Request the current position. Resolves once the browser responds. */
  request: () => Promise<GeoCoords | null>;
  clear: () => void;
}

/**
 * Thin wrapper around `navigator.geolocation.getCurrentPosition`.
 *
 * `request()` is stable across renders and safe to call inside event handlers.
 */
export function useGeolocation(): UseGeolocationResult {
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback((): Promise<GeoCoords | null> => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      const msg = "Geolocation is not supported by this browser.";
      setError(msg);
      return Promise.resolve(null);
    }

    setLoading(true);
    setError(null);

    return new Promise<GeoCoords | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const result: GeoCoords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          };
          setCoords(result);
          setLoading(false);
          resolve(result);
        },
        (err) => {
          const msg =
            err.code === err.PERMISSION_DENIED
              ? "Location permission denied."
              : err.code === err.POSITION_UNAVAILABLE
                ? "Location unavailable."
                : "Location request timed out.";
          setError(msg);
          setLoading(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
      );
    });
  }, []);

  const clear = useCallback(() => {
    setCoords(null);
    setError(null);
  }, []);

  return { coords, loading, error, request, clear };
}
