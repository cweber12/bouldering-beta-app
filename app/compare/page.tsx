"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import LoadingGate from "@/components/shared/LoadingGate";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { usePoseVideo } from "@/hooks/usePoseVideo";
import { saveAttempt } from "@/storage/sessionStore";
import { computeHomography } from "@/pipeline/homography";
import { buildTransformedKeypoints, drawSkeleton } from "@/pipeline/skeletonOverlay";
import type { RouteAttempt } from "@/storage/sessionStore";
import type { ImageMatchResult } from "@/hooks/useImageMatcher";

// ---------------------------------------------------------------------------
// Types / constants
// ---------------------------------------------------------------------------

type ViewMode = "sidebyside" | "overlay";

// Per-attempt accent colors (limb, joint)
const SLOT_COLORS: Array<{ limb: string; joint: string; label: string }> = [
  { limb: "rgba(0,210,115,0.82)", joint: "rgba(255,215,0,0.9)", label: "Attempt 1" },
  { limb: "rgba(56,189,248,0.82)", joint: "rgba(255,255,255,0.9)", label: "Attempt 2" },
  { limb: "rgba(251,146,60,0.82)", joint: "rgba(255,255,255,0.9)", label: "Attempt 3" },
  { limb: "rgba(192,132,252,0.82)", joint: "rgba(255,255,255,0.9)", label: "Attempt 4" },
];

interface AttemptEntry {
  name: string;
  label: string;
}

// ---------------------------------------------------------------------------
// FSAPI helpers (shared with match page)
// ---------------------------------------------------------------------------

type FSDir = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemHandle & { kind: string; name: string }>;
};

