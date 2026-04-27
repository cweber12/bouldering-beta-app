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

      // CSS-based custom marker — no CDN images required
      const pinIcon = L.divIcon({
        className: "",
        html: `<div style="width:22px;height:22px;background:var(--color-accent,#6366f1);border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.35);transform:translate(-50%,-50%);position:relative;left:50%;top:50%"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -14],
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

      // tap:false prevents Leaflet's own tap handler conflicting with drag on iOS
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = L.map(containerRef.current, { scrollWheelZoom: true, tap: false, dragging: true } as any);
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
        const marker = L.marker([initialLat, initialLng], { draggable: true, icon: pinIcon }).addTo(map);
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
          const marker = L.marker([lat, lng], { draggable: true, icon: pinIcon }).addTo(map);
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
      {/* Map container */}
      <div className="relative">
        <div
          ref={containerRef}
          className="h-95 w-full rounded-xl border border-edge overflow-hidden"
        />
        {/* Tap-to-place hint — shown until user places a pin */}
        {pickedLat == null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl">
            <div className="rounded-lg bg-surface/80 backdrop-blur-sm border border-edge/50 px-3 py-2 text-xs text-fg-secondary shadow-lg">
              Tap to place a pin
            </div>
          </div>
        )}
      </div>

      {/* Coordinates readout */}
      <div className="flex items-center justify-between min-h-6">
        {pickedLat != null && pickedLng != null ? (
          <span className="font-mono text-xs text-send bg-send-surface border border-send/30 rounded-lg px-2.5 py-1">
            {pickedLat.toFixed(5)},&nbsp;{pickedLng.toFixed(5)}
          </span>
        ) : (
          <span className="text-xs text-fg-muted">No location selected</span>
        )}
        <p className="text-xs text-fg-muted">Drag pin to adjust</p>
      </div>

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
