import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClimbsMap, { type ClimbPin } from "@/components/map/ClimbsMap";

const mocks = vi.hoisted(() => {
  const fitBounds = vi.fn();
  const setView = vi.fn();
  const addLayer = vi.fn();
  const on = vi.fn();
  const off = vi.fn();
  const draggingEnable = vi.fn();
  const invalidateSize = vi.fn();
  const remove = vi.fn();
  const clearLayers = vi.fn();

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
    getZoom: vi.fn(() => 10),
    getBounds: vi.fn(() => ({
      getSouth: () => 39,
      getWest: () => -106,
      getNorth: () => 41,
      getEast: () => -104,
    })),
    invalidateSize,
    remove,
  };

  const leaflet = {
    divIcon: vi.fn(() => ({})),
    markerClusterGroup: vi.fn(() => cluster),
    layerGroup: vi.fn(() => ({ clearLayers: vi.fn() })),
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

  return { fitBounds, map, leaflet, initLeafletMap, draggingEnable };
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
