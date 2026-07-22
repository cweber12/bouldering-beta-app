"use client";

/**
 * Dev-only Calibrator — the Calibrate act of the three-act harness flow.
 *
 * The Scan Setup (crops + analysis tap + wall + tier) is authored separately in
 * the Setup act; this view is seed-tap-only. It loads the video + saved Setup and
 * shows a scrub + single-tap affordance (SeedTapEditor) pre-filled from the saved
 * off-hash Seed tap, or — first time — from the analysis tap (`climberPoint`).
 * Confirming persists the Seed tap off-hash (`saveSeedTap`, which never rewrites
 * the crops or `setupHash`, so prior runs stay paired — ADR 0020) and kicks off
 * the downloader's ViTPose scaffold job over the uniform Detection Frame grid,
 * seeded by the Seed tap and a derived `seedRegion` rather than gated by the
 * Climber Crop (issue 02). The ViTPose poses seed the flag-only Ground Truth
 * review. Re-calibrate re-opens this same seed-tap view; on a stale-truth bundle
 * whose scaffold on disk is already seed-ready, "Review seed" opens the review
 * straight from the artifact with no job, and "Re-run ViTPose" forces a fresh
 * job. Calibration runs no detection at all: it authors truth, and nothing else.
 *
 * Rendered only in development. See docs/adr/0017, 0018, 0019 and 0020.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDetectionThumbnails } from "@/hooks/useDetectionThumbnails";
import SeedTapEditor from "@/components/dev/SeedTapEditor";
import DetectionFrameStepper from "@/components/dev/DetectionFrameStepper";
import GroundTruthReviewer from "@/components/dev/GroundTruthReviewer";
import GroundTruthSeedStatus from "@/components/dev/GroundTruthSeedStatus";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import {
  buildGroundTruthScaffold,
  contextKeypointsAt,
  countSeedCoverage,
  deriveFrameFlags,
  enumerateWrongStretches,
  frameReviewMark,
  governingControlPoint,
  hasAcceptedGroundTruth,
  materializeReview,
  reconstructControlPoints,
  reseedAffordanceDecision,
  seedGateDecision,
  type FrameReviewMark,
  type ReviewFlag,
} from "@/utils/harnessGroundTruthScaffold";
import {
  loadGroundTruth,
  saveGroundTruth,
  type GroundTruthInput,
} from "@/utils/harnessGroundTruth";
import {
  requestViTPoseScaffold,
  loadViTPose,
  viTPoseToPoseFrames,
  scaffoldHasPose,
  noClimberMessage,
  VITPOSE_POLL_TIMEOUT_MS,
  type ViTPoseScaffold,
} from "@/utils/harnessViTPose";
import { buildDetectionGrid, type DetectionGridFrame } from "@/utils/harnessDetectionGrid";
import { scaffoldIsStale, truthIsStale } from "@/utils/harnessFreshness";
import { probeVideoMeta, type VideoMeta } from "@/utils/probeVideoMeta";
import { deriveSeedRegion } from "@/utils/cropContainment";
import { type CropFraction, DEFAULT_CROP } from "@/utils/cropFraction";
import { saveSeedTap, type ClimberPoint } from "@/utils/harnessSetup";
import type { CorpusItem } from "@/utils/harnessCorpus";

type RunPhase = "idle" | "saving" | "review" | "done" | "error";

export default function Calibrator({
  item,
  onBack,
  onDone,
}: {
  item: CorpusItem;
  onBack: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [phaseError, setPhaseError] = useState<string | null>(null);

  /** The Detection Frame the reviewer is attesting. */
  const [gtFrameIndex, setGtFrameIndex] = useState(0);

  // The off-hash Seed tap being authored. Pre-filled on load from the saved
  // `seedTap`, else the analysis tap (`climberPoint`) the first time.
  const [seedTap, setSeedTap] = useState<ClimberPoint | null>(null);
  // The saved Scan Setup's crops + panning ride along on the ViTPose request for
  // parity; they no longer gate the seed (the derived `seedRegion` does).
  const [climberCrop, setClimberCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [wallCrop, setWallCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [panning, setPanning] = useState(false);

  // Ground Truth review: the pure scaffold seed, the working flag review, and
  // any previously-saved GT carried onto a re-seed by timestamp. The ref is what
  // seeding reads (so saving truth never re-triggers the seed effect); the flag
  // mirrors it for render.
  const existingGtRef = useRef<GroundTruthInput | null>(null);
  const [truthAccepted, setTruthAccepted] = useState(false);
  /** The saved truth's stamped setupHash ("" legacy) — drives the stale state. */
  const [truthSetupHash, setTruthSetupHash] = useState("");
  const [gtSeed, setGtSeed] = useState<GroundTruthInput | null>(null);
  const [controlPoints, setControlPoints] = useState<Map<number, ReviewFlag>>(new Map());
  const [gtSave, setGtSave] = useState<{ ok: boolean; message: string } | null>(null);
  const [gtSaving, setGtSaving] = useState(false);
  const [currentSetupHash, setCurrentSetupHash] = useState("");

  // ViTPose scaffold (ADR 0019): the downloader runs a stronger reference model
  // that seeds the Ground Truth landmarks. Kicked off the moment the Seed tap is
  // confirmed and polled until `vitpose.json` lands in the bundle.
  const [vitpose, setVitpose] = useState<ViTPoseScaffold | null>(null);
  const [vitposeStatus, setVitposeStatus] = useState<
    "idle" | "requesting" | "polling" | "ready" | "failed"
  >("idle");
  const [vitposeError, setVitposeError] = useState<string | null>(null);
  const [vitposeWarnings, setVitposeWarnings] = useState<string[]>([]);
  const vitposeRequestedRef = useRef<DetectionGridFrame[] | null>(null);
  const vitposePoseFrames = useMemo(() => (vitpose ? viTPoseToPoseFrames(vitpose) : []), [vitpose]);
  const vitposePosedCount = useMemo(
    () => (vitpose ? vitpose.frames.filter((f) => f.keypoints.length > 0).length : 0),
    [vitpose],
  );

  const seedPoseFrames = useMemo(
    () => (vitposeStatus === "ready" ? vitposePoseFrames : []),
    [vitposeStatus, vitposePoseFrames],
  );
  const gtGate = seedGateDecision({
    vitposeStatus,
    vitposeError,
    seedHasPose: vitpose ? scaffoldHasPose(vitpose) : false,
  });

  // Accepted truth whose stamped hash no longer matches the current Setup: it
  // reads as stale until ViTPose is re-run and the truth re-accepted. Because the
  // Seed tap is off-hash, a seed re-tap alone never changes `currentSetupHash`.
  const truthStale = truthAccepted && truthIsStale(truthSetupHash, currentSetupHash);

  // Smart re-seed probe (batch re-seed PRD): on a stale-truth bundle, ask the
  // existing ViTPose GET whether a fresh posed scaffold is on disk before ever
  // offering to submit a job — turning the re-seed affordance into "Review seed".
  const [probedScaffold, setProbedScaffold] = useState<ViTPoseScaffold | null>(null);
  const [probedWarnings, setProbedWarnings] = useState<string[]>([]);
  useEffect(() => {
    setProbedScaffold(null);
    setProbedWarnings([]);
    if (!truthStale) return;
    let cancelled = false;
    void (async () => {
      try {
        const { scaffold, warnings } = await loadViTPose(item.key);
        if (cancelled) return;
        setProbedScaffold(scaffold);
        setProbedWarnings(warnings);
      } catch {
        // Probe failure just means no shortcut — the job flow stays available.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [truthStale, item.key]);
  const reseedAffordance = reseedAffordanceDecision(probedScaffold, currentSetupHash);

  // A Seed tap from a setup calibrated before the tap-timestamp contract: the
  // downloader can only seed by global tap position, which grabs a bystander who
  // ever crosses that spot. Re-tapping the Seed tap writes `t` and fixes it.
  const legacyTapNoTimestamp = seedTap != null && seedTap.t === undefined;

  // The Detection Frame grid: uniform 100 ms stride over the video's duration.
  const gridFrames = useMemo(
    () => (videoMeta ? buildDetectionGrid(videoMeta.duration) : []),
    [videoMeta],
  );

  const gridThumbnails = useDetectionThumbnails(videoUrl, gridFrames, phase === "review");

  // Load the video bytes + saved Scan Setup for this bundle. Calibrate is gated
  // on `hasSetup`, so a Setup is expected; its crops/panning ride the ViTPose
  // request, its hash stamps the truth, and the Seed tap pre-fills from the saved
  // `seedTap` or, first time, the analysis tap.
  useEffect(() => {
    let revoked = false;
    let url: string | null = null;
    (async () => {
      setLoadError(null);
      try {
        const [vidRes, setupRes] = await Promise.all([
          fetch(`/api/dev/corpus/video?key=${encodeURIComponent(item.key)}`),
          fetch(`/api/dev/corpus/setup?key=${encodeURIComponent(item.key)}`),
        ]);
        if (!vidRes.ok) throw new Error("Failed to load video.");
        const blob = await vidRes.blob();
        url = URL.createObjectURL(blob);
        if (revoked) return;
        setVideoUrl(url);
        const meta = await probeVideoMeta(url);
        if (revoked) return;
        setVideoMeta(meta);

        const { setup } = await setupRes.json();
        if (setup && !revoked) {
          setClimberCrop(setup.climberCrop ?? DEFAULT_CROP);
          setWallCrop(setup.wallCrop ?? DEFAULT_CROP);
          setPanning(!!setup.panning);
          if (typeof setup.setupHash === "string") setCurrentSetupHash(setup.setupHash);
          // Pre-fill the Seed tap: the saved off-hash seed if present, else the
          // in-hash analysis tap so the common first-time case needs no re-tap.
          setSeedTap(setup.seedTap ?? setup.climberPoint ?? null);
        }

        // Any previously-authored Ground Truth is carried onto the next seed.
        try {
          const gt = await loadGroundTruth(item.key);
          if (revoked) return;
          existingGtRef.current = gt;
          setTruthAccepted(hasAcceptedGroundTruth(gt));
          setTruthSetupHash(typeof gt?.setupHash === "string" ? gt.setupHash : "");
        } catch {
          if (revoked) return;
          existingGtRef.current = null;
          setTruthAccepted(false);
          setTruthSetupHash("");
        }
      } catch (err) {
        if (!revoked) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.key]);

  const requestViTPoseForGrid = useCallback(
    (grid: DetectionGridFrame[]) => {
      if (grid.length === 0) return;
      vitposeRequestedRef.current = grid;
      setVitpose(null);
      setVitposeError(null);
      setVitposeWarnings([]);
      setGtSeed(null);
      setControlPoints(new Map());
      setGtSave(null);
      setVitposeStatus("requesting");
      void (async () => {
        try {
          // The off-hash Seed tap seeds the ViTPose job; the acquisition region
          // is derived from it, so the seed no longer depends on the Climber Crop.
          const seed = seedTap ?? undefined;
          await requestViTPoseScaffold(item.key, {
            videoPath: item.videoPath,
            seedTap: seed,
            seedRegion: deriveSeedRegion(seed ?? null),
            climberCrop,
            wallCrop,
            panning,
            frames: grid.map((f) => ({ timestamp: f.timestamp })),
          });
          if (vitposeRequestedRef.current === grid) setVitposeStatus("polling");
        } catch (err) {
          if (vitposeRequestedRef.current !== grid) return;
          setVitposeStatus("failed");
          setVitposeError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [item.key, item.videoPath, seedTap, climberCrop, wallCrop, panning],
  );

  // Confirm: persist the Seed tap off-hash (crops + `setupHash` untouched), then
  // ask the downloader to pose the Detection Frame grid. The review opens straight
  // away and shows the seed's progress; no detection runs here at all (ADR 0018).
  const saveAndSeed = useCallback(async () => {
    if (gridFrames.length === 0) return;
    setPhase("saving");
    setPhaseError(null);
    try {
      await saveSeedTap(item.key, seedTap);
    } catch (err) {
      setPhase("error");
      setPhaseError(err instanceof Error ? err.message : String(err));
      return;
    }
    setGtFrameIndex(0);
    setPhase("review");
    requestViTPoseForGrid(gridFrames);
  }, [gridFrames, item.key, seedTap, requestViTPoseForGrid]);

  // Enter the flag review straight from the seed-ready scaffold on disk: no
  // ViTPose POST, no waiting. The seeding effect below carries prior flags
  // forward by timestamp exactly as a job-based re-seed would.
  const handleReviewSeed = useCallback(() => {
    if (!probedScaffold) return;
    vitposeRequestedRef.current = null; // abandon any in-flight job's completion
    setVitpose(probedScaffold);
    setVitposeError(null);
    setVitposeWarnings(probedWarnings);
    setGtSeed(null);
    setControlPoints(new Map());
    setGtSave(null);
    setVitposeStatus("ready");
    setGtFrameIndex(0);
    setPhase("review");
  }, [probedScaffold, probedWarnings]);

  // Poll the bundle for the ViTPose artifact once the job has been accepted, and
  // convert it to the seed poses once it lands.
  useEffect(() => {
    if (vitposeStatus !== "polling") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + VITPOSE_POLL_TIMEOUT_MS;

    const fail = (message: string) => {
      setVitposeStatus("failed");
      setVitposeError(message);
      setVitposeWarnings([]);
      setVitpose(null);
      setGtSeed(null);
      setControlPoints(new Map());
      setGtSave(null);
    };

    const poll = async () => {
      try {
        const { scaffold, error, warnings, seedFound } = await loadViTPose(item.key);
        if (cancelled) return;
        if (scaffold) {
          if (!scaffoldHasPose(scaffold)) return fail(noClimberMessage(seedFound));
          setVitpose(scaffold);
          setVitposeWarnings(warnings);
          setVitposeStatus("ready");
          return;
        }
        if (error) return fail(error);
        if (Date.now() >= deadline) return fail("The ViTPose job timed out.");
        timer = setTimeout(poll, 2000);
      } catch (err) {
        if (cancelled) return;
        fail(err instanceof Error ? err.message : String(err));
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [vitposeStatus, item.key]);

  // Seed Ground Truth once the Detection Frame grid and the ViTPose seed are both
  // ready. `gtSeed` is the pure scaffold; working control points are
  // reconstructed from any prior truth carried forward onto this seed by
  // timestamp.
  useEffect(() => {
    if (
      phase !== "review" ||
      vitposeStatus !== "ready" ||
      seedPoseFrames.length === 0 ||
      gridFrames.length === 0
    ) {
      return;
    }
    const seedHash = vitpose?.setupHash || currentSetupHash;
    const pureScaffold = buildGroundTruthScaffold(gridFrames, seedPoseFrames, seedHash, null);
    const carried = buildGroundTruthScaffold(
      gridFrames,
      seedPoseFrames,
      seedHash,
      existingGtRef.current,
    );
    setGtSeed(pureScaffold);
    setControlPoints(reconstructControlPoints(carried.frames));
    setGtSave(null);
  }, [phase, vitposeStatus, seedPoseFrames, gridFrames, currentSetupHash, vitpose]);

  const handleRetryViTPose = useCallback(() => {
    requestViTPoseForGrid(gridFrames);
  }, [gridFrames, requestViTPoseForGrid]);

  const plantControlPoint = useCallback((index: number, flag: ReviewFlag) => {
    setControlPoints((prev) => {
      const next = new Map(prev);
      next.set(index, flag);
      return next;
    });
    setGtSave(null);
  }, []);

  const handleResetToSeed = useCallback(() => {
    setControlPoints(new Map());
    setGtSave(null);
  }, []);

  const gtWorkingFrames = useMemo(
    () => (gtSeed ? materializeReview(gtSeed.frames, controlPoints) : []),
    [gtSeed, controlPoints],
  );

  const derivedFlags = useMemo(
    () => (gtSeed ? deriveFrameFlags(gtSeed.frames, controlPoints) : new Map<number, ReviewFlag>()),
    [gtSeed, controlPoints],
  );

  const wrongStretches = useMemo(
    () => (gtSeed ? enumerateWrongStretches(gtSeed.frames, controlPoints) : []),
    [gtSeed, controlPoints],
  );

  const gtMarkByIndex = useMemo(() => {
    const byIndex = new Map<number, FrameReviewMark>();
    for (const f of gtWorkingFrames) byIndex.set(f.frameIndex, frameReviewMark(f));
    return gridFrames.map((_, i) => byIndex.get(i));
  }, [gtWorkingFrames, gridFrames]);

  const seedCoverage = useMemo(() => countSeedCoverage(gtWorkingFrames), [gtWorkingFrames]);

  const handleSaveGt = useCallback(async () => {
    if (!gtSeed) return;
    setGtSaving(true);
    setGtSave(null);
    try {
      const setupHash = gtSeed.setupHash || vitpose?.setupHash || currentSetupHash;
      // The export gate (harness issue #21): truth must stamp the hash of the
      // scaffold actually used, and that scaffold must belong to the current
      // calibration — otherwise the accepted truth pairs with no future run.
      if (scaffoldIsStale(setupHash, currentSetupHash)) {
        setGtSave({
          ok: false,
          message: "The seed is from an older calibration — re-run ViTPose before accepting.",
        });
        return;
      }
      const input: GroundTruthInput = {
        setupHash,
        frames: materializeReview(gtSeed.frames, controlPoints).map((f) => ({
          ...f,
          verified: true,
        })),
      };
      const saved = await saveGroundTruth(item.key, input);
      const savedInput: GroundTruthInput = { setupHash: saved.setupHash, frames: saved.frames };
      existingGtRef.current = savedInput;
      setTruthAccepted(hasAcceptedGroundTruth(savedInput));
      setTruthSetupHash(saved.setupHash);
      setGtSave({ ok: true, message: "Ground Truth saved." });
    } catch (err) {
      setGtSave({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setGtSaving(false);
    }
  }, [gtSeed, controlPoints, item.key, currentSetupHash, vitpose]);

  // Return to the seed-tap view from the review, keeping the saved Setup in
  // place. Any in-flight seed is abandoned; the saved truth stands.
  function handleBackToSeed() {
    setPhaseError(null);
    setVitpose(null);
    setVitposeStatus("idle");
    setVitposeError(null);
    vitposeRequestedRef.current = null;
    setPhase("idle");
  }

  if (loadError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-danger">{loadError}</p>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md bg-surface-alt px-3 py-1.5 text-sm text-fg"
        >
          Back to corpus
        </button>
      </main>
    );
  }

  if (!videoUrl || !videoMeta) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-fg-muted">Loading {item.videoKey}…</p>
      </main>
    );
  }

  // ── Ground Truth review over the seeded Detection Frame grid ──
  if (phase === "review") {
    const gtSeedFrame = gtSeed?.frames.find((f) => f.frameIndex === gtFrameIndex) ?? null;
    const gtFlag = derivedFlags.get(gtFrameIndex) ?? "auto";
    const gtInheritedFrom = gtSeed
      ? (governingControlPoint(gtSeed.frames, controlPoints, gtFrameIndex)?.timestamp ?? null)
      : null;
    const reviewing = gtGate.authoring === "ready" && gtSeedFrame !== null;

    return (
      <div className="flex h-[calc(100dvh-var(--nav-h))] min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge/30 bg-surface px-4 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-fg">{item.routeFolder}</div>
            <div className="truncate font-mono text-xs text-fg-muted">{item.videoKey}</div>
          </div>
          <div className="flex items-center gap-2">
            {gtSave && (
              <span
                className={`max-w-xs truncate text-xs ${gtSave.ok ? "text-send" : "text-danger"}`}
              >
                {gtSave.message}
              </span>
            )}
            {gtGate.authoring === "ready" && (
              <>
                <GroundTruthSeedStatus
                  gate={gtGate}
                  posedCount={vitposePosedCount}
                  frameCount={vitpose?.frames.length ?? 0}
                  onRetry={handleRetryViTPose}
                />
                <span
                  className="shrink-0 text-xs tabular-nums text-fg-muted"
                  title="Seed coverage: posed frames vs. frames seeded absent"
                >
                  {seedCoverage.posed} posed · {seedCoverage.seededAbsent} seeded absent
                </span>
                <button
                  type="button"
                  onClick={handleResetToSeed}
                  disabled={gtSaving || controlPoints.size === 0}
                  title="Discard every Wrong/Auto flag and reset to the pure ViTPose scaffold — un-saved until you Accept, so leaving without saving reverts it"
                  className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg disabled:opacity-50"
                >
                  Discard flags — reset to seed
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveGt()}
                  disabled={gtSaving || !gtSeed}
                  className="shrink-0 rounded-md bg-send px-3 py-1.5 text-xs font-medium text-fg-inverse disabled:opacity-50"
                >
                  {gtSaving ? "Saving…" : "Accept & save Ground Truth"}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleBackToSeed}
              className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg"
            >
              Back to seed
            </button>
            <button
              type="button"
              onClick={() => void onDone()}
              className="shrink-0 rounded-md bg-send px-3 py-1.5 text-xs font-medium text-fg-inverse"
            >
              Back to corpus
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 bg-surface p-3">
          {reviewing && (
            <DetectionFrameStepper
              frames={gridFrames}
              thumbnails={gridThumbnails}
              frameMarks={gtMarkByIndex}
              wrongStretches={wrongStretches}
              currentIndex={gtFrameIndex}
              onSeek={setGtFrameIndex}
              className="shrink-0"
            />
          )}
          {vitposeWarnings.length > 0 && (
            <div
              role="status"
              className="shrink-0 rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-xs text-caution"
            >
              <p className="font-medium">
                The ViTPose run reported {vitposeWarnings.length === 1 ? "a warning" : "warnings"}:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {vitposeWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {reviewing ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-edge/30 bg-surface p-3">
              <GroundTruthReviewer
                videoSrc={videoUrl}
                videoWidth={videoMeta.width}
                videoHeight={videoMeta.height}
                seedFrame={gtSeedFrame}
                flag={gtFlag}
                inheritedFrom={gtInheritedFrom}
                contextKeypoints={contextKeypointsAt(seedPoseFrames, gtSeedFrame.timestamp)}
                onFlagChange={(flag) => plantControlPoint(gtSeedFrame.frameIndex, flag)}
              />
            </div>
          ) : gtGate.authoring === "disabled" ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-8">
              <GroundTruthSeedStatus
                gate={gtGate}
                posedCount={vitposePosedCount}
                frameCount={vitpose?.frames.length ?? 0}
                onRetry={handleRetryViTPose}
                className="max-w-md"
              />
            </div>
          ) : (
            <div
              role="status"
              className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
            >
              <LoadingSpinner />
              <p className="text-sm text-fg-secondary">
                Seeding Ground Truth from ViTPose over {gridFrames.length} Detection Frames…
              </p>
              <p className="text-xs text-fg-muted">
                The Seed tap is saved. This runs on the downloader; review opens when it lands.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Seed-tap view (idle) ──
  const busy = phase === "saving";
  const phaseLabel: Record<RunPhase, string> = {
    idle: "",
    saving: "Seeding…",
    review: "",
    done: "",
    error: phaseError ?? "Error",
  };
  const showReviewShortcut = truthStale && reseedAffordance === "review-seed";

  return (
    <div className="flex h-[calc(100dvh-var(--nav-h))] min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge/30 bg-surface px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{item.routeFolder}</div>
          <div className="truncate font-mono text-xs text-fg-muted">{item.videoKey}</div>
        </div>
        <div className="flex items-center gap-2">
          {phase !== "idle" && (
            <span className={`text-xs ${phase === "error" ? "text-danger" : "text-fg-muted"}`}>
              {phaseLabel[phase]}
            </span>
          )}
          {showReviewShortcut && (
            <button
              type="button"
              onClick={handleReviewSeed}
              disabled={busy || gridFrames.length === 0}
              className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg disabled:opacity-50"
              title="A fresh ViTPose scaffold is already on disk — open the flag review from it directly, no new job, flags carried forward by timestamp"
            >
              Review seed
            </button>
          )}
          <button
            type="button"
            onClick={() => void saveAndSeed()}
            disabled={busy || gridFrames.length === 0}
            className="shrink-0 rounded-md bg-send px-3 py-1.5 text-xs font-medium text-fg-inverse disabled:opacity-50"
            title={
              showReviewShortcut
                ? "Force a fresh ViTPose job even though the on-disk scaffold is usable — carries your flags forward by timestamp"
                : "Persist the Seed tap off-hash and run ViTPose over the Detection Frame grid, then review"
            }
          >
            {truthAccepted ? "Re-seed Ground Truth" : "Seed Ground Truth"}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg"
          >
            Back to corpus
          </button>
        </div>
      </div>

      {truthStale ? (
        <div
          role="status"
          className="mx-4 mt-2 shrink-0 rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-xs text-caution"
        >
          This video&apos;s Ground Truth was accepted under an older calibration — it pairs with no
          run scanned under the current Setup, so it is stale evidence.{" "}
          {reseedAffordance === "review-seed"
            ? "A fresh ViTPose scaffold is already on disk: use Review seed to go straight to the review and re-accept — no new job needed."
            : "Use Re-seed Ground Truth to re-run ViTPose and re-accept."}{" "}
          Your Wrong/Absent flags carry forward by timestamp.
        </div>
      ) : truthAccepted ? (
        <div
          role="status"
          className="mx-4 mt-2 shrink-0 rounded-md border border-edge/30 bg-surface-alt px-3 py-2 text-xs text-fg-muted"
        >
          This video has accepted Ground Truth paired to the current Setup. Re-seeding re-runs
          ViTPose from the Seed tap and carries your flags forward — the Seed tap is off-hash, so it
          never changes the Setup&apos;s hash or unpairs prior runs.
        </div>
      ) : (
        <div
          role="status"
          className="mx-4 mt-2 shrink-0 rounded-md border border-edge/30 bg-surface-alt px-3 py-2 text-xs text-fg-muted"
        >
          Scrub to a later frame where the climber is unambiguous and tap them — that Seed tap seeds
          the ViTPose job (the tracker follows it backward). Then Seed Ground Truth.
        </div>
      )}
      {legacyTapNoTimestamp && (
        <div
          role="status"
          className="mx-4 mt-2 shrink-0 rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-xs text-caution"
        >
          The pre-filled Seed tap has no frame timestamp (legacy) — ViTPose can only seed by tap
          position and may pose the wrong person when bystanders are present. Re-tap the climber to
          record the frame time and fix the seed.
        </div>
      )}
      <div className="min-h-0 flex-1">
        <SeedTapEditor
          videoSrc={videoUrl}
          seedTap={seedTap}
          onSeedTapChange={setSeedTap}
          disabled={busy}
        />
      </div>
    </div>
  );
}
