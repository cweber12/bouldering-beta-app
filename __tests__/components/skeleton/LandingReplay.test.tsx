import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LandingReplay from "@/components/skeleton/LandingReplay";
import { drawHolds } from "@/pipeline/holds/holdsOverlay";
import type { LandingReplayItem } from "@/pipeline/overlay/landingReplayItem";

vi.mock("@/pipeline/holds/holdsOverlay", () => ({ drawHolds: vi.fn() }));

// ---------------------------------------------------------------------------
// The canvas is a no-op by default (the global setup stubs getContext to null),
// so most of these cover the hero's chrome and its degradation path: the public
// caption, the single pause/play control, reduced-motion behaviour, playlist
// cycling as driven by the real replay clock, and rendering nothing at all when
// the asset is absent or malformed. The two compositing tests swap in a recording
// context (see below) to check the handoff's layer blits.
// ---------------------------------------------------------------------------

const ITEM: LandingReplayItem = {
  id: "run-1750000000-slab-master",
  label: { area: "Rocktown", route: "Slab Master", rating: "V4" },
  duration: 14,
  source: { w: 1080, h: 1920 },
  photo: { w: 1200, h: 1600, webp: "data:image/webp;base64,AA==" },
  starfield: [{ x: 0.2, y: 0.3 }],
  matches: [{ sx: 0.2, sy: 0.3, px: 0.25, py: 0.35 }],
  poses: [
    {
      t: 0,
      source: [[15, 0.4, 0.3, 0.9]],
      photo: [[15, 0.5, 0.4, 0.9]],
    },
    {
      t: 14,
      source: [[15, 0.5, 0.2, 0.9]],
      photo: [[15, 0.6, 0.3, 0.9]],
    },
  ],
  holds: [{ x: 0.5, y: 0.4, kind: "hand", side: "left", t: 1.2 }],
};

/** A second/third clip, distinguishable by caption. */
function itemNamed(id: string, route: string): LandingReplayItem {
  return { ...ITEM, id, label: { ...ITEM.label, route } };
}

/** The same clip, authored with the optional video-space wall still. */
function itemWithStill(item: LandingReplayItem, webp: string): LandingReplayItem {
  return { ...item, source: { ...item.source, webp } };
}

const CLIP_MS = 12_000; // screen time per item (REPLAY_ANIMATION_SECONDS)
const HANDOFF_MS = 300;

let reducedMotion: boolean;
let rafCallbacks: Map<number, FrameRequestCallback>;
let rafId: number;
let clockNow: number;

/**
 * Run the pending animation frames at `now + ms`. The clock accumulates frame
 * deltas, so the first call after mounting only anchors the baseline; every call
 * after that advances replay time by exactly `ms`. Cancelled frames really are
 * cancelled here, so a paused clock cannot be advanced by a stale callback.
 */
function advance(ms: number): void {
  clockNow += ms;
  act(() => {
    const due = [...rafCallbacks.values()];
    rafCallbacks.clear();
    for (const cb of due) cb(clockNow);
  });
}

/** The route name currently captioned. */
function captionedRoute(container: HTMLElement): string {
  return container.querySelector("figcaption span")?.textContent ?? "";
}

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
  rafCallbacks = new Map();
  rafId = 0;
  clockNow = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCallbacks.set(++rafId, cb);
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafCallbacks.delete(id);
  });
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
  HTMLCanvasElement.prototype.getContext = nullContext;
});

// ---------------------------------------------------------------------------
// Recording 2D context — the global setup returns null from getContext, which is
// what keeps most of these tests to the chrome. The compositing tests swap in a
// context that answers every 2D call and records the blits, so the crossfade path
// (each clip drawn whole into one offscreen layer, then composited at its own
// alpha) is checked rather than skipped.
// ---------------------------------------------------------------------------

/** The suite-wide stub, restored after any test that replaces it. */
const nullContext = HTMLCanvasElement.prototype.getContext;

interface Blit {
  source: unknown;
  alpha: number;
}

/** Blits recorded against each canvas's own context. */
type BlitLog = WeakMap<HTMLCanvasElement, Blit[]>;

