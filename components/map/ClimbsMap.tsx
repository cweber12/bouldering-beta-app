"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, MarkerClusterGroup, LayerGroup } from "leaflet";
import { cn } from "@/utils/cn";

// Leaflet CSS — imported once at the client component boundary.
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

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
  /** Tailwind / inline height (default 400 px). */
  height?: number;
  className?: string;
  /** Called when a pin is clicked (if the pin has a key). */
  onPinClick?: (key: string) => void;
}

const CARTO_TILE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Build a custom SVG DivIcon for a user's climb pin. */
function buildIcon(
  L: typeof import("leaflet"),
  runType: string,
): import("leaflet").DivIcon {
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
  return json.elements
    .reduce<OsmFeature[]>((acc, el) => {
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
 * Renders a Leaflet map (CartoDB Voyager tiles) with climb location pins.
 * Pins with identical coordinates are clustered.
 *
 * Must only be used via `next/dynamic` with `{ ssr: false }`.
 */
export default function ClimbsMap({
  pins,
  height = 400,
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

  const [ready, setReady] = useState(false);
  const [showCrags, setShowCrags] = useState(false);
  const [loadingCrags, setLoadingCrags] = useState(false);

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

  // Initialise the map (runs once after mount).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let aborted = false;
    // Declared outside the IIFE so the cleanup closure can disconnect it.
    let resizeObs: ResizeObserver | null = null;

    (async () => {
      // Dynamic imports keep Leaflet out of the SSR bundle.
      const L = (await import("leaflet")).default;
      await import("leaflet.markercluster");
      if (aborted) return;

      // Fix Leaflet's default icon path in webpack/bundler environments.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)["_getIconUrl"];
      L.Icon.Default.mergeOptions({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (!containerRef.current || aborted) return;

      // Guard against container already having a Leaflet map (HMR / strict mode).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((containerRef.current as any)._leaflet_id) return;

      const map = L.map(containerRef.current, {
        scrollWheelZoom: true,
        zoomControl: true,
      });

      L.tileLayer(CARTO_TILE_URL, {
        attribution: CARTO_ATTRIBUTION,
        subdomains: "abcd",
        maxZoom: 19,
        detectRetina: true,    // substitute {r} → @2x on HiDPI displays
        keepBuffer: 4,         // pre-load 4-tile buffer to reduce blank squares
        updateWhenIdle: false, // stream tiles during pan, not only after settle
      }).addTo(map);

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
        if (mapRef.current) mapRef.current.invalidateSize();
      });
      resizeObs.observe(containerRef.current);

      setReady(true);
    })();

    return () => {
      aborted = true;
      resizeObs?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      clusterRef.current = null;
      osmLayerRef.current = null;
    };
  }, []);

  // Sync markers when pins or readiness changes.
  useEffect(() => {
    if (!ready || !mapRef.current || !clusterRef.current) return;

    (async () => {
      const L = (await import("leaflet")).default;
      const cluster = clusterRef.current!;
      cluster.clearLayers();
      const latLngs: [number, number][] = [];

      for (const [, group] of grouped) {
        const { lat, lng } = group[0];
        latLngs.push([lat, lng]);

        const icon = buildIcon(L, group.some((p) => p.runType === "send") ? "send" : "attempt");

        const popupRows = group
          .map((p) => {
            const typeLabel = p.runType === "send" ? "✓ Send" : "Attempt";
            const ts = p.timestamp ? `<br/><span style="color:var(--color-fg-muted);font-size:11px">${p.timestamp}</span>` : "";
            const clickable = p.key && onPinClick ? " style=\"cursor:pointer;text-decoration:underline\"" : "";
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

      // Fit the map to show all pins with some padding.
      if (latLngs.length > 0) {
        mapRef.current!.fitBounds(latLngs, { padding: [32, 32], maxZoom: 14 });
      } else {
        // Default view: North America
        mapRef.current!.setView([39, -98], 4);
      }
    })();
  }, [ready, grouped, onPinClick]);

  // ── OSM crags overlay ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!ready || !mapRef.current || !osmLayerRef.current) return;
    const map = mapRef.current;
    const osmLayer = osmLayerRef.current;

    if (!showCrags) {
      osmLayer.clearLayers();
      lastBoundsKeyRef.current = null;
      return;
    }

    const queryVisible = async () => {
      if (!mapRef.current) return;
      const zoom = map.getZoom();
      if (zoom < MIN_ZOOM_CRAGS) {
        osmLayer.clearLayers();
        return;
      }
      const b = map.getBounds();
      // Round bounds to 1 decimal degree (~11 km) — skip if we're within the
      // same approximate area as the last successful query.
      const key = `${b.getSouth().toFixed(1)},${b.getWest().toFixed(1)},${b.getNorth().toFixed(1)},${b.getEast().toFixed(1)}`;
      if (key === lastBoundsKeyRef.current) return;
      lastBoundsKeyRef.current = key;

      setLoadingCrags(true);
      try {
        const L = (await import("leaflet")).default;
        const features = await fetchOsmClimbing(
          b.getSouth(), b.getWest(), b.getNorth(), b.getEast(),
        );
        if (!mapRef.current) return; // unmounted while fetching
        osmLayer.clearLayers();
        const icon = buildOsmIcon(L);
        for (const f of features) {
          const typeLabel =
            f.featureType === "gym" ? "🏋 Climbing gym"
            : f.featureType === "area" ? "🏔 Climbing area"
            : f.featureType === "crag" ? "🪨 Crag"
            : f.featureType === "boulder" ? "🪨 Boulder"
            : "⛰ Climbing site";
          const websiteRow = f.website
            ? `<br/><a href="${f.website}" target="_blank" rel="noopener noreferrer" style="color:var(--color-accent);font-size:11px">Website ↗</a>`
            : "";
          const popup = `<div style="font-size:13px;line-height:1.5;color:var(--color-fg);max-width:200px"><strong>${f.name}</strong><br/><span style="color:var(--color-fg-muted);font-size:11px">${typeLabel}</span>${websiteRow}</div>`;
          L.marker([f.lat, f.lng], { icon }).bindPopup(popup).addTo(osmLayer);
        }
      } catch {
        // Overpass request failed — silently skip, don't clear existing markers.
        lastBoundsKeyRef.current = null;
      } finally {
        setLoadingCrags(false);
      }
    };

    const onMoveEnd = () => {
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
      // Debounce: wait 600ms after the last pan/zoom before querying.
      moveTimerRef.current = setTimeout(queryVisible, 600);
    };

    map.on("moveend", onMoveEnd);
    // Fire immediately for the current viewport.
    queryVisible();

    return () => {
      map.off("moveend", onMoveEnd);
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
    };
  }, [ready, showCrags]);

  return (
    // Outer wrapper is position:relative so we can overlay React controls (toggle
    // button, loading indicator) above the Leaflet canvas without being clipped.
    <div className="relative w-full" style={{ height }}>
      {/* Leaflet map canvas */}
      <div
        ref={containerRef}
        className={cn("absolute inset-0 rounded-xl border border-edge overflow-hidden", className)}
      />

      {/* Nearby crags toggle — positioned top-right, z-index above Leaflet controls */}
      {ready && (
        <div className="absolute top-2 right-2 z-[400] flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCrags((s) => !s)}
            title={showCrags ? "Hide nearby climbing areas" : "Show nearby climbing areas from OpenStreetMap"}
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
              <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l5-9 4 6 3-4 5 7H3z" />
              </svg>
            )}
            Nearby crags
          </button>
        </div>
      )}

      {/* Zoom-too-low hint shown when crags are toggled on but zoom < MIN_ZOOM_CRAGS */}
      {ready && showCrags && mapRef.current && mapRef.current.getZoom() < MIN_ZOOM_CRAGS && (
        <div className="absolute bottom-2 left-1/2 z-[400] -translate-x-1/2 rounded-lg bg-surface/90 px-3 py-1.5 text-xs text-fg-muted shadow backdrop-blur-sm">
          Zoom in to see nearby crags
        </div>
      )}
    </div>
  );
}
