import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LandingReplay from "@/components/skeleton/LandingReplay";
import type { LandingReplayItem } from "@/pipeline/overlay/landingReplayItem";

// ---------------------------------------------------------------------------
// The canvas is a no-op here (the global setup stubs getContext to null), so
// these cover the hero's chrome and its degradation path: the public caption,
// the single pause/play control, reduced-motion behaviour, and rendering
// nothing at all when the asset is absent or malformed.
// ---------------------------------------------------------------------------

const ITEM: LandingReplayItem = {
  id: "run-1750000000-slab-master",
  label: { area: "Rocktown", route: "Slab Master", rating: "V4" },
  source: { w: 1080, h: 1920 },
  photo: { w: 1200, h: 1600, webp: "data:image/webp;base64,AA==" },
  starfield: [{ x: 0.2, y: 0.3 }],
  matches: [{ sx: 0.2, sy: 0.3, px: 0.25, py: 0.35 }],
  poses: [
    {
      t: 0,
      source: [{ n: "left_wrist", x: 0.4, y: 0.3, s: 0.9 }],
      photo: [{ n: "left_wrist", x: 0.5, y: 0.4, s: 0.9 }],
    },
    {
      t: 8,
      source: [{ n: "left_wrist", x: 0.5, y: 0.2, s: 0.9 }],
      photo: [{ n: "left_wrist", x: 0.6, y: 0.3, s: 0.9 }],
    },
  ],
  holds: [{ x: 0.5, y: 0.4, kind: "hand", side: "left", t: 1.2 }],
};

let reducedMotion: boolean;

/** Serve `payload` from the playlist fetch. `null` = a failed request. */
function stubPlaylist(payload: unknown | null): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      payload === null
        ? ({ ok: false, json: async () => null } as Response)
        : ({ ok: true, json: async () => payload } as Response),
    ),
  );
}

beforeEach(() => {
  reducedMotion = false;
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") && reducedMotion,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LandingReplay", () => {
  it("plays the first item of the checked-in playlist", async () => {
    stubPlaylist({ version: 1, items: [ITEM] });
    render(<LandingReplay />);

    await waitFor(() => expect(screen.getByText("Slab Master")).toBeTruthy());
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "/landing-replay.json",
    );
  });

  it("captions the clip with area, route and rating only", async () => {
    stubPlaylist({ version: 1, items: [ITEM] });
    const { container } = render(<LandingReplay />);

    await waitFor(() => expect(screen.getByText("Slab Master")).toBeTruthy());
    expect(screen.getByText("Rocktown")).toBeTruthy();
    expect(screen.getByText("V4")).toBeTruthy();
    expect(container.querySelector("figcaption")?.textContent).not.toContain(ITEM.id);
  });

  it("offers one pause/play control that is a real, labelled button", async () => {
    stubPlaylist({ version: 1, items: [ITEM] });
    render(<LandingReplay />);

    const button = await screen.findByLabelText("Pause replay");
    expect(button.tagName).toBe("BUTTON");
    expect(screen.getAllByRole("button")).toHaveLength(1);

    act(() => {
      button.click();
    });
    expect(screen.getByLabelText("Play replay")).toBeTruthy();

    act(() => {
      screen.getByLabelText("Play replay").click();
    });
    expect(screen.getByLabelText("Pause replay")).toBeTruthy();
  });

  it("starts paused on the static final frame under reduced motion", async () => {
    reducedMotion = true;
    stubPlaylist({ version: 1, items: [ITEM] });
    render(<LandingReplay />);

    // Paused until explicit play — the control offers Play, not Pause.
    expect(await screen.findByLabelText("Play replay")).toBeTruthy();
  });

  it("renders nothing when the asset is missing", async () => {
    stubPlaylist(null);
    const { container } = render(<LandingReplay />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.querySelector("figure")).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("renders nothing when the fetch itself rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const { container } = render(<LandingReplay />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.querySelector("figure")).toBeNull();
  });

  it("renders nothing when a hand-edited item fails the guard", async () => {
    stubPlaylist({ version: 1, items: [{ ...ITEM, poses: [] }] });
    const { container } = render(<LandingReplay />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.querySelector("figure")).toBeNull();
  });

  it("renders nothing when the playlist is empty", async () => {
    stubPlaylist({ version: 1, items: [] });
    const { container } = render(<LandingReplay />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.querySelector("figure")).toBeNull();
  });
});
