import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGeolocation } from "@/hooks/useGeolocation";

describe("useGeolocation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null coords initially", () => {
    const { result } = renderHook(() => useGeolocation());
    expect(result.current.coords).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("resolves coords on success", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (
          success: PositionCallback,
        ) => {
          success({
            coords: { latitude: 51.5, longitude: -0.1, accuracy: 10 },
          } as GeolocationPosition);
        },
      },
    });

    const { result } = renderHook(() => useGeolocation());
    let coords: Awaited<ReturnType<typeof result.current.request>>;

    await act(async () => {
      coords = await result.current.request();
    });

    expect(coords!).toEqual({ lat: 51.5, lng: -0.1, accuracy: 10 });
    expect(result.current.coords).toEqual({ lat: 51.5, lng: -0.1, accuracy: 10 });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("returns null with an error message on permission denied", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (
          _success: PositionCallback,
          error: PositionErrorCallback,
        ) => {
          error({
            code: 1,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: "denied",
          } as GeolocationPositionError);
        },
      },
    });

    const { result } = renderHook(() => useGeolocation());
    let coords: Awaited<ReturnType<typeof result.current.request>>;

    await act(async () => {
      coords = await result.current.request();
    });

    expect(coords!).toBeNull();
    expect(result.current.error).toBe("Location permission denied.");
  });

  it("returns null when geolocation is unsupported", async () => {
    vi.stubGlobal("navigator", {});

    const { result } = renderHook(() => useGeolocation());
    let coords: Awaited<ReturnType<typeof result.current.request>>;

    await act(async () => {
      coords = await result.current.request();
    });

    expect(coords!).toBeNull();
    expect(result.current.error).toBe(
      "Geolocation is not supported by this browser.",
    );
  });

  it("clear() resets coords and error", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (_s: PositionCallback, err: PositionErrorCallback) => {
          err({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "" } as GeolocationPositionError);
        },
      },
    });

    const { result } = renderHook(() => useGeolocation());

    await act(async () => { await result.current.request(); });
    expect(result.current.error).toBeTruthy();

    act(() => { result.current.clear(); });
    expect(result.current.error).toBeNull();
    expect(result.current.coords).toBeNull();
  });
});
