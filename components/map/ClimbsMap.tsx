"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, MarkerClusterGroup } from "leaflet";
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

const TOPO_TILE_URL = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
const TOPO_ATTRIBUTION =
  'Map data © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
  '<a href="http://viewfinderpanoramas.org">SRTM</a> | ' +
  'Map style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)';

/** Build a custom SVG DivIcon for a climb pin. */
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
    className: "", // no default leaflet-div-icon styles
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
  });
}

/**
 * Renders a Leaflet map (OpenTopoMap tiles) with climb location pins.
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

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

      L.tileLayer(TOPO_TILE_URL, {
        attribution: TOPO_ATTRIBUTION,
        maxZoom: 17,
        opacity: 0.95,
      }).addTo(map);

      // MarkerClusterGroup is added to L by the side-effect import above.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cluster = (L as any).markerClusterGroup({
        maxClusterRadius: 60,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        animate: true,
      }) as MarkerClusterGroup;

      mapRef.current = map;
      clusterRef.current = cluster;
      map.addLayer(cluster);

      // Ensure tiles render fully (fixes partial tile issue on initial mount).
      setTimeout(() => { map.invalidateSize(); }, 100);
      setReady(true);
    })();

    return () => {
      aborted = true;
      mapRef.current?.remove();
      mapRef.current = null;
      clusterRef.current = null;
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
  return (
    <div
      ref={containerRef}
      style={{ height }}
      className={cn("w-full rounded-xl border border-edge overflow-hidden", className)}
    />
  );
}
