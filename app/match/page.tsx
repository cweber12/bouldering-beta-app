"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import LoadingGate from "@/components/shared/LoadingGate";
import InfoDropdown from "@/components/shared/InfoDropdown";
import CropBoxOverlay, { type CropFraction } from "@/components/shared/CropBoxOverlay";
import { type AttemptEntry, loadAttemptFromJson, listDirectories, listAttemptFiles } from "@/utils/fsHelpers";
import { useOpenCV } from "@/hooks/useOpenCV";
import { useImageMatcher } from "@/hooks/useImageMatcher";
import { usePoseVideo, type SkeletonStyle } from "@/hooks/usePoseVideo";
import { getAttempt, saveAttempt } from "@/storage/sessionStore";
import type { RouteAttempt } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Inner component (needs useSearchParams)
// ---------------------------------------------------------------------------

function MatchPageInner() {
  const urlAttemptId = useSearchParams().get("id") ?? "";

  const { cv } = useOpenCV();
  const { matchImage, status: matchStatus, result: matchResult, errorMessage: matchError } =
    useImageMatcher();

  const [attemptId, setAttemptId] = useState<string>(() => urlAttemptId);
  const [attempt, setAttempt] = useState<RouteAttempt | null>(() =>
    urlAttemptId ? (getAttempt(urlAttemptId) ?? null) : null,
  );

  const [fsSupported] = useState(() => typeof window !== "undefined" && "showDirectoryPicker" in window);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [stateNames, setStateNames] = useState<string[]>([]);
  const [selectedState, setSelectedState] = useState("");
  const [areaNames, setAreaNames] = useState<string[]>([]);
  const [selectedArea, setSelectedArea] = useState("");
  const [routeNames, setRouteNames] = useState<string[]>([]);
  const [selectedRoute, setSelectedRoute] = useState("");
  const [attemptFiles, setAttemptFiles] = useState<AttemptEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [loadingNav, setLoadingNav] = useState(false);

  const dirHandles = useRef<{
    root: FileSystemDirectoryHandle | null;
    state: FileSystemDirectoryHandle | null;
    area: FileSystemDirectoryHandle | null;
    route: FileSystemDirectoryHandle | null;
  }>({ root: null, state: null, area: null, route: null });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const imagePreviewUrlRef = useRef<string | null>(null);

  // Crop box for ORB detection on the route photo.
  const [imageCrop, setImageCrop] = useState<CropFraction>({ x: 0, y: 0, w: 1, h: 1 });
  // Track whether the user has confirmed the crop and triggered matching.
  const [matchTriggered, setMatchTriggered] = useState(false);

  // Skeleton overlay style — set before matching; locked for the render.
  const [skeletonStyle, setSkeletonStyle] = useState<SkeletonStyle>({
    limbColor: "rgba(0,220,120,0.85)",
    jointColor: "rgba(255,220,0,0.92)",
    lineWidth: 2.5,
    pointRadius: 5,
  });

  const { videoUrl, status: videoStatus, errorMessage: videoError, renderProgress } =
    usePoseVideo(cv, imageFile, attemptId || null, matchResult, skeletonStyle);

  useEffect(() => {
    if (urlAttemptId) {
      setAttemptId(urlAttemptId);
      setAttempt(getAttempt(urlAttemptId) ?? null);
    }
  }, [urlAttemptId]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    };
  }, []);

  // ---- Folder navigation ----

  async function handlePickFolder() {
    setFolderError(null);
    try {
      const dir = await (
        window as unknown as { showDirectoryPicker: (opts?: object) => Promise<FileSystemDirectoryHandle> }
      ).showDirectoryPicker();
      dirHandles.current.root = dir;
      setFolderName(dir.name);
      setStateNames([]);
      setSelectedState("");
      setAreaNames([]);
      setSelectedArea("");
      setRouteNames([]);
      setSelectedRoute("");
      setAttemptFiles([]);
      setSelectedFile("");
      setLoadingNav(true);
      try {
        setStateNames(await listDirectories(dir));
      } finally {
        setLoadingNav(false);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setFolderError("Could not read the selected folder.");
    }
  }

  async function handleStateChange(state: string) {
    setSelectedState(state);
    setAreaNames([]);
    setSelectedArea("");
    setRouteNames([]);
    setSelectedRoute("");
    setAttemptFiles([]);
    setSelectedFile("");
    if (!dirHandles.current.root || !state) return;
    setLoadingNav(true);
    try {
      const stateDir = await dirHandles.current.root.getDirectoryHandle(state);
      dirHandles.current.state = stateDir;
      setAreaNames(await listDirectories(stateDir));
    } catch {
      setFolderError(`Could not read state folder "${state}".`);
    } finally {
      setLoadingNav(false);
    }
  }

  async function handleAreaChange(area: string) {
    setSelectedArea(area);
    setRouteNames([]);
    setSelectedRoute("");
    setAttemptFiles([]);
    setSelectedFile("");
    if (!dirHandles.current.state || !area) return;
    setLoadingNav(true);
    try {
      const areaDir = await dirHandles.current.state.getDirectoryHandle(area);
      dirHandles.current.area = areaDir;
      setRouteNames(await listDirectories(areaDir));
    } catch {
      setFolderError(`Could not read area folder "${area}".`);
    } finally {
      setLoadingNav(false);
    }
  }

  async function handleRouteChange(route: string) {
    setSelectedRoute(route);
    setAttemptFiles([]);
    setSelectedFile("");
    if (!dirHandles.current.area || !route) return;
    setLoadingNav(true);
    try {
      const routeDir = await dirHandles.current.area.getDirectoryHandle(route);
      dirHandles.current.route = routeDir;
      setAttemptFiles(await listAttemptFiles(routeDir));
    } catch {
      setFolderError(`Could not read route folder "${route}".`);
    } finally {
      setLoadingNav(false);
    }
  }

  async function handleAttemptFileSelect(fileName: string) {
    setSelectedFile(fileName);
    if (!dirHandles.current.route) return;
    try {
      const fileHandle = await dirHandles.current.route.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const loaded = loadAttemptFromJson(parsed);
      saveAttempt(loaded);
      setAttemptId(loaded.id);
      setAttempt(loaded);
    } catch (err) {
      setFolderError(
        `Could not load "${fileName}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function handleLoadFromDevice(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as unknown;
        const loaded = loadAttemptFromJson(parsed);
        saveAttempt(loaded);
        setAttemptId(loaded.id);
        setAttempt(loaded);
      } catch {
        setFolderError("Could not parse the attempt JSON file.");
      }
    };
    reader.readAsText(file);
  }

  // ---- Image matching ----

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    const url = URL.createObjectURL(file);
    imagePreviewUrlRef.current = url;
    setImagePreviewUrl(url);
    setImageFile(file);
    setImageCrop({ x: 0, y: 0, w: 1, h: 1 });
    setMatchTriggered(false);
  }

  function handleApplyAndMatch() {
    if (!imageFile || !cv || !attemptId) return;
    setMatchTriggered(true);
    matchImage(imageFile, attemptId, cv, imageCrop);
  }

  const isMatching = matchStatus === "matching";
  const isMatchDone = matchStatus === "done";
  const isRenderingVideo = videoStatus === "rendering";
  const isVideoReady = videoStatus === "ready";
  const hasAttempt = !!attempt;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10 flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Route Matching</h1>
          <p className="text-sm text-zinc-400">
            Upload a photo of the route and we&apos;ll overlay your recorded skeleton onto it using
            the ORB reference features extracted on the Upload page.
          </p>
        </div>
        <Link href="/upload" className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300 transition">
          ← Back to upload
        </Link>
      </div>

      {/* Info dropdowns */}
      <div className="flex flex-col gap-3">
        <InfoDropdown title="How does route matching work?">
          <ul className="flex flex-col gap-1.5 pl-4 list-disc">
            <li>The app extracts <strong className="text-zinc-300">ORB visual features</strong> (corner points) from your route photo and matches them against the reference features recorded from the video.</li>
            <li>Matching finds pairs of features that appear the same in both images. The best pairs are used to compute a <strong className="text-zinc-300">perspective transform</strong> that maps the video&apos;s coordinate space onto the photo.</li>
            <li>Each recorded skeleton keypoint is then projected into the photo using that transform, producing the overlay video.</li>
            <li>Match quality depends on <strong className="text-zinc-300">shared wall texture</strong>. Photos taken from a very different angle or distance will reduce accuracy.</li>
          </ul>
        </InfoDropdown>
        <InfoDropdown title="How to crop the route photo">
          <ul className="flex flex-col gap-1.5 pl-4 list-disc">
            <li>Drag the crop handles to focus on the <strong className="text-zinc-300">wall surface</strong> — rock texture, holds, and chalk marks are ideal features for matching.</li>
            <li>Exclude sky, trees, gear, people, and the floor — these change between sessions and spoil the match.</li>
            <li>The crop should roughly correspond to the background (ORB) crop you set on the upload page.</li>
            <li>If matching fails or produces few good matches, try re-cropping to include more distinctive wall texture.</li>
          </ul>
        </InfoDropdown>
      </div>

      {/* Attempt data section */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4 flex flex-col gap-4">
        <p className="text-sm font-medium text-zinc-300">Attempt data</p>

        {hasAttempt && (
          <div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-mono text-zinc-300">{attempt.id}</span>
              <span className="text-xs text-zinc-500">
                {attempt.frames.length} pose frames &middot;{" "}
                {attempt.orbFeatures?.keypoints.length ?? 0} ORB keypoints
                {attempt.state && ` \u00b7 ${attempt.state}`}
                {attempt.area && ` \u203a ${attempt.area}`}
                {attempt.route && ` \u203a ${attempt.route}`}
              </span>
            </div>
            <span className="text-xs font-medium text-emerald-400">Loaded</span>
          </div>
        )}

        {fsSupported ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={handlePickFolder}
                className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
                </svg>
                {folderName ? `Change folder (${folderName})` : "Open BoulderingBeta folder"}
              </button>
              {loadingNav && <span className="text-xs text-zinc-500 animate-pulse">Reading...</span>}
            </div>

            {stateNames.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-zinc-400">State / Region</label>
                  <select
                    value={selectedState}
                    onChange={e => handleStateChange(e.target.value)}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
                  >
                    <option value="">— select —</option>
                    {stateNames.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-zinc-400">Area</label>
                  <select
                    value={selectedArea}
                    onChange={e => handleAreaChange(e.target.value)}
                    disabled={!areaNames.length}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500 disabled:opacity-40"
                  >
                    <option value="">— select —</option>
                    {areaNames.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-zinc-400">Route</label>
                  <select
                    value={selectedRoute}
                    onChange={e => handleRouteChange(e.target.value)}
                    disabled={!routeNames.length}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500 disabled:opacity-40"
                  >
                    <option value="">— select —</option>
                    {routeNames.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            )}

            {attemptFiles.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-zinc-400">
                  Attempts for <span className="text-zinc-300">{selectedRoute}</span>
                </p>
                <div className="mt-1 flex flex-col divide-y divide-zinc-800 rounded-lg border border-zinc-800 overflow-hidden">
                  {attemptFiles.map(entry => (
                    <button
                      key={entry.name}
                      onClick={() => handleAttemptFileSelect(entry.name)}
                      className={[
                        "flex items-center justify-between px-4 py-2.5 text-left text-sm transition hover:bg-zinc-800",
                        selectedFile === entry.name ? "bg-zinc-800 text-zinc-100 font-medium" : "text-zinc-400",
                      ].join(" ")}
                    >
                      <span>{entry.label}</span>
                      {selectedFile === entry.name && <span className="text-xs text-emerald-400">Selected</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {attemptFiles.length === 0 && selectedRoute && !loadingNav && (
              <p className="text-xs text-zinc-500">No attempt files found for this route.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-zinc-500">
              Folder navigation requires Chrome or Edge. Load a single .json file:
            </p>
            <label className="flex cursor-pointer items-center gap-2 self-start rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              Choose attempt file
              <input type="file" accept="application/json,.json" className="hidden" onChange={handleLoadFromDevice} />
            </label>
          </div>
        )}

        <button
          disabled
          title="Cloud loading coming soon"
          className="self-start flex cursor-not-allowed items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-600"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
          </svg>
          Load from cloud (coming soon)
        </button>

        {folderError && <p className="text-xs text-red-400">{folderError}</p>}
      </div>

      {/* Skeleton style controls — shown BEFORE matching starts; locked once processing begins */}
      {!isMatching && !isRenderingVideo && !isVideoReady && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4 flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-zinc-300">Skeleton style</p>
            <p className="text-xs text-zinc-500">
              Choose colours and sizes before processing — style cannot be changed once rendering begins.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-400">Limb color</label>
              <input
                type="color"
                value={skeletonStyle.limbColor?.replace(/rgba?\([^)]+\)/, "#00dc78") ?? "#00dc78"}
                onChange={e => setSkeletonStyle(s => ({ ...s, limbColor: e.target.value }))}
                className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-zinc-950 p-0.5"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-400">Joint color</label>
              <input
                type="color"
                value={skeletonStyle.jointColor?.replace(/rgba?\([^)]+\)/, "#ffdc00") ?? "#ffdc00"}
                onChange={e => setSkeletonStyle(s => ({ ...s, jointColor: e.target.value }))}
                className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-zinc-950 p-0.5"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="flex justify-between text-xs text-zinc-400">
                <span>Line width</span>
                <span className="font-mono text-zinc-300">{skeletonStyle.lineWidth ?? 2.5}px</span>
              </label>
              <input
                type="range" min={0.5} max={8} step={0.5}
                value={skeletonStyle.lineWidth ?? 2.5}
                onChange={e => setSkeletonStyle(s => ({ ...s, lineWidth: Number(e.target.value) }))}
                className="accent-zinc-200"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="flex justify-between text-xs text-zinc-400">
                <span>Point radius</span>
                <span className="font-mono text-zinc-300">{skeletonStyle.pointRadius ?? 5}px</span>
              </label>
              <input
                type="range" min={1} max={12} step={1}
                value={skeletonStyle.pointRadius ?? 5}
                onChange={e => setSkeletonStyle(s => ({ ...s, pointRadius: Number(e.target.value) }))}
                className="accent-zinc-200"
              />
            </div>
          </div>
        </div>
      )}

      {/* Route image upload */}
      <div className="flex flex-col gap-4">
        <label
          className={[
            "flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-8 py-6 text-sm transition",
            !hasAttempt || isMatching
              ? "cursor-not-allowed border-zinc-800 text-zinc-600"
              : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
          ].join(" ")}
        >
          <svg className="h-6 w-6 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3 4.5h18M3 4.5v16.5M21 4.5v16.5" />
          </svg>
          <span>{isMatching ? "Matching..." : "Select a route photo"}</span>
          <span className="text-xs text-zinc-600">JPG, PNG, WebP accepted</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={!hasAttempt || isMatching}
            onChange={handleImageChange}
          />
        </label>

        {/* Crop UI — shown after image selected, before match is triggered */}
        {imagePreviewUrl && imageFile && !matchTriggered && !isMatching && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-zinc-400">
              Adjust the crop region to focus ORB matching on the relevant wall area, then click
              &ldquo;Apply &amp; Match&rdquo;.
            </p>
            <div className="relative w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrl}
                alt="Route photo preview"
                className="max-h-80 w-full rounded-xl border border-zinc-700 bg-zinc-900 object-contain"
              />
              <CropBoxOverlay
                box={imageCrop}
                onChange={setImageCrop}
                disabled={!hasAttempt}
              />
            </div>
            <button
              onClick={handleApplyAndMatch}
              disabled={!hasAttempt}
              className="flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply &amp; Match
            </button>
          </div>
        )}

        {/* Static preview after match triggered */}
        {imagePreviewUrl && (matchTriggered || isMatching || isMatchDone) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imagePreviewUrl}
            alt="Route photo preview"
            className="max-h-80 w-full rounded-xl border border-zinc-700 bg-zinc-900 object-contain"
          />
        )}
      </div>

      {/* Match stats */}
      {isMatchDone && matchResult && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4 flex flex-col gap-1">
          <p className="text-sm font-medium text-zinc-300">Match statistics</p>
          <div className="mt-2 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xl font-bold text-zinc-100">{matchResult.matches.length}</p>
              <p className="text-xs text-zinc-500">good matches</p>
            </div>
            <div>
              <p className="text-xl font-bold text-zinc-100">{matchResult.queryKeypoints}</p>
              <p className="text-xs text-zinc-500">query keypoints</p>
            </div>
            <div>
              <p className="text-xl font-bold text-zinc-100">{matchResult.referenceKeypoints}</p>
              <p className="text-xs text-zinc-500">reference keypoints</p>
            </div>
          </div>
          {matchResult.matches.length < 10 && (
            <p className="mt-3 text-xs text-amber-400">
              Fewer than 10 matches the homography may be unstable. Try a closer or better-lit photo of the same wall section.
            </p>
          )}
        </div>
      )}

      {/* Render progress */}
      {isRenderingVideo && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Rendering pose overlay...</span>
            <span>{renderProgress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-zinc-200 transition-all duration-150"
              style={{ width: `${renderProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Pose video */}
      {isVideoReady && videoUrl && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-zinc-300">Pose overlay</p>
          <video
            src={videoUrl}
            controls
            loop
            playsInline
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900"
          />
          <a
            href={videoUrl}
            download={`${attemptId}-pose-overlay.webm`}
            className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download pose overlay video (.webm)
          </a>
        </div>
      )}

      {(matchStatus === "error" || videoStatus === "error") && (
        <p className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {matchError ?? videoError}
        </p>
      )}
    </div>
  );
}

export default function MatchPage() {
  return (
    <LoadingGate requiresTF={false}>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            Loading...
          </div>
        }
      >
        <MatchPageInner />
      </Suspense>
    </LoadingGate>
  );
}
