import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGeocoding } from "@/hooks/useGeocoding";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockNominatimReverse = {
  display_name: "Boulder, Boulder County, Colorado, United States",
  address: {
    city: "Boulder",
    state: "Colorado",
    country: "United States",
  },
};

const mockNominatimSearch = [
  {
    display_name: "Denver, Denver County, Colorado, United States",
    lat: "39.7392",
    lon: "-104.9903",
  },
];

describe("useGeocoding", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/reverse")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockNominatimReverse),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockNominatimSearch),
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reverseGeocode returns structured result", async () => {
    const { result } = renderHook(() => useGeocoding());
    let geocodeResult: Awaited<ReturnType<typeof result.current.reverseGeocode>>;

    await act(async () => {
      geocodeResult = await result.current.reverseGeocode(40.0, -105.3);
    });

    expect(geocodeResult!).not.toBeNull();
    expect(geocodeResult!.lat).toBe(40.0);
    expect(geocodeResult!.lng).toBe(-105.3);
    expect(geocodeResult!.address?.city).toBe("Boulder");
    expect(geocodeResult!.address?.state).toBe("Colorado");
    expect(geocodeResult!.shortName).toBe("Boulder, Colorado, United States");
  });

  it("reverseGeocode returns null on fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false })));

    const { result } = renderHook(() => useGeocoding());
    let geocodeResult: Awaited<ReturnType<typeof result.current.reverseGeocode>>;

    await act(async () => {
      geocodeResult = await result.current.reverseGeocode(0, 0);
    });

    expect(geocodeResult!).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it("searchLocation debounces and calls onResults", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useGeocoding());
    const onResults = vi.fn();

    act(() => {
      result.current.searchLocation("Denver", onResults);
    });

    // Not called yet — debounced
    expect(onResults).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve(); // flush microtasks
    });

    expect(onResults).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ lat: 39.7392, lng: -104.9903 }),
      ]),
    );
  });

  it("searchLocation clears results for short query", () => {
    const { result } = renderHook(() => useGeocoding());
    const onResults = vi.fn();

    act(() => {
      result.current.searchLocation("D", onResults);
    });

    expect(onResults).toHaveBeenCalledWith([]);
  });
});
