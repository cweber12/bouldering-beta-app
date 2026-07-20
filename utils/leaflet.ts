import type { Map as LeafletMap, MapOptions } from "leaflet";

type LeafletInitOptions = MapOptions & { tap?: boolean };

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

// `leaflet` has no ambient type for its default export shape we need here, and
// markercluster augments it at runtime — alias as a loose type for the bits we
// touch without leaking `any` to callers.
type LeafletModule = typeof import("leaflet");

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
 * / modal reopen), creates the map with `options`, and attaches the CartoDB
 * Voyager tile layer. Returns both the Leaflet module and the map so callers
 * can add their own layers/markers.
 */
export async function initLeafletMap(
  el: HTMLElement,
  options: LeafletInitOptions = {},
): Promise<{ L: LeafletModule; map: LeafletMap }> {
  const L = (await import("leaflet")).default;

  fixLeafletDefaultIcon(L);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyEl = el as any;
  if (anyEl._leaflet_id) delete anyEl._leaflet_id;

  const map = L.map(el, options);

  L.tileLayer(CARTO_TILE_URL, {
    attribution: CARTO_ATTRIBUTION,
    subdomains: "abcd",
    maxZoom: 19,
    detectRetina: true, // substitute {r} → @2x on HiDPI displays
    keepBuffer: 4, // pre-load a 4-tile buffer to reduce blank squares
    updateWhenIdle: false, // stream tiles during pan, not only after settle
  }).addTo(map);

  return { L, map };
}