function stubRecordingContexts(): BlitLog {
  const log: BlitLog = new WeakMap();
  const contexts = new WeakMap<HTMLCanvasElement, unknown>();

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const existing = contexts.get(this);
    if (existing) return existing as CanvasRenderingContext2D;

    const blits: Blit[] = [];
    log.set(this, blits);
    const state: Record<string | symbol, unknown> = { globalAlpha: 1 };
    const ctx = new Proxy(state, {
      get(target, prop) {
        if (prop === "drawImage") {
          return (source: unknown) =>
            blits.push({ source, alpha: target.globalAlpha as number });
        }
        if (prop in target) return target[prop];
        return () => {}; // every other 2D call is a no-op here
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    });
    contexts.set(this, ctx);
    return ctx as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement["getContext"];

  return log;
}

// ---------------------------------------------------------------------------
// Deferred decode — an Image stub that stays pending until the test loads it,
// which is what makes "the later clips have not decoded yet" a state the hero
// can actually be observed rendering in. jsdom never loads images anyway; the
// stub adds the request order and a way to settle one clip's pair at a time.
// ---------------------------------------------------------------------------

/** Images requested by the decode chain, in request order. */
let requested: PendingImage[];

class PendingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private value = "";

  get src(): string {
    return this.value;
  }

  set src(next: string) {
    this.value = next;
    requested.push(this);
  }
}

/** Serve pending images and start recording request order. */
function stubPendingImages(): void {
  requested = [];
  vi.stubGlobal("Image", PendingImage);
}

