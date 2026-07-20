import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClimbsMap, { type ClimbPin } from "@/components/map/ClimbsMap";

const mocks = vi.hoisted(() => {
  const fitBounds = vi.fn();
  const setView = vi.fn();
  const addLayer = vi.fn();
  const on = vi.fn();
  const off = vi.fn();
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

  return { fitBounds, map, leaflet };
});

vi.mock("leaflet", () => ({
  default: mocks.leaflet,
}));

vi.mock("leaflet.markercluster", () => ({}));

vi.mock("@/utils/leaflet", () => ({
  initLeafletMap: vi.fn(async () => ({ L: mocks.leaflet, map: mocks.map })),
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
});
