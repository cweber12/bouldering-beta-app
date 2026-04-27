"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPickerProps {
  /** Initial position for the pin. If not set, defaults to North America centre. */
  initialLat?: number;
  initialLng?: number;
  onConfirm: (lat: number, lng: number) => void;
  onCancel: () => void;
}

const CARTO_TILE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Full-screen-ish map that lets the user click to place a pin.
 * On confirm, calls `onConfirm` with the selected lat/lng.
 *
 * Must be used via `next/dynamic` with `{ ssr: false }`.
 */
export default function MapPicker({
  initialLat,
  initialLng,
  onConfirm,
  onCancel,
}: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const [pickedLat, setPickedLat] = useState(initialLat ?? null);
  const [pickedLng, setPickedLng] = useState(initialLng ?? null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    (async () => {
      const L = (await import("leaflet")).default;

      // Fix default icon paths.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)["_getIconUrl"];
      L.Icon.Default.mergeOptions({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (!containerRef.current) return;

      // Clear stale Leaflet state from a previous mount (React strict mode
      // or modal close → reopen). Without this, L.map() throws
      // "Map container is already initialized".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const el = containerRef.current as any;
      if (el._leaflet_id) {
        delete el._leaflet_id;
      }

      const initLat = initialLat ?? 39;
      const initLng = initialLng ?? -98;
      const initZoom = initialLat != null ? 13 : 4;

      const map = L.map(containerRef.current, { scrollWheelZoom: true });
      map.setView([initLat, initLng], initZoom);

      L.tileLayer(CARTO_TILE_URL, {
        attribution: CARTO_ATTRIBUTION,
        subdomains: "abcd",
        maxZoom: 19,
        detectRetina: true,
        keepBuffer: 4,
        updateWhenIdle: false,
      }).addTo(map);

      // Place initial marker if coords provided.
      if (initialLat != null && initialLng != null) {
        const marker = L.marker([initialLat, initialLng], { draggable: true }).addTo(map);
        marker.on("dragend", () => {
          const pos = marker.getLatLng();
          setPickedLat(pos.lat);
          setPickedLng(pos.lng);
        });
        markerRef.current = marker;
      }

      // Click on map → move/place marker.
      map.on("click", (e) => {
        const { lat, lng } = e.latlng;
        setPickedLat(lat);
        setPickedLng(lng);
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
          marker.on("dragend", () => {
            const pos = marker.getLatLng();
            setPickedLat(pos.lat);
            setPickedLng(pos.lng);
          });
          markerRef.current = marker;
        }
      });

      mapRef.current = map;
    })();

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Map is initialised once — re-init on coord change would destroy user state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirm = useCallback(() => {
    if (pickedLat != null && pickedLng != null) {
      onConfirm(pickedLat, pickedLng);
    }
  }, [pickedLat, pickedLng, onConfirm]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg-muted">
        Click on the map to place a pin at the climb location. Drag the pin to adjust.
      </p>
      <div
        ref={containerRef}
        className="h-[380px] w-full rounded-xl border border-edge overflow-hidden"
      />
      {pickedLat != null && pickedLng != null && (
        <p className="text-xs text-fg-muted text-center">
          {pickedLat.toFixed(5)}, {pickedLng.toFixed(5)}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-edge px-4 py-1.5 text-sm text-fg-secondary transition hover:text-fg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pickedLat == null}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-surface transition hover:bg-accent-hover disabled:opacity-40"
        >
          Use this location
        </button>
      </div>
    </div>
  );
}
