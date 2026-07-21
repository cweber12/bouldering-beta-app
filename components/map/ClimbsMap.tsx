"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, MarkerClusterGroup, LayerGroup } from "leaflet";
import { cn } from "@/utils/cn";
import { initLeafletMap } from "@/utils/leaflet";

// Leaflet CSS — imported once at the client component boundary.
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

function safelyRemoveMap(map: LeafletMap): void {
  try {
    map.remove();
  } catch {
    // Ignore teardown races from stale async initializers in strict mode.
  }
}

export interface ClimbPin {
  lat: number;
  lng: number;
  /** Display name shown in the popup (route / area). */
  label: string;
  /** "attempt" | "send" — drives marker colour. */
  runType: string;
  /** Optional timestamp label. */
  timestamp?: string;
  /** S3 key for the climb JSON — used for click navigation. */
  key?: string;
}

export interface ClimbsMapProps {
  pins: ClimbPin[];
  /** Tailwind / inline height (default 400 px). Ignored when `fill` is set. */
  height?: number;
  /** Fill the parent's height (h-full) instead of using a fixed pixel height. */
  fill?: boolean;
  className?: string;
  /** Called when a pin is clicked (if the pin has a key). */
  onPinClick?: (key: string) => void;
}

/** Build a custom SVG DivIcon for a user's climb pin. */
function buildIcon(L: typeof import("leaflet"), runType: string): import("leaflet").DivIcon {
  const colour = runType === "send" ? "#10b981" : "#f59e0b"; // emerald / amber
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
    <path d="M14 0C6.27 0 0 6.27 0 14c0 9.63 14 22 14 22S28 23.63 28 14C28 6.27 21.73 0 14 0z" fill="${colour}"/>
    <circle cx="14" cy="14" r="7" fill="white" fill-opacity="0.9"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
  });
}

/** Build a distinct DivIcon for OSM climbing features (crags, areas, gyms). */
function buildOsmIcon(L: typeof import("leaflet")): import("leaflet").DivIcon {
  // Indigo circle with a white mountain triangle — visually distinct from user pins.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
    <circle cx="13" cy="13" r="12" fill="#6366f1" stroke="white" stroke-width="1.5"/>
    <path d="M6 19L13 6L20 19Z" fill="white" opacity="0.95"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
}

// ── Overpass API integration ────────────────────────────────────────────────

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
/** Minimum zoom level before issuing a crag query — prevents huge bbox requests. */
const MIN_ZOOM_CRAGS = 9;