function attemptTimestampLabel(fileName: string): string {
  const m = fileName.match(/attempt-(\d+)\.json/);
  if (!m) return fileName;
  return new Date(parseInt(m[1], 10)).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

async function listDirectories(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of (dir as FSDir).values()) {
    if (entry.kind === "directory") names.push(entry.name);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

async function listAttemptFiles(dir: FileSystemDirectoryHandle): Promise<AttemptEntry[]> {
  const entries: AttemptEntry[] = [];
  for await (const entry of (dir as FSDir).values()) {
    if (entry.kind === "file" && entry.name.endsWith(".json")) {
      entries.push({ name: entry.name, label: attemptTimestampLabel(entry.name) });
    }
  }
  return entries.sort((a, b) => {
    const ta = parseInt(a.name.match(/(\d+)/)?.[1] ?? "0", 10);
    const tb = parseInt(b.name.match(/(\d+)/)?.[1] ?? "0", 10);
    return tb - ta;
  });
}

function loadAttemptFromJson(raw: unknown): RouteAttempt {
  if (!raw || typeof raw !== "object") throw new Error("Invalid attempt data.");
  const obj = raw as Record<string, unknown>;
  if (obj.orbFeatures && typeof obj.orbFeatures === "object") {
    const orb = obj.orbFeatures as Record<string, unknown>;
    if (Array.isArray(orb.descriptors)) {
      orb.descriptors = new Uint8Array(orb.descriptors as number[]);
    }
  }
  return { state: "", area: "", route: "", ...obj } as unknown as RouteAttempt;
}

// ---------------------------------------------------------------------------
// Per-attempt render slot (owns its own hooks)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

interface SlotProps {
  slotIndex: number;
  attempt: RouteAttempt | null;
  imageFile: File | null;
  cv: CV;
  onMatchResult: (idx: number, result: ImageMatchResult | null) => void;
}

function CompareSlot({ slotIndex, attempt, imageFile, cv, onMatchResult }: SlotProps) {
  const colors = SLOT_COLORS[slotIndex];
  const { matchImage, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();
  const { videoUrl, status: videoStatus, renderProgress, previewFrame } =
    usePoseVideo(cv, imageFile, attempt?.id ?? null, matchResult);

  // Notify parent when match result changes
  useEffect(() => {
    onMatchResult(slotIndex, matchResult);
  }, [matchResult, slotIndex, onMatchResult]);

  // Re-run matching when attempt or imageFile changes
  useEffect(() => {
    if (!attempt || !imageFile || !cv) return;
    matchImage(imageFile, attempt.id, cv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt?.id, imageFile, cv]);

  const isRendering = videoStatus === "rendering";
  const isReady = videoStatus === "ready";
  const isError = videoStatus === "error" || matchStatus === "error";

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4"
      style={{ borderTopColor: colors.limb, borderTopWidth: 2 }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: colors.limb }}
        />
        <span className="text-xs font-medium text-zinc-300">{colors.label}</span>
        {attempt && (
          <span className="ml-auto text-xs text-zinc-600">
            {attempt.frames.length} frames
          </span>
        )}
      </div>

      {!attempt && (
        <p className="text-xs text-zinc-600 italic">No attempt loaded</p>
      )}

      {attempt && matchStatus === "matching" && (
        <p className="text-xs text-zinc-400 animate-pulse">Matching&#8230;</p>
      )}

      {isRendering && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Rendering&#8230;</span>
            <span>{renderProgress}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full transition-all duration-150"
              style={{ width: `${renderProgress}%`, backgroundColor: colors.limb }}
            />
          </div>
          {previewFrame && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewFrame}
              alt="Render preview"
              className="w-full rounded-lg border border-zinc-700 object-contain opacity-70 mt-1"
            />
          )}
        </div>
      )}

      {isReady && videoUrl && (
        <div className="flex flex-col gap-2">
          <video
            src={videoUrl}
            controls
            loop
            playsInline
            muted
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950"
          />
          <a
            href={videoUrl}
            download={`${attempt?.id ?? "attempt"}-overlay.webm`}
            className="text-center text-xs text-zinc-500 hover:text-zinc-300 transition"
          >
            Download .webm
          </a>
        </div>
      )}

      {isError && (
        <p className="text-xs text-red-400">{matchError ?? "Render failed."}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Folder picker dialog state (for loading attempts)
// ---------------------------------------------------------------------------

interface FolderPickerProps {
  onLoad: (attempt: RouteAttempt) => void;
  label: string;
}

function FolderAttemptPicker({ onLoad, label }: FolderPickerProps) {
  const [open, setOpen] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [stateNames, setStateNames] = useState<string[]>([]);
  const [selectedState, setSelectedState] = useState("");
  const [areaNames, setAreaNames] = useState<string[]>([]);
  const [selectedArea, setSelectedArea] = useState("");
  const [routeNames, setRouteNames] = useState<string[]>([]);
  const [selectedRoute, setSelectedRoute] = useState("");
  const [attemptFiles, setAttemptFiles] = useState<AttemptEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fsSupported] = useState(() => typeof window !== "undefined" && "showDirectoryPicker" in window);

  const dirHandles = useRef<{
    root: FileSystemDirectoryHandle | null;
    state: FileSystemDirectoryHandle | null;
    area: FileSystemDirectoryHandle | null;
    route: FileSystemDirectoryHandle | null;
  }>({ root: null, state: null, area: null, route: null });

  async function pickFolder() {
    setFolderError(null);
    try {
      const root = await (
        window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
      ).showDirectoryPicker();
      dirHandles.current.root = root;
      setLoading(true);
      setStateNames(await listDirectories(root));
      setLoading(false);
      setOpen(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setFolderError("Could not read folder.");
    }
  }

  async function onStateChange(s: string) {
    setSelectedState(s); setAreaNames([]); setSelectedArea("");
    setRouteNames([]); setSelectedRoute(""); setAttemptFiles([]);
    if (!dirHandles.current.root || !s) return;
    setLoading(true);
    try {
      const d = await dirHandles.current.root.getDirectoryHandle(s);
      dirHandles.current.state = d;
      setAreaNames(await listDirectories(d));
    } finally { setLoading(false); }
  }

  async function onAreaChange(a: string) {
    setSelectedArea(a); setRouteNames([]); setSelectedRoute(""); setAttemptFiles([]);
    if (!dirHandles.current.state || !a) return;
    setLoading(true);
    try {
      const d = await dirHandles.current.state.getDirectoryHandle(a);
      dirHandles.current.area = d;
      setRouteNames(await listDirectories(d));
    } finally { setLoading(false); }
  }

  async function onRouteChange(r: string) {
    setSelectedRoute(r); setAttemptFiles([]);
    if (!dirHandles.current.area || !r) return;
    setLoading(true);
    try {
      const d = await dirHandles.current.area.getDirectoryHandle(r);
      dirHandles.current.route = d;
      setAttemptFiles(await listAttemptFiles(d));
    } finally { setLoading(false); }
  }

  async function selectFile(name: string) {
    if (!dirHandles.current.route) return;
    try {
      const fh = await dirHandles.current.route.getFileHandle(name);
      const file = await fh.getFile();
      const parsed = JSON.parse(await file.text()) as unknown;
      const attempt = loadAttemptFromJson(parsed);
      saveAttempt(attempt);
      onLoad(attempt);
      setOpen(false);
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Load failed.");
    }
  }

  function loadFromFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const attempt = loadAttemptFromJson(JSON.parse(ev.target?.result as string));
        saveAttempt(attempt);
        onLoad(attempt);
      } catch { setFolderError("Could not parse file."); }
    };
    reader.readAsText(file);
  }

  return (
    <div className="flex flex-col gap-2">
      {fsSupported ? (
        <button
          onClick={pickFolder}
          className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
          </svg>
          {label}
        </button>
      ) : (
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          {label}
          <input type="file" accept=".json" className="hidden" onChange={loadFromFile} />
        </label>
      )}

      {folderError && <p className="text-xs text-red-400">{folderError}</p>}

      {open && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3">
          {loading && <p className="text-xs text-zinc-500 animate-pulse">Reading&#8230;</p>}

          {stateNames.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "State", val: selectedState, opts: stateNames, change: onStateChange },
                { label: "Area", val: selectedArea, opts: areaNames, change: onAreaChange },
                { label: "Route", val: selectedRoute, opts: routeNames, change: onRouteChange },
              ].map(({ label: lbl, val, opts, change }) => (
                <div key={lbl} className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">{lbl}</span>
                  <select
                    value={val}
                    onChange={e => change(e.target.value)}
                    disabled={!opts.length}
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none disabled:opacity-40"
                  >
                    <option value="">-- select --</option>
                    {opts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          {attemptFiles.length > 0 && (
            <div className="flex flex-col divide-y divide-zinc-800 rounded border border-zinc-800 overflow-hidden">
              {attemptFiles.map(f => (
                <button
                  key={f.name}
                  onClick={() => selectFile(f.name)}
                  className="px-3 py-2 text-left text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlay canvas: composite static frame from all matched attempts
// ---------------------------------------------------------------------------

interface OverlayCanvasProps {
  imageFile: File | null;
  matchResults: (ImageMatchResult | null)[];
  attempts: (RouteAttempt | null)[];
  cv: CV;
}

function OverlayCanvas({ imageFile, matchResults, attempts, cv }: OverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageFile || !cv) return;

    const readyPairs = attempts
      .map((att, i) => ({ att, mr: matchResults[i] }))
      .filter((p): p is { att: RouteAttempt; mr: ImageMatchResult } => !!p.att && !!p.mr);

    if (readyPairs.length === 0) {
      // Defer state update to avoid calling setState synchronously inside an effect
      const id = setTimeout(() => setRendered(false), 0);
      return () => clearTimeout(id);
    }

    const img = new Image();
    const url = URL.createObjectURL(imageFile);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);

        for (let i = 0; i < readyPairs.length; i++) {
          const { att, mr } = readyPairs[i];
          const colors = SLOT_COLORS[attempts.indexOf(att)] ?? SLOT_COLORS[0];
          const h = computeHomography(cv, mr.matches, att.orbFeatures!, mr.queryOrb);
          if (!h) continue;

          // Pick the middle frame of the attempt
          const frame = att.frames[Math.floor(att.frames.length / 2)];
          if (!frame) continue;

          const kp = buildTransformedKeypoints(
            frame, h,
            att.videoMeta.width, att.videoMeta.height,
          );
          drawSkeleton(ctx, kp, { limbColor: colors.limb, jointColor: colors.joint });
        }
        setRendered(true);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Overlay failed.");
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); setError("Could not load route image."); };
    img.src = url;
  }, [imageFile, matchResults, attempts, cv]);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {!rendered && (
        <p className="text-xs text-zinc-500 italic">
          Overlay will appear here once at least one attempt has been matched.
        </p>
      )}
      <canvas
        ref={canvasRef}
        className="w-full rounded-xl border border-zinc-700 bg-zinc-900"
        aria-label="Skeleton overlay composite"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main compare page
// ---------------------------------------------------------------------------

const MAX_SLOTS = 4;
const INITIAL_SLOTS = 2;

function ComparePageInner() {
  const { cv } = useOpenCV();
  const [attempts, setAttempts] = useState<(RouteAttempt | null)[]>(
    () => Array.from({ length: MAX_SLOTS }, () => null),
  );
  const [slotCount, setSlotCount] = useState(INITIAL_SLOTS);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const imagePreviewRef = useRef<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("sidebyside");
  const [matchResults, setMatchResults] = useState<(ImageMatchResult | null)[]>(
    () => Array.from({ length: MAX_SLOTS }, () => null),
  );

  useEffect(() => {
    return () => {
      if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current);
    };
  }, []);

  const handleMatchResult = useCallback((idx: number, result: ImageMatchResult | null) => {
    setMatchResults(prev => {
      const next = [...prev];
      next[idx] = result;
      return next;
    });
  }, []);

  function handleLoadAttempt(idx: number, attempt: RouteAttempt) {
    setAttempts(prev => {
      const next = [...prev];
      next[idx] = attempt;
      return next;
    });
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (imagePreviewRef.current) URL.revokeObjectURL(imagePreviewRef.current);
    const url = URL.createObjectURL(file);
    imagePreviewRef.current = url;
    setImagePreviewUrl(url);
    setImageFile(file);
  }

  const anyLoaded = attempts.slice(0, slotCount).some(Boolean);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10 flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Compare Attempts</h1>
        <p className="text-sm text-zinc-400">
          Load multiple attempts and overlay or compare them side by side on the same route photo.
        </p>
      </div>

      {/* Route photo */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-zinc-300">Route photo</p>
        <label
          className={[
            "flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-8 py-5 text-sm transition",
            imageFile
              ? "border-zinc-600 bg-zinc-900 text-zinc-400"
              : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
          ].join(" ")}
        >
          <svg className="h-5 w-5 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
          </svg>
          <span>{imageFile ? imageFile.name : "Select route photo"}</span>
          <span className="text-xs text-zinc-600">JPG, PNG, WebP</span>
          <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
        </label>
        {imagePreviewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imagePreviewUrl}
            alt="Route photo"
            className="max-h-48 w-full rounded-xl border border-zinc-700 bg-zinc-900 object-contain"
          />
        )}
      </div>

      {/* View mode */}
      {anyLoaded && imageFile && (
        <div className="flex gap-2">
          {(["sidebyside", "overlay"] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={[
                "rounded-lg border px-4 py-2 text-sm font-medium transition",
                viewMode === mode
                  ? "border-zinc-400 bg-zinc-800 text-zinc-100"
                  : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300",
              ].join(" ")}
            >
              {mode === "sidebyside" ? "Side by side" : "Overlay"}
            </button>
          ))}
        </div>
      )}

      {/* Attempt slots */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-300">Attempts</p>
          {slotCount < MAX_SLOTS && (
            <button
              onClick={() => setSlotCount(c => c + 1)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition"
            >
              + Add attempt
            </button>
          )}
        </div>

        {Array.from({ length: slotCount }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <FolderAttemptPicker
              label={attempts[i] ? `Change ${SLOT_COLORS[i].label}` : `Load ${SLOT_COLORS[i].label}`}
              onLoad={att => handleLoadAttempt(i, att)}
            />
            {attempts[i] && (
              <CompareSlot
                slotIndex={i}
                attempt={attempts[i]}
                imageFile={imageFile}
                cv={cv}
                onMatchResult={handleMatchResult}
              />
            )}
          </div>
        ))}
      </div>

      {/* Overlay mode result */}
      {viewMode === "overlay" && imageFile && anyLoaded && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-zinc-300">Overlay (middle frame per attempt)</p>
          <div className="flex flex-wrap gap-3 text-xs">
            {attempts.slice(0, slotCount).map((att, i) =>
              att ? (
                <span key={i} className="flex items-center gap-1.5 text-zinc-400">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: SLOT_COLORS[i].limb }}
                  />
                  {SLOT_COLORS[i].label}: {att.route || att.id}
                </span>
              ) : null,
            )}
          </div>
          <OverlayCanvas
            imageFile={imageFile}
            matchResults={matchResults.slice(0, slotCount)}
            attempts={attempts.slice(0, slotCount)}
            cv={cv}
          />
        </div>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <LoadingGate>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            Loading&#8230;
          </div>
        }
      >
        <ComparePageInner />
      </Suspense>
    </LoadingGate>
  );
}
