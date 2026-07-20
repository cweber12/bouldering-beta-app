import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CARTO_TILE_URL,
  initLeafletMap,
  MAPTILER_OUTDOOR_TILE_URL,
  resolveBasemapSelection,
} from "@/utils/leaflet";

interface MockTileLayer {
  addTo: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: (event: string) => void;
}

interface MockMap {
  on: ReturnType<typeof vi.fn>;
  removeLayer: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => {
  const tileLayerRecords: Array<{ url: string; layer: MockTileLayer }> = [];

  const map: MockMap = {
    on: vi.fn(),
    removeLayer: vi.fn(),
  };

  const makeTileLayer = (): MockTileLayer => {
    const handlers = new Map<string, Array<() => void>>();
    const layer: MockTileLayer = {
      addTo: vi.fn(() => layer),
      on: vi.fn((event: string, cb: () => void) => {
        const list = handlers.get(event) ?? [];
        list.push(cb);
        handlers.set(event, list);
        return layer;
      }),
      off: vi.fn((event: string, cb: () => void) => {
        const list = handlers.get(event) ?? [];
        handlers.set(
          event,
          list.filter((candidate) => candidate !== cb),
        );
        return layer;
      }),
      emit: (event: string) => {
        const list = handlers.get(event) ?? [];
        for (const handler of list) handler();
      },
    };
    return layer;
  };

  const tileLayer = vi.fn((url: string) => {
    const layer = makeTileLayer();
    tileLayerRecords.push({ url, layer });
    return layer;
  });

  const mapFactory = vi.fn(() => map);

  const leaflet = {
    Icon: {
      Default: {
        prototype: {
          _getIconUrl: "mock-url",
        },
        mergeOptions: vi.fn(),
      },
    },
    map: mapFactory,
    tileLayer,
  };

  return {
    map,
    leaflet,
    tileLayerRecords,
    tileLayer,
    mapFactory,
  };
});

vi.mock("leaflet", () => ({
  default: mocks.leaflet,
}));

describe("leaflet basemap fallback", () => {
  const originalMapTilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;

  beforeEach(() => {
    mocks.tileLayerRecords.length = 0;
    mocks.tileLayer.mockClear();
    mocks.mapFactory.mockClear();
    mocks.map.on.mockClear();
    mocks.map.removeLayer.mockClear();
  });

  afterEach(() => {
    if (originalMapTilerKey == null) {
      delete process.env.NEXT_PUBLIC_MAPTILER_KEY;
    } else {
      process.env.NEXT_PUBLIC_MAPTILER_KEY = originalMapTilerKey;
    }
    document.body.innerHTML = "";
  });

  it("uses fallback tiles when preferred provider key is missing", async () => {
    delete process.env.NEXT_PUBLIC_MAPTILER_KEY;

    const host = document.createElement("div");
    document.body.appendChild(host);

    await initLeafletMap(host, { center: [39, -98], zoom: 4 });

    expect(mocks.tileLayerRecords).toHaveLength(1);
    expect(mocks.tileLayerRecords[0].url).toBe(CARTO_TILE_URL);
    expect(mocks.map.removeLayer).not.toHaveBeenCalled();
  });

  it("falls back to Carto when preferred provider emits tileerror", async () => {
    process.env.NEXT_PUBLIC_MAPTILER_KEY = "demo-outdoor-key";

    const host = document.createElement("div");
    document.body.appendChild(host);

    await initLeafletMap(host, { center: [39, -98], zoom: 4 });

    expect(mocks.tileLayerRecords).toHaveLength(1);
    const expectedOutdoorUrl = MAPTILER_OUTDOOR_TILE_URL.replace(
      "{key}",
      encodeURIComponent("demo-outdoor-key"),
    );
    expect(mocks.tileLayerRecords[0].url).toBe(expectedOutdoorUrl);

    const preferredLayer = mocks.tileLayerRecords[0].layer;
    preferredLayer.emit("tileerror");

    expect(mocks.tileLayerRecords).toHaveLength(2);
    expect(mocks.tileLayerRecords[1].url).toBe(CARTO_TILE_URL);
    expect(mocks.map.removeLayer).toHaveBeenCalledTimes(1);
    expect(mocks.map.removeLayer).toHaveBeenCalledWith(preferredLayer);
  });

  it("resolves preferred state from provider configuration", () => {
    delete process.env.NEXT_PUBLIC_MAPTILER_KEY;
    const withoutKey = resolveBasemapSelection();
    expect(withoutKey.hasPreferred).toBe(false);

    process.env.NEXT_PUBLIC_MAPTILER_KEY = "configured-key";
    const withKey = resolveBasemapSelection();
    expect(withKey.hasPreferred).toBe(true);
    expect(withKey.preferred.id).toBe("outdoor");
  });
});
