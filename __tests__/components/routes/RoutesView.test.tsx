import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RoutesView from "@/components/routes/RoutesView";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next/dynamic", () => ({
  default: () => {
    return function MockClimbsMap(props: { onPinClick?: (key: string) => void }) {
      return (
        <button type="button" onClick={() => props.onPinClick?.("run-1")}> 
          Mock pin click
        </button>
      );
    };
  },
}));

describe("RoutesView", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          items: [
            {
              state: "CO",
              area: "Boulder",
              route: "Classic",
              climbCount: 1,
              lastClimbedLabel: "2026-07-01",
              lastClimbedTs: 1782864000000,
              lastClimbKey: "run-1",
              runType: "attempt",
              hasGps: true,
              coordinates: { lat: 40.015, lng: -105.27 },
            },
          ],
          total: 1,
        }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps map mode active when a map pin is selected", async () => {
    render(<RoutesView userId="user-1" />);

    const mapButton = screen.getByRole("button", { name: "Map" });
    const listButton = screen.getByRole("button", { name: "List" });

    expect(mapButton.getAttribute("aria-pressed")).toBe("true");
    expect(listButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Mock pin click" }));

    expect(mapButton.getAttribute("aria-pressed")).toBe("true");
    expect(listButton.getAttribute("aria-pressed")).toBe("false");
  });
});
