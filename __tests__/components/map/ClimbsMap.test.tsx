import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClimbsMap, { type ClimbPin } from "@/components/map/ClimbsMap";

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const mocks = vi.hoisted(() => {
  type MapBounds = { south: number; west: number; north: number; east: number };

  let zoom = 10;
  let bounds: MapBounds = { south: 39, west: -106, north: 41, east: -104 };
  const eventHandlers = new Map<string, Set<() => void>>();

  const trigger = (event: string) => {
    for (const cb of eventHandlers.get(event) ?? []) cb();
  };
  const setZoom = (next: number) => {
    zoom = next;
  };
  const setBounds = (next: MapBounds) => {
    bounds = next;
  };

  const fitBounds = vi.fn();
  const setView = vi.fn();
  const addLayer = vi.fn();
  const on = vi.fn((event: string, handler: () => void) => {
    const set = eventHandlers.get(event) ?? new Set<() => void>();
    set.add(handler);
    eventHandlers.set(event, set);
  });
  const off = vi.fn((event: string, handler: () => void) => {
    eventHandlers.get(event)?.delete(handler);
  });
  const draggingEnable = vi.fn();
  const invalidateSize = vi.fn();
  const remove = vi.fn();
  const clearLayers = vi.fn();
  const osmClearLayers = vi.fn();

  const cluster = {
    clearLayers,
  };

  const map = {
    addLayer,
    fitBounds,
    setView,
    on,
    off,
    dragging: { enable: draggingEnable },
    getZoom: vi.fn(() => zoom),
    getBounds: vi.fn(() => ({
      getSouth: () => bounds.south,
      getWest: () => bounds.west,
      getNorth: () => bounds.north,
      getEast: () => bounds.east,
    })),
    invalidateSize,
    remove,
  };

  const leaflet = {
    divIcon: vi.fn(() => ({})),
    markerClusterGroup: vi.fn(() => cluster),
    layerGroup: vi.fn(() => ({ clearLayers: osmClearLayers })),
    marker: vi.fn(() => {
      const markerObj = {
        bindPopup: vi.fn(() => markerObj),
        on: vi.fn(() => markerObj),
        addTo: vi.fn(() => markerObj),
        getPopup: vi.fn(() => null),
      };
      return markerObj;
    }),
  };

  const initLeafletMap = vi.fn(async () => ({ L: leaflet, map }));

  return {
    fitBounds,
    map,
    leaflet,
    initLeafletMap,
    draggingEnable,
    osmClearLayers,
    setZoom,
    setBounds,
    trigger,
  };
});

vi.mock("leaflet", () => ({
  default: mocks.leaflet,
}));

vi.mock("leaflet.markercluster", () => ({}));

vi.mock("@/utils/leaflet", () => ({
  initLeafletMap: mocks.initLeafletMap,
}));

describe("ClimbsMap", () => {
  beforeEach(() => {
    mocks.setZoom(10);
    mocks.setBounds({ south: 39, west: -106, north: 41, east: -104 });

    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("gates queries by zoom and avoids redundant fetches for equivalent bounds", async () => {
    mocks.setZoom(8);

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ elements: [{ id: 1, lat: 40, lon: -105, tags: { name: "Flatiron" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ClimbsMap pins={[]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Nearby crags" }));

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(screen.queryByText("Zoom in to see nearby crags")).toBeTruthy();

    mocks.setZoom(10);
    act(() => {
      mocks.trigger("zoomend");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    mocks.setBounds({ south: 39.04, west: -106.02, north: 41.03, east: -104.01 });
    act(() => {
      mocks.trigger("moveend");
    });
    await waitMs(700);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    mocks.setBounds({ south: 38.7, west: -106.3, north: 40.7, east: -104.3 });
    act(() => {
      mocks.trigger("moveend");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("hides below threshold and re-renders from cache on zoom re-entry", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ elements: [{ id: 2, lat: 39.5, lon: -105.5, tags: { climbing: "crag" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ClimbsMap pins={[]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Nearby crags" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Issuing the fetch is not rendering its features. Both counters below are
    // baselines for "did the *next* query happen", so they have to be read after
    // the first one has finished moving them.
    await waitFor(() => expect(mocks.leaflet.marker.mock.calls.length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    const markersAfterFirstQuery = mocks.leaflet.marker.mock.calls.length;
    const clearsAfterFirstQuery = mocks.osmClearLayers.mock.calls.length;

    mocks.setZoom(8);
    act(() => {
      mocks.trigger("zoomend");
    });

    // Both re-queries sit behind the 600 ms move debounce and an async query
    // after it, so a fixed sleep is racing real time with ~100 ms of margin —
    // under load it loses, and the step reads the state from before the debounce
    // fired. Wait for the outcome each step is about instead.
    //
    // That outcome is the zoom-out query having run, which is what drops the
    // bounds key and lets re-entry re-render at all. Neither the hint nor a bare
    // "the layer was cleared" says so: `zoomend` puts the hint on screen a full
    // debounce early, and rendering the first query's own features already
    // cleared the layer once — hence the count rather than the call.
    await waitFor(
      () => expect(mocks.osmClearLayers.mock.calls.length).toBeGreaterThan(clearsAfterFirstQuery),
      { timeout: 3000 },
    );
    expect(screen.queryByText("Zoom in to see nearby crags")).toBeTruthy();

    mocks.setZoom(10);
    act(() => {
      mocks.trigger("zoomend");
    });

    await waitFor(
      () => expect(mocks.leaflet.marker.mock.calls.length).toBeGreaterThan(markersAfterFirstQuery),
      { timeout: 3000 },
    );
    // Asserted after the re-render, so it covers the whole settle window: the
    // markers came back without the network being touched again.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("auto-fits only on first load and true pin-set changes", async () => {
    const firstPins: ClimbPin[] = [
      {
        lat: 40.015,
        lng: -105.27,
        label: "Classic",
        runType: "attempt",
        key: "run-1",
      },
    ];

    const { rerender } = render(<ClimbsMap pins={firstPins} onPinClick={() => {}} />);

    await waitFor(() => expect(mocks.fitBounds).toHaveBeenCalledTimes(1));

    rerender(<ClimbsMap pins={firstPins} onPinClick={() => undefined} />);

    await waitFor(() => expect(mocks.fitBounds).toHaveBeenCalledTimes(1));

    rerender(
      <ClimbsMap
        pins={[
          {
            lat: 40.02,
            lng: -105.26,
            label: "Second",
            runType: "send",
            key: "run-2",
          },
        ]}
        onPinClick={() => undefined}
      />,
    );

    await waitFor(() => expect(mocks.fitBounds).toHaveBeenCalledTimes(2));
  });

  it("enables drag-pan interaction in map init options", async () => {
    render(<ClimbsMap pins={[]} />);

    await waitFor(() => expect(mocks.initLeafletMap).toHaveBeenCalled());

    expect(mocks.initLeafletMap).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        scrollWheelZoom: true,
        dragging: true,
        tap: false,
        zoomControl: true,
      }),
    );

    expect(mocks.draggingEnable).toHaveBeenCalledTimes(1);
  });
});
