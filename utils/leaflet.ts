import type { Map as LeafletMap, MapOptions, TileLayer, TileLayerOptions } from "leaflet";

type LeafletInitOptions = MapOptions & { tap?: boolean };
type LeafletHostElement = HTMLElement & {
  _leaflet_id?: number;
  __leafletMapInstance__?: LeafletMap;
};

// ---------------------------------------------------------------------------
// Shared Leaflet bootstrap — CartoDB Voyager tiles + attribution + the
// bundler default-icon CDN fallback, used by both ClimbsMap and MapPicker.
// Each component keeps its own unique logic (clustering, draggable marker).
// ---------------------------------------------------------------------------

/** CartoDB Voyager raster tiles ({r} → @2x on HiDPI displays). */
export const CARTO_TILE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Preferred outdoor style (MapTiler) used when `NEXT_PUBLIC_MAPTILER_KEY` exists. */
export const MAPTILER_OUTDOOR_TILE_URL =
  "https://api.maptiler.com/maps/outdoor-v2/{z}/{x}/{y}.png?key={key}";

export const MAPTILER_OUTDOOR_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>';

// `leaflet` has no ambient type for its default export shape we need here, and
// markercluster augments it at runtime — alias as a loose type for the bits we
// touch without leaking `any` to callers.
type LeafletModule = typeof import("leaflet");

interface BasemapConfig {
  id: "outdoor" | "fallback";
  url: string;
  options: TileLayerOptions;
}

function readPreferredOutdoorKey(): string | null {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() ?? "";
  return key.length > 0 ? key : null;
}

function preferredOutdoorConfig(key: string): BasemapConfig {
  return {
    id: "outdoor",
    url: MAPTILER_OUTDOOR_TILE_URL.replace("{key}", encodeURIComponent(key)),
    options: {
      attribution: MAPTILER_OUTDOOR_ATTRIBUTION,
      maxZoom: 19,
      detectRetina: true,
      keepBuffer: 4,
      updateWhenIdle: false,
    },
  };
}

function fallbackCartoConfig(): BasemapConfig {
  return {
    id: "fallback",
    url: CARTO_TILE_URL,
    options: {
      attribution: CARTO_ATTRIBUTION,
      subdomains: "abcd",
      maxZoom: 19,
      detectRetina: true,
      keepBuffer: 4,
      updateWhenIdle: false,
    },
  };
}

export function resolveBasemapSelection(): {
  preferred: BasemapConfig;
  fallback: BasemapConfig;
  hasPreferred: boolean;
} {
  const fallback = fallbackCartoConfig();
  const key = readPreferredOutdoorKey();
  if (!key) {
    return {
      preferred: fallback,
      fallback,
      hasPreferred: false,
    };
  }

  return {
    preferred: preferredOutdoorConfig(key),
    fallback,
    hasPreferred: true,
  };
}

function attachBasemapWithFallback(L: LeafletModule, map: LeafletMap): TileLayer {
  const { preferred, fallback, hasPreferred } = resolveBasemapSelection();
  const preferredLayer = L.tileLayer(preferred.url, preferred.options).addTo(map);

  if (!hasPreferred || preferred.url === fallback.url) {
    return preferredLayer;
  }

  let switched = false;
  const switchToFallback = () => {
    if (switched) return;
    switched = true;
    preferredLayer.off("tileerror", switchToFallback);
    map.removeLayer(preferredLayer);
    L.tileLayer(fallback.url, fallback.options).addTo(map);
  };

  preferredLayer.on("tileerror", switchToFallback);

  return preferredLayer;
}

/**
 * Fixes Leaflet's default marker icon path in webpack/bundler environments,
 * pointing it at the unpkg CDN. Idempotent and safe to call repeatedly.
 */
export function fixLeafletDefaultIcon(L: LeafletModule): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (L.Icon.Default.prototype as any)["_getIconUrl"];
  L.Icon.Default.mergeOptions({
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

/**
 * Dynamically imports Leaflet (keeping it out of the SSR bundle), clears any
 * stale `_leaflet_id` left on the container by a prior mount (React strict mode
 * / modal reopen), creates the map with `options`, and attaches a preferred
 * outdoor basemap with automatic fallback to CartoDB. Returns both the
 * Leaflet module and the map so callers can add their own layers/markers.
 */
export async function initLeafletMap(
  el: HTMLElement,
  options: LeafletInitOptions = {},
): Promise<{ L: LeafletModule; map: LeafletMap }> {
  const L = (await import("leaflet")).default;

  if (!el.isConnected) {
    throw new Error("Leaflet host detached before map init.");
  }

  fixLeafletDefaultIcon(L);

  const host = el as LeafletHostElement;

  // Fast refresh / strict-mode teardown races can leave a stale map attached
  // to the same host element. Remove it before creating a fresh instance.
  host.__leafletMapInstance__?.remove();
  host.__leafletMapInstance__ = undefined;

  if (host._leaflet_id) delete host._leaflet_id;
  if (host.firstChild) host.replaceChildren();

  const map = L.map(el, options);
  host.__leafletMapInstance__ = map;
  map.on("unload", () => {
    if (host.__leafletMapInstance__ === map) {
      host.__leafletMapInstance__ = undefined;
    }
  });

  attachBasemapWithFallback(L, map);

  return { L, map };
}
