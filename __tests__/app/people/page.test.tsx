import { fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PeoplePage from "@/app/people/page";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { uid: "self-user" },
    loading: false,
  }),
}));

function response(json: unknown, ok = true) {
  return {
    ok,
    json: async () => json,
  };
}

describe("PeoplePage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "setTimeout",
      ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
        if (typeof handler === "function") {
          handler(...args);
        }
        return 0 as unknown as number;
      }) as typeof setTimeout,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("searches for climbers and links to their public profile", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/profile/search?q=al") {
        return response({
          results: [
            {
              userId: "climber-1",
              displayName: "Alice",
              location: "Boulder, CO",
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<PeoplePage />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/find climbers/i), { target: { value: "al" } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Boulder, CO")).toBeTruthy();
    expect(screen.getByRole("link", { name: /alice/i }).getAttribute("href")).toBe(
      "/profile/climber-1",
    );
  });
});