/** Load the given images and let the chain publish them. */
async function loadImages(images: readonly PendingImage[]): Promise<void> {
  await act(async () => {
    for (const img of images) img.onload?.();
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

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

  it("stretches to its container instead of shrink-wrapping the caption", async () => {
    stubPlaylist({ version: 1, items: [ITEM] });
    const { container } = render(<LandingReplay />);
    await waitFor(() => expect(screen.getByText("Slab Master")).toBeTruthy());

    // A class assertion rather than a layout one, because jsdom computes no
    // layout — but this is the exact regression: the figure sits in a
    // `flex flex-col items-center` parent, so without an explicit width it
    // shrink-to-fits and the stage's own `w-full` resolves against the caption's
    // text width, rendering the hero at a fraction of its column.
    expect(container.querySelector("figure")?.className).toContain("w-full");
  });

  it("draws no Holds — they are a secondary feature the hero leaves out", async () => {
    stubPlaylist({ version: 1, items: [ITEM] });
    render(<LandingReplay />);
    await waitFor(() => expect(screen.getByText("Slab Master")).toBeTruthy());

    advance(0);
    advance(CLIP_MS * 0.9); // deep into phase 4, where Holds used to be revealed
    expect(drawHolds).not.toHaveBeenCalled();
  });

  it("shapes the stage from the first item's source plane, not a fixed portrait", async () => {
    const landscape: LandingReplayItem = { ...ITEM, source: { w: 1280, h: 720 } };
    stubPlaylist({ version: 1, items: [landscape] });
    const { container } = render(<LandingReplay />);
    await waitFor(() => expect(screen.getByText("Slab Master")).toBeTruthy());

    // Landscape footage must not letterbox into a portrait box; the stage follows it.
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.width / canvas.height).toBeCloseTo(1280 / 720, 2);
    expect(Math.max(canvas.width, canvas.height)).toBe(900);
  });

  it("holds one stage shape across a playlist of mixed aspects", async () => {
    stubPlaylist({
      version: 1,
      items: [
        { ...ITEM, source: { w: 1280, h: 720 } },
        { ...itemNamed("clip-b", "Crimp Ladder"), source: { w: 1080, h: 1920 } },
      ],
    });
    const { container } = render(<LandingReplay />);
    await waitFor(() => expect(screen.getByText("Slab Master")).toBeTruthy());
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    const before = { w: canvas.width, h: canvas.height };

    advance(0);
    advance(CLIP_MS + HANDOFF_MS); // hand off to the portrait item
    expect(captionedRoute(container)).toBe("Crimp Ladder");

    // The handoff must not reflow the layout, whatever the incoming item's shape.
    expect({ w: canvas.width, h: canvas.height }).toEqual(before);
  });

  it("cycles the playlist in file order and wraps to the first item", async () => {
    stubPlaylist({
      version: 1,
      items: [ITEM, itemNamed("clip-b", "Crimp Ladder"), itemNamed("clip-c", "Sloper Traverse")],
    });
    const { container } = render(<LandingReplay />);
    await waitFor(() => expect(screen.getByText("Slab Master")).toBeTruthy());

    advance(0); // anchor the clock's frame delta
    expect(captionedRoute(container)).toBe("Slab Master");

    // A slot boundary hands off; the first item holds its finished overlay until
    // the crossfade completes.
    advance(CLIP_MS);
    expect(captionedRoute(container)).toBe("Slab Master");
    advance(HANDOFF_MS);
    expect(captionedRoute(container)).toBe("Crimp Ladder");

    advance(CLIP_MS);
    expect(captionedRoute(container)).toBe("Sloper Traverse");

    // …and back to the top of the file, indefinitely.
    advance(CLIP_MS);
    expect(captionedRoute(container)).toBe("Slab Master");
    advance(CLIP_MS);
    expect(captionedRoute(container)).toBe("Crimp Ladder");
  });

  it("hands off across the crossfade rather than cutting", async () => {
    stubPlaylist({ version: 1, items: [ITEM, itemNamed("clip-b", "Crimp Ladder")] });
    const { container } = render(<LandingReplay />);
    await waitFor(() => expect(screen.getByText("Slab Master")).toBeTruthy());

    advance(0);
    // A third of the way through the handoff the outgoing clip is still dominant.
    advance(CLIP_MS + HANDOFF_MS / 3);
    expect(captionedRoute(container)).toBe("Slab Master");
    // Two thirds through, the incoming one is.
    advance(HANDOFF_MS / 3);
    expect(captionedRoute(container)).toBe("Crimp Ladder");
  });

  it("freezes the cycling while paused, then resumes from the same point", async () => {
    stubPlaylist({ version: 1, items: [ITEM, itemNamed("clip-b", "Crimp Ladder")] });
    const { container } = render(<LandingReplay />);
    await waitFor(() => expect(screen.getByText("Slab Master")).toBeTruthy());

    advance(0);
    advance(CLIP_MS - 1000);

    act(() => {
      screen.getByLabelText("Pause replay").click();
    });
    advance(60_000); // wall-clock time passes; replay time must not
    expect(captionedRoute(container)).toBe("Slab Master");

    act(() => {
      screen.getByLabelText("Play replay").click();
    });
    advance(0); // re-anchor after the resume — this must not replay the gap
    expect(captionedRoute(container)).toBe("Slab Master");
    advance(1000 + HANDOFF_MS); // the remaining second of the clip, then the handoff
    expect(captionedRoute(container)).toBe("Crimp Ladder");
  });

  it("plays only the first five items of an over-long playlist", async () => {
    const items = Array.from({ length: 7 }, (_, i) => itemNamed(`clip-${i}`, `Route ${i}`));
    stubPlaylist({ version: 1, items });
    const { container } = render(<LandingReplay />);
    await waitFor(() => expect(screen.getByText("Route 0")).toBeTruthy());

    advance(0);
    advance(4 * CLIP_MS + HANDOFF_MS);
    expect(captionedRoute(container)).toBe("Route 4");
    advance(CLIP_MS); // the sixth slot is the first item again, not "Route 5"
    expect(captionedRoute(container)).toBe("Route 0");
  });

  it("composites the handoff as two whole clips at complementary alphas", async () => {
    const blits = stubRecordingContexts();
    stubPlaylist({ version: 1, items: [ITEM, itemNamed("clip-b", "Crimp Ladder")] });
    const { container } = render(<LandingReplay />);
    await waitFor(() => expect(screen.getByText("Slab Master")).toBeTruthy());
    const stage = container.querySelector("canvas") as HTMLCanvasElement;

    advance(0);
    const mark = (blits.get(stage) ?? []).length; // ignore the frames drawn so far
    advance(CLIP_MS + HANDOFF_MS / 2);

    // Both clips are drawn into the same reused offscreen layer and composited
    // at their own alpha, so neither one's internal phase alphas are disturbed.
    const composited = (blits.get(stage) ?? []).slice(mark);
    expect(composited).toHaveLength(2);
    expect(composited[0].source).toBe(composited[1].source);
    expect(composited[0].source).not.toBe(stage);
    expect(composited[0].alpha).toBeCloseTo(0.5, 6);
    expect(composited[0].alpha + composited[1].alpha).toBeCloseTo(1, 6);
  });

  it("draws straight to the stage once a single clip owns it again", async () => {
    const blits = stubRecordingContexts();
    stubPlaylist({ version: 1, items: [ITEM, itemNamed("clip-b", "Crimp Ladder")] });
    const { container } = render(<LandingReplay />);
    await waitFor(() => expect(screen.getByText("Slab Master")).toBeTruthy());
    const stage = container.querySelector("canvas") as HTMLCanvasElement;

    advance(0);
    advance(CLIP_MS + HANDOFF_MS / 2); // mid-handoff: learn the layer canvas
    const layer = (blits.get(stage) ?? []).at(-1)?.source;
    expect(layer).toBeTruthy();

    const mark = (blits.get(stage) ?? []).length;
    advance(CLIP_MS / 2); // well clear of the next handoff
    const after = (blits.get(stage) ?? []).slice(mark);

    // The layer composite is a handoff-only cost: the clip now paints at the
    // stage itself, and only its own internal blits (the motion wake) remain.
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((b) => b.source === layer)).toBe(false);
  });

  it("opens on the first clip while the later ones are still undecoded", async () => {
    const blits = stubRecordingContexts();
    stubPendingImages();
    const first = itemWithStill(ITEM, "still-a");
    stubPlaylist({
      version: 1,
      items: [
        first,
        itemWithStill(itemNamed("clip-b", "Crimp Ladder"), "still-b"),
        itemWithStill(itemNamed("clip-c", "Sloper Traverse"), "still-c"),
      ],
    });
    const { container } = render(<LandingReplay />);
    await waitFor(() => expect(screen.getByText("Slab Master")).toBeTruthy());

    // Only the clip that is about to play has been asked for. The four images
    // belonging to clips twelve and twenty-four seconds out are not competing
    // with the two that gate the opening frame.
    expect(requested.map((img) => img.src)).toEqual([first.photo.webp, "still-a"]);

    // …and the hero is already up and painting with all three still pending.
    const stage = container.querySelector("canvas") as HTMLCanvasElement;
    advance(0);
    advance(CLIP_MS * 0.05);
    expect(captionedRoute(container)).toBe("Slab Master");

    // Those opening frames ran against the dark stage — the still is drawn only
    // once it is decoded, and its absence is not what holds the hero up.
    const opening = [...requested];
    const still = opening.find((img) => img.src === "still-a");
    expect((blits.get(stage) ?? []).some((b) => b.source === still)).toBe(false);

    // Item 0's pair lands; its wall still reaches the stage while items 1 and 2
    // are still undecoded, and only then does the next clip's decode start.
    await loadImages(opening);
    const mark = (blits.get(stage) ?? []).length;
    advance(CLIP_MS * 0.05);

    expect((blits.get(stage) ?? []).slice(mark).some((b) => b.source === still)).toBe(true);
    expect(requested.slice(2).map((img) => img.src)).toEqual([ITEM.photo.webp, "still-b"]);
  });

  it("keeps the pause control keyboard reachable and operable", async () => {
    stubPlaylist({ version: 1, items: [ITEM] });
    render(<LandingReplay />);
    const button = await screen.findByLabelText("Pause replay");

    await userEvent.tab();
    expect(document.activeElement).toBe(button);

    await userEvent.keyboard("{Enter}");
    expect(screen.getByLabelText("Play replay")).toBeTruthy();
    await userEvent.keyboard(" ");
    expect(screen.getByLabelText("Pause replay")).toBeTruthy();
  });

  it("renders nothing when the playlist is empty", async () => {
    stubPlaylist({ version: 1, items: [] });
    const { container } = render(<LandingReplay />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.querySelector("figure")).toBeNull();
  });
});
