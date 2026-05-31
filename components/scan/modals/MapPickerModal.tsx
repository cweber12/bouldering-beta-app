"use client";

import dynamic from "next/dynamic";
import { createPortal } from "react-dom";

const MapPicker = dynamic(() => import("@/components/map/MapPicker"), { ssr: false });

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface MapPickerModalProps {
  open: boolean;
  initialLat?: number;
  initialLng?: number;
  onConfirm: (lat: number, lng: number) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function MapPickerModal({
  open,
  initialLat,
  initialLng,
  onConfirm,
  onClose,
}: MapPickerModalProps) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/70 backdrop-blur-sm px-4 py-6">
      <div className="w-full max-w-2xl rounded-md border border-edge/50 bg-surface p-5 shadow-xl animate-scale-in">
        <h2 className="mb-3 text-sm font-semibold text-fg">Pick climb location on map</h2>
        <MapPicker
          initialLat={initialLat}
          initialLng={initialLng}
          onConfirm={onConfirm}
          onCancel={onClose}
        />
      </div>
    </div>,
    document.body,
  );
}