interface OsmFeature {
  id: number;
  lat: number;
  lng: number;
  name: string;
  featureType: "gym" | "crag" | "area" | "boulder" | "other";
  website?: string;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function osmFeatureType(tags: Record<string, string>): OsmFeature["featureType"] {
  if (tags.leisure === "sports_centre" || tags.building) return "gym";
  if (tags.climbing === "area") return "area";
  if (tags.climbing === "crag") return "crag";
  if (tags.climbing === "boulder") return "boulder";
  return "other";
}

function roundedBoundsKey(bounds: import("leaflet").LatLngBounds): string {
  return `${bounds.getSouth().toFixed(1)},${bounds.getWest().toFixed(1)},${bounds.getNorth().toFixed(1)},${bounds.getEast().toFixed(1)}`;
}

function renderOsmFeatures(
  L: typeof import("leaflet"),
  osmLayer: LayerGroup,
  features: OsmFeature[],
): void {
  osmLayer.clearLayers();
  const icon = buildOsmIcon(L);
  for (const f of features) {
    const typeLabel =
      f.featureType === "gym"
        ? "🏋 Climbing gym"
        : f.featureType === "area"
          ? "🏔 Climbing area"
          : f.featureType === "crag"
            ? "🪨 Crag"
            : f.featureType === "boulder"
              ? "🪨 Boulder"
              : "⛰ Climbing site";
    const websiteRow = f.website
      ? `<br/><a href="${f.website}" target="_blank" rel="noopener noreferrer" style="color:var(--color-accent);font-size:11px">Website ↗</a>`
      : "";
    const popup = `<div style="font-size:13px;line-height:1.5;color:var(--color-fg);max-width:200px"><strong>${f.name}</strong><br/><span style="color:var(--color-fg-muted);font-size:11px">${typeLabel}</span>${websiteRow}</div>`;
    L.marker([f.lat, f.lng], { icon }).bindPopup(popup).addTo(osmLayer);
  }
}

async function fetchOsmClimbing(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OsmFeature[]> {
  // nwr = node+way+relation; out center returns centroids for ways/relations.
  const q = `[out:json][timeout:15];nwr["sport"="climbing"](${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)});out center;`;
  const res = await fetch(`${OVERPASS_URL}?data=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const json = (await res.json()) as { elements: OverpassElement[] };
  return json.elements.reduce<OsmFeature[]>((acc, el) => {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!lat || !lon) return acc;
    acc.push({
      id: el.id,
      lat,
      lng: lon,
      name: el.tags?.name ?? "Climbing site",
      featureType: osmFeatureType(el.tags ?? {}),
      website: el.tags?.website ?? el.tags?.url,
    });
    return acc;
  }, []);
}

/**
 * Renders a Leaflet map (outdoor contour basemap) with climb location pins.
 * Pins with identical coordinates are clustered.
 *
 * Must only be used via `next/dynamic` with `{ ssr: false }`.
 */
export default function ClimbsMap({
  pins,
  height = 400,
  fill = false,
  className = "",
  onPinClick,
}: ClimbsMapProps) {
  const mapRef = useRef<LeafletMap | null>(null);
  const clusterRef = useRef<MarkerClusterGroup | null>(null);
  const osmLayerRef = useRef<LayerGroup | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Debounce timer for Overpass queries triggered by map movement.
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bounds key of the last successful Overpass query (skip repeat fetches).
  const lastBoundsKeyRef = useRef<string | null>(null);
  // Cache OSM features by rounded bounds key to avoid repeat network churn.
  const osmCacheRef = useRef<Map<string, OsmFeature[]>>(new Map());
  // Deduplicate concurrent requests for the same key while panning/zooming.
  const inFlightRef = useRef<Map<string, Promise<OsmFeature[]>>>(new Map());
  // Most recent requested key; stale responses must not replace newer viewport data.
  const latestQueryKeyRef = useRef<string | null>(null);
  // Pin-set signature of the last viewport auto-fit.
  const lastFitSignatureRef = useRef<string | null>(null);
  // Guards async init so stale effects can't steal/reuse the same container.
  const initTokenRef = useRef(0);
  const initInFlightRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [showCrags, setShowCrags] = useState(false);
  const [loadingCrags, setLoadingCrags] = useState(false);
  const [mapZoom, setMapZoom] = useState<number>(4);

  // Group pins by location so the popup can list all climbs at a spot.
  const grouped = useMemo(() => {
    const map = new Map<string, ClimbPin[]>();
    for (const pin of pins) {
      const key = `${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(pin);
    }
    return map;
  }, [pins]);

  // Order-insensitive signature for pin identity/location. Used to ensure
  // viewport auto-fit only runs on first load and true pin-set changes.
  const pinSetSignature = useMemo(() => {
    const entries = Array.from(grouped.values()).map((group) => {
      const { lat, lng } = group[0];
      const ids = group
        .map((pin) => pin.key ?? `${pin.label}:${pin.runType}`)
        .sort()
        .join("|");
      return `${lat.toFixed(5)},${lng.toFixed(5)}:${ids}`;
    });
    entries.sort();
    return entries.join(";");
  }, [grouped]);

  // Initialise the map (runs once after mount).
  useEffect(() => {
    if (!containerRef.current || mapRef.current || initInFlightRef.current) return;

    let aborted = false;
    let mapInstance: LeafletMap | null = null;
    const initToken = ++initTokenRef.current;
    initInFlightRef.current = true;
    let initTimer: ReturnType<typeof setTimeout> | null = null;
    // Declared outside the IIFE so the cleanup closure can disconnect it.
    let resizeObs: ResizeObserver | null = null;

    initTimer = setTimeout(() => {
      void (async () => {
        try {
          if (!containerRef.current) {
            initInFlightRef.current = false;
            return;
          }
          // Outdoor basemap + icon fix live in the shared util; clustering stays here.
          // A default center/zoom must be set at creation: Leaflet throws
          // "Set map center and zoom first" when layers are added (and dragging is
          // attempted) before the map has a view. The marker-sync effect below
          // overrides this with fitBounds once pins are known.
          const { L, map } = await initLeafletMap(containerRef.current, {
            scrollWheelZoom: true,
            // Explicitly enable drag-pan across desktop and touch devices.
            dragging: true,
            // Disable Leaflet's tap handler to avoid touch drag conflicts.
            tap: false,
            zoomControl: true,
            center: [39, -98], // North America fallback
            zoom: 4,
          });

          // Some browser/driver combinations ignore drag intent in init options.
          // Re-enable at runtime to guarantee click-drag pan stays available.
          map.dragging?.enable();
          mapInstance = map;

          if (aborted || initToken !== initTokenRef.current) {
            safelyRemoveMap(map);
            initInFlightRef.current = false;
            return;
          }

          // markercluster augments L (side-effect import); keep it out of SSR.
          await import("leaflet.markercluster");
          if (aborted || initToken !== initTokenRef.current) {
            safelyRemoveMap(map);
            initInFlightRef.current = false;
            return;
          }

          // MarkerClusterGroup is added to L by the side-effect import above.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cluster = (L as any).markerClusterGroup({
            maxClusterRadius: 60,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            animate: true,
          }) as MarkerClusterGroup;

          // Separate layer group for the OSM crags overlay (not clustered).
          const osmLayer = L.layerGroup();

          mapRef.current = map;
          clusterRef.current = cluster;
          osmLayerRef.current = osmLayer;
          map.addLayer(cluster);
          map.addLayer(osmLayer);

          // ResizeObserver replaces the unreliable setTimeout(invalidateSize, 100).
          // It fires whenever the container's pixel dimensions change — including
          // when the parent transitions from display:none to visible — ensuring
          // tiles are re-requested at the correct container size.
          resizeObs = new ResizeObserver(() => {
            map.invalidateSize();
          });
          resizeObs.observe(containerRef.current);

          setReady(true);
          initInFlightRef.current = false;
        } catch {
          // Detached-host races in strict mode are non-fatal; a fresh mount
          // immediately retries with a connected container.
          initInFlightRef.current = false;
        }
      })();
    }, 0);

    return () => {
      aborted = true;
      if (initTimer) clearTimeout(initTimer);
      resizeObs?.disconnect();
      if (mapInstance) {
        safelyRemoveMap(mapInstance);
        if (mapRef.current === mapInstance) {
          mapRef.current = null;
          clusterRef.current = null;
          osmLayerRef.current = null;
          setReady(false);
        }
      }
      initInFlightRef.current = false;
    };
  }, []);

  // Sync markers when pins or readiness changes.
  useEffect(() => {
    if (!ready || !mapRef.current || !clusterRef.current) return;

    (async () => {
      const L = (await import("leaflet")).default;
      const cluster = clusterRef.current;
      const map = mapRef.current;
      if (!cluster || !map) return;
      cluster.clearLayers();
      const latLngs: [number, number][] = [];

      for (const [, group] of grouped) {
        const { lat, lng } = group[0];
        latLngs.push([lat, lng]);

        const icon = buildIcon(L, group.some((p) => p.runType === "send") ? "send" : "attempt");

        const popupRows = group
          .map((p) => {
            const typeLabel = p.runType === "send" ? "✓ Send" : "Attempt";
            const ts = p.timestamp
              ? `<br/><span style="color:var(--color-fg-muted);font-size:11px">${p.timestamp}</span>`
              : "";
            const clickable =
              p.key && onPinClick ? ' style="cursor:pointer;text-decoration:underline"' : "";
            return `<div style="margin-bottom:4px"><strong${clickable} data-climb-key="${p.key ?? ""}">${p.label}</strong> — ${typeLabel}${ts}</div>`;
          })
          .join("");

        const popupContent = `<div style="font-size:13px;line-height:1.5;max-width:220px;color:var(--color-fg)">${popupRows}</div>`;

        const marker = L.marker([lat, lng], { icon }).bindPopup(popupContent);

        // If there's exactly one climb at this location and it has a key,
        // clicking the marker opens the detail view directly.
        if (group.length === 1 && group[0].key && onPinClick) {
          const climbKey = group[0].key;
          marker.on("click", () => onPinClick(climbKey));
        } else if (onPinClick) {
          // For grouped pins, attach click on popup content links.
          marker.on("popupopen", () => {
            const popup = marker.getPopup();
            if (!popup) return;
            const container = popup.getElement();
            if (!container) return;
            container.querySelectorAll("[data-climb-key]").forEach((el) => {
              const key = el.getAttribute("data-climb-key");
              if (key) {
                (el as HTMLElement).addEventListener("click", () => onPinClick(key));
              }
            });
          });
        }

        marker.addTo(cluster);
      }

      const shouldAutoFit = lastFitSignatureRef.current !== pinSetSignature;

      if (shouldAutoFit) {
        // Fit the map only on first load and true pin-set changes.
        if (latLngs.length > 0) {
          map.fitBounds(latLngs, { padding: [32, 32], maxZoom: 14 });
        } else {
          // Default view: North America
          map.setView([39, -98], 4);
        }
        lastFitSignatureRef.current = pinSetSignature;
      }
    })();
  }, [ready, grouped, onPinClick, pinSetSignature]);

  // ── OSM crags overlay ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!ready || !mapRef.current || !osmLayerRef.current) return;
    const map = mapRef.current;
    const osmLayer = osmLayerRef.current;

    if (!showCrags) {
      osmLayer.clearLayers();
      lastBoundsKeyRef.current = null;
      latestQueryKeyRef.current = null;
      setLoadingCrags(false);
      return;
    }

    const queryVisible = async () => {
      if (!mapRef.current) return;
      const zoom = map.getZoom();
      setMapZoom(zoom);
      if (zoom < MIN_ZOOM_CRAGS) {
        osmLayer.clearLayers();
        lastBoundsKeyRef.current = null;
        latestQueryKeyRef.current = null;
        setLoadingCrags(false);
        return;
      }
      const b = map.getBounds();
      // Equivalent local pan/zoom reuses data and avoids repeat Overpass churn.
      const key = roundedBoundsKey(b);
      if (key === lastBoundsKeyRef.current) return;
      lastBoundsKeyRef.current = key;
      latestQueryKeyRef.current = key;

      const cached = osmCacheRef.current.get(key);
      if (cached) {
        const L = (await import("leaflet")).default;
        if (!mapRef.current || latestQueryKeyRef.current !== key) return;
        renderOsmFeatures(L, osmLayer, cached);
        return;
      }

      setLoadingCrags(true);
      try {
        const L = (await import("leaflet")).default;
        let req = inFlightRef.current.get(key);
        if (!req) {
          req = fetchOsmClimbing(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()).finally(
            () => {
              inFlightRef.current.delete(key);
            },
          );
          inFlightRef.current.set(key, req);
        }
        const features = await req;
        if (!mapRef.current || latestQueryKeyRef.current !== key) return;
        osmCacheRef.current.set(key, features);
        renderOsmFeatures(L, osmLayer, features);
      } catch {
        // Overpass request failed — silently skip, don't clear existing markers.
        lastBoundsKeyRef.current = null;
      } finally {
        if (latestQueryKeyRef.current === key) {
          setLoadingCrags(false);
        }
      }
    };

    const scheduleQuery = () => {
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
      // Debounce: wait 600ms after the last pan/zoom before querying.
      moveTimerRef.current = setTimeout(queryVisible, 600);
    };

    const onMoveEnd = () => {
      scheduleQuery();
    };

    const onZoomEnd = () => {
      setMapZoom(map.getZoom());
      scheduleQuery();
    };

    map.on("moveend", onMoveEnd);
    map.on("zoomend", onZoomEnd);
    // Fire immediately for the current viewport.
    setMapZoom(map.getZoom());
    queryVisible();

    return () => {
      map.off("moveend", onMoveEnd);
      map.off("zoomend", onZoomEnd);
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
    };
  }, [ready, showCrags]);

  return (
    // Outer wrapper is position:relative so we can overlay React controls (toggle
    // button, loading indicator) above the Leaflet canvas without being clipped.
    <div className={cn("relative w-full", fill && "h-full")} style={fill ? undefined : { height }}>
      {/* Leaflet map canvas */}
      <div
        ref={containerRef}
        className={cn("absolute inset-0 rounded-xl border border-edge overflow-hidden", className)}
      />

      {/* Nearby crags toggle — positioned top-right, z-index above Leaflet controls */}
      {ready && (
        <div className="absolute top-2 right-2 z-400 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCrags((s) => !s)}
            title={
              showCrags
                ? "Hide nearby climbing areas"
                : "Show nearby climbing areas from OpenStreetMap"
            }
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium shadow-md transition",
              "border bg-surface/90 backdrop-blur-sm",
              showCrags
                ? "border-accent/60 text-accent"
                : "border-edge text-fg-secondary hover:border-edge-hover hover:text-fg",
            )}
          >
            {loadingCrags ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-fg-muted border-t-accent" />
            ) : (
              <svg
                className="h-3.5 w-3.5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l5-9 4 6 3-4 5 7H3z" />
              </svg>
            )}
            Nearby crags
          </button>
        </div>
      )}

      {/* Zoom-too-low hint shown when crags are toggled on but zoom < MIN_ZOOM_CRAGS */}
      {ready && showCrags && mapZoom < MIN_ZOOM_CRAGS && (
        <div className="absolute bottom-2 left-1/2 z-400 -translate-x-1/2 rounded-lg bg-surface/90 px-3 py-1.5 text-xs text-fg-muted shadow backdrop-blur-sm">
          Zoom in to see nearby crags
        </div>
      )}
    </div>
  );
}
