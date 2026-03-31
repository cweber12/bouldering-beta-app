"use client";

import { useCallback, useRef, useState } from "react";
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

export interface ImageCropperProps {
  /** Called with the cropped image as a JPEG data URL when the user confirms. */
  onCrop: (dataUrl: string) => void;
  /** Called when the user cancels without cropping. */
  onCancel: () => void;
  /** Max output size in pixels (applied to both width and height). Default 256. */
  maxOutputSize?: number;
}

function centerAspectCrop(mediaWidth: number, mediaHeight: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: "%", width: 90 }, 1, mediaWidth, mediaHeight),
    mediaWidth,
    mediaHeight,
  );
}

/**
 * An inline photo cropper that:
 * 1. Shows a file picker when no image is staged.
 * 2. Shows the crop UI (1:1 circle-masked) once an image is selected.
 * 3. Calls `onCrop` with a compressed JPEG data URL on confirm.
 */
export default function ImageCropper({
  onCrop,
  onCancel,
  maxOutputSize = 256,
}: ImageCropperProps) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const imgRef = useRef<HTMLImageElement>(null);

  // Load selected file into an object URL for preview.
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    setCrop(undefined);
    setCompletedCrop(undefined);
  }, []);

  // Set a default centered 1:1 crop once the image loads.
  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    setCrop(centerAspectCrop(w, h));
  }, []);

  // Render the crop to a canvas, compress and return as data URL.
  const handleConfirm = useCallback(() => {
    const img = imgRef.current;
    if (!img || !completedCrop) return;

    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;

    const srcX = completedCrop.x * scaleX;
    const srcY = completedCrop.y * scaleY;
    const srcW = completedCrop.width * scaleX;
    const srcH = completedCrop.height * scaleY;

    // Clamp output to maxOutputSize for both dimensions.
    const outSize = Math.min(maxOutputSize, Math.round(srcW), Math.round(srcH));

    const canvas = document.createElement("canvas");
    canvas.width = outSize;
    canvas.height = outSize;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outSize, outSize);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

    // Revoke the object URL we created.
    if (imgSrc) URL.revokeObjectURL(imgSrc);

    onCrop(dataUrl);
  }, [completedCrop, imgSrc, maxOutputSize, onCrop]);

  return (
    <div className="flex flex-col gap-4">
      {!imgSrc ? (
        /* ---- File picker ---- */
        <div className="flex flex-col items-center gap-3 py-4">
          <label className="cursor-pointer rounded-lg border border-edge bg-inset px-4 py-2 text-sm text-fg transition hover:border-accent hover:text-accent">
            Choose photo
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-fg-muted hover:text-fg-secondary"
          >
            Cancel
          </button>
        </div>
      ) : (
        /* ---- Crop UI ---- */
        <>
          {/* React-crop injects its styles; circular mask via CSS class */}
          <div className="overflow-hidden rounded-lg border border-edge bg-inset">
            <ReactCrop
              crop={crop}
              onChange={setCrop}
              onComplete={setCompletedCrop}
              aspect={1}
              circularCrop
              minWidth={40}
              minHeight={40}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={imgSrc}
                alt="Crop preview"
                onLoad={onImageLoad}
                style={{ maxHeight: "400px", maxWidth: "100%", display: "block" }}
              />
            </ReactCrop>
          </div>

          <p className="text-center text-xs text-fg-muted">
            Drag the circle to adjust your photo crop.
          </p>

          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!completedCrop}
              className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-surface transition hover:bg-accent-hover disabled:opacity-40"
            >
              Apply crop
            </button>
            <button
              type="button"
              onClick={() => {
                if (imgSrc) URL.revokeObjectURL(imgSrc);
                setImgSrc(null);
                onCancel();
              }}
              className="rounded-lg border border-edge px-5 py-2 text-sm text-fg-secondary transition hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
