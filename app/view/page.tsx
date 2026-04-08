"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import LoadingGate from "@/components/shared/LoadingGate";
import StepMatchRoutePhoto from "@/components/scan/StepMatchRoutePhoto";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { useSkeletonFrames } from "@/hooks/useSkeletonFrames";
import { useS3Storage } from "@/hooks/useS3Storage";
import { saveAttempt, getAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { SkeletonStyle } from "@/pipeline/skeletonOverlay";
import { getTopology } from "@/utils/poseConstants";
import { sanitizeDirName } from "@/utils/fsHelpers";
import { compressImageToDataUrl, dataUrlToFile } from "@/utils/imageHelpers";
import { renderPoseVideo } from "@/pipeline/poseVideoRenderer";
import type { CropFraction } from "@/components/shared/CropBoxOverlay";

// ---------------------------------------------------------------------------
// Inner component (needs useSearchParams)
// ---------------------------------------------------------------------------

function ViewPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const urlClimbKey = params.get("key") ?? "";

  const { cv } = useOpenCV();
  const { userPrefix, downloadAttempt: s3Download } = useS3Storage();
  const { matchImage, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();

  // Climb loading
  const [attempt, setAttempt] = useState<RouteAttempt | null>(null);
  const [attemptId, setAttemptId] = useState("");
  const [climbLoading, setClimbLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Route image loading
  const [imageChecked, setImageChecked] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const imagePreviewUrlRef = useRef<string | null>(null);
  const [userPickedImage, setUserPickedImage] = useState(false);
  const routeImageConvertingRef = useRef(false);

  const [imageCrop, setImageCrop] = useState<CropFraction>({ x: 0, y: 0, w: 1, h: 1 });
  const [matchTriggered, setMatchTriggered] = useState(false);

  const [skeletonStyle, setSkeletonStyle] = useState<SkeletonStyle>({
    lineWidth: 2.5,
    pointRadius: 5,
  });

  const topoStyle: SkeletonStyle = useMemo(() => {
    const backend = attempt?.poseBackend ?? "mediapipe";
    const topo = getTopology(backend);
    return { ...skeletonStyle, skeletonEdges: topo.skeletonEdges, keypointNames: topo.keypointNames };
  }, [skeletonStyle, attempt]);

  const { data: skeletonData, status: frameStatus, errorMessage: frameError } =
    useSkeletonFrames(cv, attemptId || null, matchResult);

  const [exportStatus, setExportStatus] = useState<"idle" | "rendering" | "done">("idle");
  const [exportProgress, setExportProgress] = useState(0);
  const styleRef = useRef(topoStyle);
  useEffect(() => { styleRef.current = topoStyle; }, [topoStyle]);

  // Revoke object URL on unmount
  useEffect(() => {
    return () => {
      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    };
  }, []);

  // Load climb from S3 via ?key= param
  useEffect(() => {
    if (!urlClimbKey) {
      setLoadError("No climb key provided.");
      setClimbLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const loaded = await s3Download(urlClimbKey);
        if (cancelled) return;
        saveAttempt(loaded);
        setAttemptId(loaded.id);
        setAttempt(loaded);
      } catch (err) {
        if (!cancelled) setLoadError("Failed to load climb from S3.");
        console.error("[ViewPage]", err);
      } finally {
        if (!cancelled) setClimbLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlClimbKey]);

  // Auto-load route image from S3 when climb + userPrefix are both ready
  useEffect(() => {
    if (!attempt || !userPrefix || userPickedImage) {
      if (attempt) setImageChecked(true); // no point fetching if user already picked
      return;
    }
    const key = `${userPrefix}/${sanitizeDirName(attempt.state || "Unknown")}/${sanitizeDirName(attempt.area || "Unknown")}/${sanitizeDirName(attempt.route || "Unknown")}/route-image.json`;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/s3/get?key=${encodeURIComponent(key)}`);
        if (cancelled) return;
        if (res.ok) {
          const raw = (await res.json()) as Record<string, unknown>;
          if (cancelled) return;
          const dataUrl = typeof raw.dataUrl === "string" ? raw.dataUrl : null;
          const savedCrop = (raw.cropBox && typeof raw.cropBox === "object")
            ? raw.cropBox as CropFraction
            : null;
          if (dataUrl && !routeImageConvertingRef.current) {
            routeImageConvertingRef.current = true;
            dataUrlToFile(dataUrl)
              .then(file => {
                if (!cancelled) setImageFileWithPreview(file);
              })
              .catch(() => {})
              .finally(() => { routeImageConvertingRef.current = false; });
          }
          if (savedCrop && !cancelled) setImageCrop(savedCrop);
        }
      } catch { /* no route image — user can select one */ }
      finally {
        if (!cancelled) setImageChecked(true);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, userPrefix]);

  function setImageFileWithPreview(file: File | null) {
    if (imagePreviewUrlRef.current) {
      URL.revokeObjectURL(imagePreviewUrlRef.current);
      imagePreviewUrlRef.current = null;
    }
    setImageFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      imagePreviewUrlRef.current = url;
      setImagePreviewUrl(url);
    }
  }

  const handleChangePhoto = useCallback((file: File) => {
    setUserPickedImage(true);
    setImageChecked(true);
    setImageFileWithPreview(file);
    setImageCrop({ x: 0, y: 0, w: 1, h: 1 });
    setMatchTriggered(false);
    // Persist route image to S3
    if (attempt && userPrefix) {
      compressImageToDataUrl(file).then(dataUrl => {
        const k = `${userPrefix}/${sanitizeDirName(attempt.state || "Unknown")}/${sanitizeDirName(attempt.area || "Unknown")}/${sanitizeDirName(attempt.route || "Unknown")}/route-image.json`;
        fetch("/api/s3/put", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: k, body: JSON.stringify({ dataUrl }) }),
        }).catch(() => {});
      }).catch(() => {});
    }
  }, [attempt, userPrefix]);

  const handleApplyMatch = useCallback(() => {
    if (!imageFile || !cv || !attemptId) return;
    setMatchTriggered(true);
    matchImage(imageFile, attemptId, cv, imageCrop);
    // Persist updated crop box with route image
    if (attempt && userPrefix && imageFile) {
      compressImageToDataUrl(imageFile).then(dataUrl => {
        const k = `${userPrefix}/${sanitizeDirName(attempt.state || "Unknown")}/${sanitizeDirName(attempt.area || "Unknown")}/${sanitizeDirName(attempt.route || "Unknown")}/route-image.json`;
        const crop = imageCrop.x === 0 && imageCrop.y === 0 && imageCrop.w === 1 && imageCrop.h === 1
          ? undefined : imageCrop;
        fetch("/api/s3/put", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: k, body: JSON.stringify({ dataUrl, ...(crop ? { cropBox: crop } : {}) }) }),
        }).catch(() => {});
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageFile, cv, attemptId, imageCrop, attempt, userPrefix]);

  const handleExportVideo = useCallback(async () => {
    if (!cv || !imageFile || !attemptId || !matchResult) return;
    const att = getAttempt(attemptId);
    if (!att?.orbFeatures) return;
    setExportStatus("rendering");
    setExportProgress(0);
    try {
      const url = await renderPoseVideo({
        cv,
        imageFile,
        frames: att.frames,
        videoMeta: att.videoMeta,
        orbFeatures: att.orbFeatures,
        queryOrb: matchResult.queryOrb,
        matches: matchResult.matches,
        skeletonStyle: styleRef.current,
        targetFps: 60,
        onProgress: (r, t) => setExportProgress(Math.round((r / t) * 100)),
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${attemptId}-pose-overlay.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus("done");
    } catch (err) {
      console.error("[ViewPage] Video export failed:", err);
      setExportStatus("idle");
    }
  }, [cv, imageFile, attemptId, matchResult]);

  const isMatching = matchStatus === "matching";
  const isFrameReady = frameStatus === "ready" && !!skeletonData;

  // ---- Render phases --------------------------------------------------------

  if (climbLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-edge border-t-fg" />
          <p className="text-sm text-fg-muted">Loading climb&#8230;</p>
        </div>
      </div>
    );
  }

  if (loadError || !attempt) {
    return (
      <div className="mx-auto w-full max-w-sm px-4 py-16 text-center flex flex-col items-center gap-4">
        <p className="text-sm text-danger">{loadError ?? "Climb not found."}</p>
        <button
          type="button"
          onClick={() => router.push("/profile")}
          className="rounded-xl bg-accent px-6 py-2.5 text-sm font-medium text-surface"
        >
          Back to Saved
        </button>
      </div>
    );
  }

  if (!imageChecked) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-edge border-t-fg" />
          <p className="text-sm text-fg-muted">Loading route image&#8230;</p>
        </div>
      </div>
    );
  }

  if (!imageFile || !imagePreviewUrl) {
    // No route image in S3 — let user select one
    return (
      <div className="mx-auto w-full max-w-sm px-4 py-16 text-center flex flex-col items-center gap-5">
        <div className="text-fg-muted">
          <svg className="mx-auto mb-3 h-12 w-12" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
          </svg>
          <p className="text-sm font-medium text-fg">No route photo saved</p>
          <p className="mt-1 text-xs text-fg-muted">
            Upload a photo of the route to overlay the skeleton.
          </p>
        </div>
        <label className="cursor-pointer rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-surface transition hover:bg-accent-hover">
          Select route photo
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleChangePhoto(f); }}
          />
        </label>
        <button
          type="button"
          onClick={() => router.push("/profile")}
          className="text-xs text-fg-muted transition hover:text-fg-secondary"
        >
          &#8592; Back to Saved
        </button>
      </div>
    );
  }

  return (
    <LoadingGate>
      <StepMatchRoutePhoto
        routePhotoFile={imageFile}
        routePhotoPreviewUrl={imagePreviewUrl}
        routePhotoCrop={imageCrop}
        onRoutePhotoCropChange={setImageCrop}
        routeMatchTriggered={matchTriggered}
        matchResult={matchResult}
        matchStatus={matchStatus}
        matchError={matchError}
        skeletonData={skeletonData}
        frameStatus={frameStatus}
        frameError={frameError}
        topoStyle={topoStyle}
        isFrameReady={isFrameReady}
        isMatching={isMatching}
        onSkeletonStyleChange={setSkeletonStyle}
        exportStatus={exportStatus}
        exportProgress={exportProgress}
        onApplyMatch={handleApplyMatch}
        onExportVideo={handleExportVideo}
        onChangePhoto={handleChangePhoto}
        onBack={() => router.push("/profile")}
        onSaveToDevice={() => {}}
        onUpload={() => {}}
        s3Saved
        s3Loading={false}
        savedRouteDirHandle={null}
        onDeleteFromDevice={() => {}}
        saveError={null}
      />
    </LoadingGate>
  );
}

// ---------------------------------------------------------------------------
// Page export with Suspense boundary (required for useSearchParams)
// ---------------------------------------------------------------------------

export default function ViewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-edge border-t-fg" />
        </div>
      }
    >
      <ViewPageInner />
    </Suspense>
  );
}
