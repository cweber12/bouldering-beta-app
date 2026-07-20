import { useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "@/app/profile/page";
import PublicProfilePage from "@/app/profile/[userId]/page";

const mapStats = vi.hoisted(() => ({
  mountCount: 0,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ userId: "public-user" }),
}));

vi.mock("next/dynamic", () => ({
  default: () => {
    return function MockClimbsMap(props: {
      onPinClick?: (key: string) => void;
      pins?: Array<{ key?: string }>;
    }) {
      useEffect(() => {
        mapStats.mountCount += 1;
      }, []);

      const key = props.pins?.[0]?.key ?? "run-1";
      return (
        <button type="button" onClick={() => props.onPinClick?.(key)}>
          Mock pin click
        </button>
      );
    };
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { uid: "self-user", email: "self@example.com" },
    loading: false,
  }),
}));

vi.mock("@/hooks/useS3Storage", () => ({
  useS3Storage: () => ({
    listPrefixes: vi.fn(async () => []),
    userPrefix: "RouteData/self-user",
  }),
}));

vi.mock("@/hooks/useGeolocation", () => ({
  useGeolocation: () => ({
    request: vi.fn(async () => null),
    loading: false,
  }),
}));

vi.mock("@/hooks/useGeocoding", () => ({
  useGeocoding: () => ({
    reverseGeocode: vi.fn(async () => null),
  }),
}));

vi.mock("@/components/shared/ClimbDetailModal", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog">
      <p>Mock climb detail modal</p>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

function response(json: unknown, ok = true) {
  return {
    ok,
    json: async () => json,
  };
}

describe("profile map viewport policy", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mapStats.mountCount = 0;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps map mounted and map mode active when selecting a pin on own profile", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/profile") {
        return response({ displayName: "Self User", location: "Boulder", bio: "" });
      }
      if (url.startsWith("/api/profile/self-user/climbs/page?")) {
        return response({ items: [], total: 0, page: 1, pageSize: 16 });
      }
      if (url === "/api/profile/follow") {
        return response({ following: [] });
      }
      if (url === "/api/profile/self-user/pins") {
        return response({
          pins: [
            {
              key: "run-1",
              lat: 40.015,
              lng: -105.27,
              route: "Classic",
              area: "Boulder",
              state: "CO",
              runType: "attempt",
              timestamp: "2026-07-20",
            },
          ],
        });
      }
      if (url.startsWith("/api/profile/self-user/climbs/detail?key=")) {
        return response({ key: "run-1", route: "Classic", area: "Boulder", state: "CO" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<ProfilePage />);

    fireEvent.click(await screen.findByRole("button", { name: "Map" }));
    await screen.findByRole("button", { name: "Mock pin click" });

    const mountCountBeforeClick = mapStats.mountCount;
    const pinCallsBeforeClick = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/profile/self-user/pins"),
    ).length;
    fireEvent.click(screen.getByRole("button", { name: "Mock pin click" }));

    await screen.findByRole("dialog");

    const mapButton = screen.getByRole("button", { name: "Map" });
    const listButton = screen.getByRole("button", { name: "List" });

    expect(mapButton.getAttribute("aria-pressed")).toBe("true");
    expect(listButton.getAttribute("aria-pressed")).toBe("false");
    expect(mapStats.mountCount).toBe(mountCountBeforeClick);

    const pinCallsAfterClick = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/profile/self-user/pins"),
    ).length;
    expect(pinCallsAfterClick).toBe(pinCallsBeforeClick);
  });

  it("reuses the public profile map instance and pin data across list/map toggles", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/profile/public-user") {
        return response({ userId: "public-user", displayName: "Public User" });
      }
      if (url.startsWith("/api/profile/public-user/climbs/page?")) {
        return response({ items: [], total: 0, page: 1, pageSize: 16 });
      }
      if (url === "/api/profile/public-user/pins") {
        return response({
          pins: [
            {
              key: "run-1",
              lat: 40.015,
              lng: -105.27,
              route: "Classic",
              area: "Boulder",
              runType: "attempt",
              timestamp: "2026-07-20",
            },
          ],
        });
      }
      if (url === "/api/profile/follow") {
        return response({ following: [] });
      }
      return response({}, false);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<PublicProfilePage />);

    fireEvent.click(await screen.findByRole("button", { name: "Map" }));
    await screen.findByRole("button", { name: "Mock pin click" });

    const mountCountAfterFirstMapView = mapStats.mountCount;
    const pinCallsAfterFirstMapView = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/profile/public-user/pins"),
    ).length;

    fireEvent.click(screen.getByRole("button", { name: "List" }));
    fireEvent.click(screen.getByRole("button", { name: "Map" }));

    await waitFor(() => {
      const pinCallsAfterToggle = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/api/profile/public-user/pins"),
      ).length;
      expect(pinCallsAfterToggle).toBe(pinCallsAfterFirstMapView);
    });
    expect(mapStats.mountCount).toBe(mountCountAfterFirstMapView);
  });
});
