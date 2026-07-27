import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClimbEndSweeper, { type ClimbEndRunItem } from "@/components/dev/ClimbEndSweeper";
import { planClimbEndSweep } from "@/utils/harnessClimbWindow";

function stubMedia(duration: number) {
  let time = 0;
  Object.defineProperty(HTMLMediaElement.prototype, "duration", {
    configurable: true,
    get: () => duration,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get: () => time,
    set: (v: number) => {
      time = v;
    },
  });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
}

/** Corpus rows as the sweep sees them — the plan reads `hasSetup`, the run item
 *  the rest. */
type Row = ClimbEndRunItem & { hasSetup: boolean };

const QUEUE: Row[] = [
  { key: "route-a/v1", routeFolder: "route-a", videoKey: "v1", climbStart: 1.2, hasSetup: true },
  { key: "route-b/v2", routeFolder: "route-b", videoKey: "v2", climbStart: 0.5, hasSetup: true },
];

/** Record every setup PUT so the off-hash, climbEnd-only body can be asserted. */
function stubFetch() {
  const puts: { key: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/dev/corpus/video")) {
        return { ok: true, blob: async () => new Blob(["video"]) } as unknown as Response;
      }
      const body = JSON.parse(String(init?.body)) as { climbEnd: number | null };
      puts.push({ key: new URL(url, "http://x").searchParams.get("key")!, body });
      return { ok: true, json: async () => ({ setup: { climbEnd: body.climbEnd } }) } as
        unknown as Response;
    }),
  );

  // One distinct object URL per bundle, so a stale <video> is never mistaken for
  // the next bundle's (and so the editor genuinely remounts between them).
  let n = 0;
  if (!URL.createObjectURL) URL.createObjectURL = () => "";
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:v${(n += 1)}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return puts;
}

/** Wait for the named bundle's video to mount, then drive it to `loadeddata`. */
async function openVideo(container: HTMLElement, src: string) {
  const video = await waitFor(() => {
    const el = container.querySelector("video");
    if (!el || el.getAttribute("src") !== src) throw new Error(`waiting for ${src}`);
    return el;
  });
  fireEvent.loadedData(video);
  return video;
}

describe("ClimbEndSweeper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes a climbEnd-only body and advances to the next Bundle", async () => {
    stubMedia(10);
    const puts = stubFetch();
    const onSaved = vi.fn();
    const { container } = render(
      <ClimbEndSweeper plan={planClimbEndSweep(QUEUE)} onBack={vi.fn()} onSaved={onSaved} />,
    );

    expect(screen.getByText("Bundle 1 of 2 · 0 marked")).toBeTruthy();
    await openVideo(container, "blob:v1");
    fireEvent.click(screen.getByRole("button", { name: /Set climb end — 0:10\.0/ }));

    // A climbEnd-only body is what leaves setupHash untouched server-side; a
    // fuller body would re-hash the Setup and mark every prior run stale.
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ key: "route-a/v1", body: { climbEnd: 10 } });
    expect(onSaved).toHaveBeenCalled();
    await screen.findByText("Bundle 2 of 2 · 1 marked");
  });

  it("skips without writing, leaving the window open exactly as today", async () => {
    stubMedia(10);
    const puts = stubFetch();
    const { container } = render(
      <ClimbEndSweeper plan={planClimbEndSweep(QUEUE)} onBack={vi.fn()} onSaved={vi.fn()} />,
    );

    await openVideo(container, "blob:v1");
    fireEvent.click(screen.getByRole("button", { name: "Skip →" }));

    await screen.findByText("Bundle 2 of 2 · 0 marked");
    expect(puts).toHaveLength(0);
  });

  it("summarizes what was marked and what was left unmarked when the queue runs out", async () => {
    stubMedia(10);
    stubFetch();
    const { container } = render(
      <ClimbEndSweeper plan={planClimbEndSweep(QUEUE)} onBack={vi.fn()} onSaved={vi.fn()} />,
    );

    await openVideo(container, "blob:v1");
    fireEvent.click(screen.getByRole("button", { name: "Skip →" }));
    await openVideo(container, "blob:v2");
    fireEvent.click(screen.getByRole("button", { name: "Skip →" }));

    await screen.findByText(/Done — 0 marked, 2 cleared or skipped, 0 left unmarked/);
    expect(screen.getAllByText("skipped")).toHaveLength(2);
  });

  it("says so plainly when every set-up Bundle already carries a marker", () => {
    stubFetch();
    render(
      <ClimbEndSweeper
        plan={planClimbEndSweep([{ ...QUEUE[0], climbEnd: 12 }])}
        onBack={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Every Bundle with a Scan Setup already carries an end-of-climb marker."),
    ).toBeTruthy();
  });
});
