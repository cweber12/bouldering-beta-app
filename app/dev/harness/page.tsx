"use client";

/**
 * Dev-only detection eval harness — manual calibration pass.
 *
 * Lists the external downloader's Test Video corpus (via /api/dev/corpus) and
 * lets you calibrate each video's Scan Setup — Climber Crop, Wall Crop, tap,
 * panning, Quality Tier — by reusing the production StepSetDetection UI.
 * Confirming saves setup.json and immediately requests the downloader's ViTPose
 * job over the uniform Detection Frame grid, then opens the flag-only Ground
 * Truth review on the seed once it lands. Once truth is accepted, confirming an
 * edited Setup only saves it — the seed and the review are skipped, and
 * "Re-seed Ground Truth" is the explicit way back in. But truth is only valid
 * evidence while its stamped setupHash matches the current Setup's (the harness
 * pairs runs to truth by hash — ADR 0020): a save that changes the hash flips
 * the accepted truth to a visible stale state until it is re-seeded (flags
 * carry forward by timestamp) and re-accepted.
 * Calibration runs no detection at all: it authors truth, and nothing else.
 * Detection output lives in the separate Analyze step, reached per video from
 * the corpus list: it runs the production pipeline against the saved Scan Setup,
 * renders the skeleton + diagnostics, and posts the run. Nothing about it fires
 * off the back of accepting Ground Truth. "Save setup only" persists the Setup
 * without seeding.
 * Rendered only in development. See docs/adr/0017, 0018 and 0019.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDetectionThumbnails } from "@/hooks/useDetectionThumbnails";
import StepSetDetection from "@/components/scan/process-flow/StepSetDetection";
import DetectionFrameStepper from "@/components/dev/DetectionFrameStepper";
import MetadataEditorPanel from "@/components/dev/MetadataEditorPanel";
import GroundTruthReviewer from "@/components/dev/GroundTruthReviewer";
import GroundTruthSeedStatus from "@/components/dev/GroundTruthSeedStatus";
import Analyzer from "@/components/dev/Analyzer";
import BatchAnalyzer from "@/components/dev/BatchAnalyzer";
import { planBatchAnalyze, type BatchAnalyzePlan } from "@/utils/harnessBatch";
import Modal from "@/components/ui/Modal";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import {
  applyReviewFlag,
  buildGroundTruthScaffold,
  contextKeypointsAt,
  countSeedCoverage,
  frameReviewMark,
  hasAcceptedGroundTruth,
  seedGateDecision,
  type FrameReviewMark,
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
  VITPOSE_POLL_TIMEOUT_MS,
  type ViTPoseScaffold,
} from "@/utils/harnessViTPose";
import { buildDetectionGrid, type DetectionGridFrame } from "@/utils/harnessDetectionGrid";
import { scaffoldIsStale, truthIsStale } from "@/utils/harnessFreshness";
import { type CropFraction, DEFAULT_CROP } from "@/utils/cropFraction";
import { frameClampCrop, defaultRouteAroundClimber } from "@/utils/cropContainment";
import { DEFAULT_TIER, getTierConfig, type QualityTier } from "@/utils/poseTiers";
import type { MediaPipeVariant } from "@/hooks/usePoseModel";

const IS_DEV = process.env.NODE_ENV === "development";

/** One Test Video bundle, mirroring the /api/dev/corpus response shape. */
interface CorpusItem {
  key: string;
  routeFolder: string;
  videoKey: string;
  title: string | null;
  videoPath: string;
  hasSetup: boolean;
  hasGroundTruth: boolean;
  /** Truth exists but stamps an older calibration's hash — stale evidence. */
  truthStale: boolean;
  /** A fresh, posed ViTPose scaffold is on disk — review needs no new job. */
  seedReady: boolean;
  runCount: number;
  /** Runs whose stamped hash pairs with no truth — they produce no evidence. */
  unpairedRunCount: number;
  analysisInputs: unknown;
}

/** Native video dimensions + duration, read from the loaded video element. */
interface VideoMeta {
  width: number;
  height: number;
  duration: number;
}

/**
 * Read a video blob's duration and native dimensions without decoding frames.
 * The duration is the sole input to the Detection Frame grid, and the dimensions
 * size the reviewer canvas — both previously came from the throwaway scan.
 */
function probeVideoMeta(url: string): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };
    video.onloadedmetadata = () => {
      const meta = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      };
      cleanup();
      resolve(meta);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Failed to read the video's duration."));
    };
    video.src = url;
  });
}

/** What the corpus list opened a video for — the two acts are kept separate. */
type Selection = { item: CorpusItem; mode: "calibrate" | "analyze" };

export default function HarnessPage() {
  const [items, setItems] = useState<CorpusItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  // A running batch sweep. The plan is frozen at click so a mid-sweep refresh
  // (run counts changing after each post) never reshuffles the queue.
  const [batchPlan, setBatchPlan] = useState<BatchAnalyzePlan<CorpusItem> | null>(null);
  const batchPreview = useMemo(() => (items ? planBatchAnalyze(items) : null), [items]);

  const refreshList = useCallback(async () => {
    setListError(null);
    try {
      const res = await fetch("/api/dev/corpus");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load corpus.");
      setItems(body.items as CorpusItem[]);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (IS_DEV) void refreshList();
  }, [refreshList]);

  if (!IS_DEV) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-fg-muted">
          The detection eval harness is only available in development.
        </p>
      </main>
    );
  }

  if (batchPlan) {
    return (
      <BatchAnalyzer
        plan={batchPlan}
        onBack={() => {
          setBatchPlan(null);
          void refreshList();
        }}
        onPosted={refreshList}
      />
    );
  }

  if (selected?.mode === "analyze") {
    return (
      <Analyzer
        item={selected.item}
        onBack={() => setSelected(null)}
        // A posted run changes the run count; keep the Analyze view open so the
        // rendered result stays on screen.
        onDone={refreshList}
      />
    );
  }

  if (selected) {
    return (
      <Calibrator
        item={selected.item}
        onBack={() => setSelected(null)}
        onDone={async () => {
          await refreshList();
          setSelected(null);
        }}
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-fg">Detection eval harness</h1>
          <p className="text-sm text-fg-muted">
            Calibrate each Test Video&apos;s Scan Setup, then re-run detection in batch.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshList()}
            className="rounded-md bg-surface-alt px-3 py-1.5 text-sm text-fg"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => batchPreview && setBatchPlan(batchPreview)}
            disabled={!batchPreview || batchPreview.queue.length === 0}
            title="Run Analyze over every video with accepted Ground Truth, one after another"
            className="rounded-md bg-send px-3 py-1.5 text-sm font-medium text-fg-inverse disabled:opacity-50"
          >
            Batch Analyze{batchPreview ? ` (${batchPreview.queue.length})` : ""}
          </button>
        </div>
      </header>

      {listError && (
        <p className="rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
          {listError}
        </p>
      )}

      {items === null ? (
        <p className="text-sm text-fg-muted">Loading corpus…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No Test Videos found. Check that HARNESS_ANALYSIS_ROOT points at the downloader&apos;s
          analysis folder.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge/40 text-left text-fg-muted">
                <th className="py-2 pr-3 font-medium">route / video</th>
                <th className="py-2 pr-3 font-medium">title</th>
                <th className="py-2 pr-3 font-medium">setup</th>
                <th className="py-2 pr-3 font-medium">truth</th>
                <th className="py-2 pr-3 font-medium tabular-nums">runs</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key} className="border-b border-edge/20 align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-fg">{it.routeFolder}</div>
                    <div className="font-mono text-xs text-fg-muted">{it.videoKey}</div>
                  </td>
                  <td className="max-w-xs py-2 pr-3 text-fg-muted">{it.title ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {it.hasSetup ? (
                      <span className="rounded bg-send-surface px-1.5 py-0.5 text-xs text-send">
                        calibrated
                      </span>
                    ) : (
                      <span className="rounded bg-caution-surface px-1.5 py-0.5 text-xs text-caution">
                        pending
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {!it.hasGroundTruth ? (
                      <span className="rounded bg-caution-surface px-1.5 py-0.5 text-xs text-caution">
                        none
                      </span>
                    ) : it.truthStale && it.seedReady ? (
                      <span
                        className="rounded bg-caution-surface px-1.5 py-0.5 text-xs text-caution"
                        title="Annotations were accepted under an older calibration, but a fresh ViTPose scaffold is already on disk — open the calibrator to review and re-accept, no new job needed"
                      >
                        stale · seed ready
                      </span>
                    ) : it.truthStale ? (
                      <span
                        className="rounded bg-caution-surface px-1.5 py-0.5 text-xs text-caution"
                        title="Annotations were accepted under an older calibration — re-run ViTPose and re-accept"
                      >
                        stale
                      </span>
                    ) : (
                      <span className="rounded bg-send-surface px-1.5 py-0.5 text-xs text-send">
                        accepted
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-fg">
                    {it.runCount}
                    {it.unpairedRunCount > 0 && (
                      <span
                        className="ml-1 text-xs text-caution"
                        title="Runs whose stamped setupHash pairs with no Ground Truth — they produce no evaluation evidence"
                      >
                        · {it.unpairedRunCount} unpaired
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected({ item: it, mode: "calibrate" })}
                        className="rounded-md bg-send/80 px-3 py-1.5 text-xs font-medium text-fg-inverse"
                      >
                        {it.hasSetup ? "Re-calibrate" : "Calibrate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelected({ item: it, mode: "analyze" })}
                        disabled={!it.hasSetup}
                        title={
                          it.hasSetup
                            ? "Run the production detection pipeline with this video's Scan Setup"
                            : "Calibrate a Scan Setup before analyzing"
                        }
                        className="rounded-md bg-surface-alt px-3 py-1.5 text-xs font-medium text-fg disabled:opacity-50"
                      >
                        Analyze
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Calibrator — loads a Test Video + its Setup, reuses StepSetDetection to
// author the Scan Setup, and on confirm saves it and kicks off the downloader's
// ViTPose scaffold job (ADR 0019) over the uniform Detection Frame grid computed
// from the video's duration. The ViTPose poses seed the flag-only Ground Truth
// review. If that job fails or no downloader is configured, review is gated
// until it is retried successfully — the Setup save stands regardless.
// ---------------------------------------------------------------------------

type RunPhase = "idle" | "saving" | "review" | "done" | "error";

function Calibrator({
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

  const [tier, setTier] = useState<QualityTier>(DEFAULT_TIER);
  const [modelVariant, setModelVariant] = useState<MediaPipeVariant>(
    getTierConfig(DEFAULT_TIER).variant,
  );
  const [frameStep, setFrameStep] = useState(getTierConfig(DEFAULT_TIER).frameStep);
  const [climberCrop, setClimberCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [wallCrop, setWallCrop] = useState<CropFraction>(DEFAULT_CROP);
  const [climberPoint, setClimberPoint] = useState<
    { x: number; y: number; t?: number } | null
  >(null);
  const [panning, setPanning] = useState(false);
  const wallTouchedRef = useRef(false);

  // Editable condition labels — seeded from the legacy metadata.json passthrough
  // at mount, then overridden by setup.json.analysisInputs once the Setup loads.
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [analysisInputs, setAnalysisInputs] = useState<unknown>(item.analysisInputs);

  // Ground Truth review: the pure scaffold seed, the working flag review, and
  // any previously-saved GT carried onto a re-seed by timestamp. The ref is what
  // seeding reads (so saving truth never re-triggers the seed effect); the flag
  // mirrors it for render — accepted truth is what makes setup edits skip the
  // seed entirely.
  const existingGtRef = useRef<GroundTruthInput | null>(null);
  const [truthAccepted, setTruthAccepted] = useState(false);
  /** The saved truth's stamped setupHash ("" legacy) — drives the stale state. */
  const [truthSetupHash, setTruthSetupHash] = useState("");
  const [gtSeed, setGtSeed] = useState<GroundTruthInput | null>(null);
  const [gtInput, setGtInput] = useState<GroundTruthInput | null>(null);
  const [gtSave, setGtSave] = useState<{ ok: boolean; message: string } | null>(null);
  const [gtSaving, setGtSaving] = useState(false);
  const [currentSetupHash, setCurrentSetupHash] = useState("");

  // ViTPose scaffold (ADR 0019): the downloader runs a stronger reference model
  // that seeds the Ground Truth landmarks. Kicked off the moment the Setup is
  // confirmed and polled until `vitpose.json` lands in the bundle. The Detection
  // Frame grid is pure arithmetic over the video's duration; ViTPose supplies the
  // poses on it.
  const [vitpose, setVitpose] = useState<ViTPoseScaffold | null>(null);
  const [vitposeStatus, setVitposeStatus] = useState<
    "idle" | "requesting" | "polling" | "ready" | "failed"
  >("idle");
  const [vitposeError, setVitposeError] = useState<string | null>(null);
  // Non-fatal advisories the downloader attaches to a completed run (legacy tap
  // without a timestamp, ambiguous t=0 tap). Surfaced as a caution in the review.
  const [vitposeWarnings, setVitposeWarnings] = useState<string[]>([]);
  // The Detection Frame grid a ViTPose job has already been kicked off for. Held
  // so a superseded request's async completion can be ignored rather than
  // overwriting the live one's status.
  const vitposeRequestedRef = useRef<DetectionGridFrame[] | null>(null);
  const vitposePoseFrames = useMemo(
    () => (vitpose ? viTPoseToPoseFrames(vitpose) : []),
    [vitpose],
  );
  // How many Detection Frames the ViTPose seed actually posed (vs. tracked-empty),
  // surfaced in the review so the seed source and its coverage are visible.
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
  // pairs with no run scanned under this calibration, so it must read as stale
  // — never as healthy — until ViTPose is re-run and the truth re-accepted.
  const truthStale = truthAccepted && truthIsStale(truthSetupHash, currentSetupHash);

  // A Climber tap from a setup calibrated before the tap-timestamp contract: the
  // downloader can only seed by global tap position, which grabs a bystander who
  // ever crosses that spot. Re-tapping the Climber writes `t` and fixes it.
  const legacyTapNoTimestamp = climberPoint != null && climberPoint.t === undefined;

  // The Detection Frame grid: uniform 100 ms stride over the video's duration,
  // independent of the Setup, the tier, and any detector (ADR 0018).
  const gridFrames = useMemo(
    () => (videoMeta ? buildDetectionGrid(videoMeta.duration) : []),
    [videoMeta],
  );

  // Film-strip thumbnails for the stepper — generated lazily off the video only
  // while the review is on screen.
  const gridThumbnails = useDetectionThumbnails(videoUrl, gridFrames, phase === "review");

  function handleTierChange(t: QualityTier) {
    setTier(t);
    const cfg = getTierConfig(t);
    setModelVariant(cfg.variant);
    setFrameStep(cfg.frameStep);
  }

  // Load the video bytes + any existing Scan Setup for this bundle.
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
        // The duration is what the Detection Frame grid is built from, so the
        // calibrator is not usable until the metadata has been read.
        const meta = await probeVideoMeta(url);
        if (revoked) return;
        setVideoMeta(meta);

        const { setup } = await setupRes.json();
        if (setup && !revoked) {
          setClimberCrop(setup.climberCrop ?? DEFAULT_CROP);
          setWallCrop(setup.wallCrop ?? DEFAULT_CROP);
          setClimberPoint(setup.climberPoint ?? null);
          setPanning(!!setup.panning);
          if (typeof setup.setupHash === "string") setCurrentSetupHash(setup.setupHash);
          if (typeof setup.qualityTier === "string")
            handleTierChange(setup.qualityTier as QualityTier);
          // Labels now live in the Setup; prefer them over the legacy
          // metadata.json passthrough seeded at mount.
          if (setup.analysisInputs) setAnalysisInputs(setup.analysisInputs);
          wallTouchedRef.current = true; // preserve the saved wall crop across a re-tap
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

  // The Climber Crop is drawn by hand here: the calibrator loads no pose model,
  // so there is nothing to derive a box from the tap with. The Wall Crop still
  // auto-follows the Climber Crop until the author moves it themselves.
  const handleClimberCropChange = useCallback((c: CropFraction) => {
    setClimberCrop(c);
    setWallCrop((prev) => (wallTouchedRef.current ? prev : defaultRouteAroundClimber(c)));
  }, []);

  const handleClimberPointChange = useCallback(
    (p: { x: number; y: number; t?: number } | null) => {
    if (p === null) wallTouchedRef.current = false;
    setClimberPoint(p);
    },
    [],
  );

  const handleWallCropChange = useCallback((c: CropFraction) => {
    wallTouchedRef.current = true;
    setWallCrop(frameClampCrop(c));
  }, []);

  /** PUT setup.json; returns the authoritative setupHash, or null on failure. */
  const saveSetup = useCallback(async (): Promise<string | null> => {
    const res = await fetch(`/api/dev/corpus/setup?key=${encodeURIComponent(item.key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ climberCrop, wallCrop, climberPoint, panning, qualityTier: tier }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Failed to save setup.");
    const setupHash = typeof body.setup?.setupHash === "string" ? body.setup.setupHash : null;
    setCurrentSetupHash(setupHash ?? "");
    return setupHash;
  }, [item.key, climberCrop, wallCrop, climberPoint, panning, tier]);

  // Save the Setup only, without a baseline run (quick calibration).
  async function handleSaveOnly() {
    setPhase("saving");
    setPhaseError(null);
    try {
      await saveSetup();
      setPhase("done");
      await onDone();
    } catch (err) {
      setPhase("error");
      setPhaseError(err instanceof Error ? err.message : String(err));
    }
  }

  const requestViTPoseForGrid = useCallback(
    (grid: DetectionGridFrame[]) => {
      if (grid.length === 0) return;
      vitposeRequestedRef.current = grid;
      setVitpose(null);
      setVitposeError(null);
      setVitposeWarnings([]);
      setGtSeed(null);
      setGtInput(null);
      setGtSave(null);
      setVitposeStatus("requesting");
      void (async () => {
        try {
          await requestViTPoseScaffold(item.key, {
            videoPath: item.videoPath,
            climberPoint: climberPoint ?? undefined,
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
    [item.key, item.videoPath, climberPoint, climberCrop, wallCrop, panning],
  );

  // Save the Scan Setup, then ask the downloader to pose the Detection Frame
  // grid. The review opens straight away and shows the seed's progress; no
  // detection runs here at all (ADR 0018). The downloader echoes the grid's
  // timestamps, so the seed aligns frame-for-frame (ADR 0019).
  const saveAndSeed = useCallback(async () => {
    if (gridFrames.length === 0) return;
    setPhase("saving");
    setPhaseError(null);
    try {
      await saveSetup();
    } catch (err) {
      setPhase("error");
      setPhaseError(err instanceof Error ? err.message : String(err));
      return;
    }
    setGtFrameIndex(0);
    setPhase("review");
    requestViTPoseForGrid(gridFrames);
  }, [gridFrames, saveSetup, requestViTPoseForGrid]);

  // Confirm: Ground Truth is video-keyed, so on a video that already has accepted
  // truth this only saves the edited Scan Setup — no ViTPose job, no review, and
  // the truth file is left untouched (re-seeding is an explicit act). Without
  // truth yet, confirming is what seeds it.
  async function handleConfirm() {
    if (truthAccepted) return handleSaveOnly();
    await saveAndSeed();
  }

  // Poll the bundle for the ViTPose artifact once the job has been accepted, and
  // convert it to the seed poses once it lands. Reported job errors, empty
  // Climber tracks, and timeouts gate Ground Truth authoring behind a retry; the
  // Scan Setup save that preceded the job stands either way.
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
      setGtInput(null);
      setGtSave(null);
    };

    const poll = async () => {
      try {
        const { scaffold, error, warnings } = await loadViTPose(item.key);
        if (cancelled) return;
        if (scaffold) {
          // A scaffold with no posed frames means the tracker never found the
          // Climber — disable authoring rather than seed every Detection Frame
          // "absent".
          if (!scaffoldHasPose(scaffold)) return fail("ViTPose tracked no climber.");
          setVitpose(scaffold);
          setVitposeWarnings(warnings);
          setVitposeStatus("ready");
          return;
        }
        // The job died after acceptance (no artifact will ever land).
        if (error) return fail(error);
        // Downloader hung without writing an error sidecar — bail eventually.
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

  // Seed Ground Truth once the Detection Frame grid and the ViTPose seed are
  // both ready: a pure scaffold and a working copy that preserves any previously
  // authored flags. Both key one record per Detection Frame.
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
    const working = buildGroundTruthScaffold(
      gridFrames,
      seedPoseFrames,
      seedHash,
      existingGtRef.current,
    );
    setGtSeed(pureScaffold);
    setGtInput(working);
    setGtSave(null);
  }, [phase, vitposeStatus, seedPoseFrames, gridFrames, currentSetupHash, vitpose]);

  const handleRetryViTPose = useCallback(() => {
    requestViTPoseForGrid(gridFrames);
  }, [gridFrames, requestViTPoseForGrid]);

  // Apply the current Detection Frame's Auto / Wrong / Absent review flag. The
  // immutable seed frame is always the source of truth so unflagging restores it.
  const setGtFrameFlag = useCallback((index: number, flag: "auto" | "wrong" | "absent") => {
    setGtInput((prev) => {
      if (!prev) return prev;
      const seedFrame = gtSeed?.frames.find((f) => f.frameIndex === index);
      if (!seedFrame) return prev;
      return {
        ...prev,
        frames: prev.frames.map((f) => (f.frameIndex === index ? applyReviewFlag(seedFrame, flag) : f)),
      };
    });
    setGtSave(null);
  }, [gtSeed]);

  // Review mark per Detection Frame index, for the filmstrip (flagged / seeded
  // absent distinct from ordinary auto frames).
  const gtMarkByIndex = useMemo(() => {
    const byIndex = new Map<number, FrameReviewMark>();
    for (const f of gtInput?.frames ?? []) byIndex.set(f.frameIndex, frameReviewMark(f));
    return gridFrames.map((_, i) => byIndex.get(i));
  }, [gtInput, gridFrames]);

  // Seed coverage surfaced beside the accept button — posed vs. seeded-absent,
  // updating as flags move presence truth. Surfaced only, never blocks accept.
  const seedCoverage = useMemo(
    () => countSeedCoverage(gtInput?.frames ?? []),
    [gtInput],
  );

  const handleSaveGt = useCallback(async () => {
    if (!gtInput) return;
    setGtSaving(true);
    setGtSave(null);
    try {
      const setupHash = gtInput.setupHash || vitpose?.setupHash || currentSetupHash;
      // The export gate (harness issue #21): truth must stamp the hash of the
      // scaffold actually used, and that scaffold must belong to the current
      // calibration — otherwise the accepted truth pairs with no future run.
      // The ground-truth PUT enforces the same check server-side.
      if (scaffoldIsStale(setupHash, currentSetupHash)) {
        setGtSave({
          ok: false,
          message: "The seed is from an older calibration — re-run ViTPose before accepting.",
        });
        return;
      }
      const input: GroundTruthInput = {
        ...gtInput,
        setupHash,
        frames: gtInput.frames.map((f) => ({ ...f, verified: true })),
      };
      const saved = await saveGroundTruth(item.key, input);
      const savedInput: GroundTruthInput = { setupHash: saved.setupHash, frames: saved.frames };
      existingGtRef.current = savedInput;
      setTruthAccepted(hasAcceptedGroundTruth(savedInput));
      setTruthSetupHash(saved.setupHash);
      setGtInput(savedInput);
      setGtSave({ ok: true, message: "Ground Truth saved." });
    } catch (err) {
      setGtSave({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setGtSaving(false);
    }
  }, [gtInput, item.key, currentSetupHash, vitpose]);

  // Return to the Setup from the review, keeping the current Setup in place. Any
  // in-flight seed is abandoned; the saved Setup and saved truth both stand.
  function handleBackToSetup() {
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
    const gtFrame = gtInput?.frames.find((f) => f.frameIndex === gtFrameIndex) ?? null;
    const gtSeedFrame = gtSeed?.frames.find((f) => f.frameIndex === gtFrameIndex) ?? null;
    const reviewing = gtGate.authoring === "ready" && gtFrame !== null && gtSeedFrame !== null;

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
                  onClick={() => void handleSaveGt()}
                  disabled={gtSaving || !gtInput}
                  className="shrink-0 rounded-md bg-send px-3 py-1.5 text-xs font-medium text-fg-inverse disabled:opacity-50"
                >
                  {gtSaving ? "Saving…" : "Accept & save Ground Truth"}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleBackToSetup}
              className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg"
            >
              Back to setup
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
                frame={gtFrame}
                seedFrame={gtSeedFrame}
                contextKeypoints={contextKeypointsAt(seedPoseFrames, gtFrame.timestamp)}
                onFlagChange={(flag) => setGtFrameFlag(gtFrame.frameIndex, flag)}
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
            // The seed job is the only thing standing between Confirm and review
            // — calibration itself runs nothing.
            <div
              role="status"
              className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
            >
              <LoadingSpinner />
              <p className="text-sm text-fg-secondary">
                Seeding Ground Truth from ViTPose over {gridFrames.length} Detection Frames…
              </p>
              <p className="text-xs text-fg-muted">
                The Scan Setup is saved. This runs on the downloader; review opens when it lands.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // The review phase returns earlier, so only "saving" is busy here.
  const busy = phase === "saving";
  const phaseLabel: Record<RunPhase, string> = {
    idle: "",
    saving: "Saving setup…",
    review: "",
    done: "Setup saved",
    error: phaseError ?? "Error",
  };

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
          <button
            type="button"
            onClick={() => setMetadataOpen(true)}
            className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg"
          >
            Metadata
          </button>
          <button
            type="button"
            onClick={() => void handleSaveOnly()}
            disabled={busy}
            className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg disabled:opacity-50"
          >
            Save setup only
          </button>
          {truthAccepted && (
            <button
              type="button"
              onClick={() => void saveAndSeed()}
              disabled={busy || gridFrames.length === 0}
              className="shrink-0 rounded-md bg-surface-alt px-3 py-1.5 text-xs text-fg disabled:opacity-50"
              title="Re-run ViTPose over the Detection Frame grid, carrying your flags forward by timestamp"
            >
              Re-seed Ground Truth
            </button>
          )}
        </div>
      </div>

      <Modal
        open={metadataOpen}
        onClose={() => setMetadataOpen(false)}
        ariaLabel="Edit video metadata"
        panelClassName=""
      >
        <MetadataEditorPanel
          bundleKey={item.key}
          initial={analysisInputs}
          onClose={() => setMetadataOpen(false)}
          onSaved={setAnalysisInputs}
        />
      </Modal>

      {truthStale ? (
        <div
          role="status"
          className="mx-4 mt-2 shrink-0 rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-xs text-caution"
        >
          This video&apos;s Ground Truth was accepted under an older calibration — it pairs
          with no run scanned under the current Setup, so it is stale evidence. Use Re-seed
          Ground Truth to re-run ViTPose and re-accept; your Wrong/Absent flags carry
          forward by timestamp.
        </div>
      ) : truthAccepted ? (
        <div
          role="status"
          className="mx-4 mt-2 shrink-0 rounded-md border border-edge/30 bg-surface-alt px-3 py-2 text-xs text-fg-muted"
        >
          This video has accepted Ground Truth paired to the current Setup. Confirming saves
          the Setup only — but a save that changes the Setup&apos;s hash makes the truth
          stale until it is re-seeded and re-accepted. Use Re-seed Ground Truth to re-run
          the seed, carrying your flags forward.
        </div>
      ) : null}
      {legacyTapNoTimestamp && (
        <div
          role="status"
          className="mx-4 mt-2 shrink-0 rounded-md border border-caution-border bg-caution-surface px-3 py-2 text-xs text-caution"
        >
          This setup was calibrated without a tap timestamp (legacy) — ViTPose can only
          seed by tap position and may pose the wrong person when bystanders are present.
          Re-tap the climber to record the frame time and fix the seed.
        </div>
      )}
      <div className="min-h-0 flex-1">
        <StepSetDetection
          videoPreviewUrl={videoUrl}
          climberCrop={climberCrop}
          wallCrop={wallCrop}
          onClimberCropChange={handleClimberCropChange}
          onWallCropChange={handleWallCropChange}
          climberPoint={climberPoint}
          onClimberPointChange={handleClimberPointChange}
          tier={tier}
          onTierChange={handleTierChange}
          modelVariant={modelVariant}
          onModelVariantChange={setModelVariant}
          frameStep={frameStep}
          onFrameStepChange={setFrameStep}
          panning={panning}
          onPanningChange={setPanning}
          canScan={gridFrames.length > 0 && !busy}
          onScan={() => void handleConfirm()}
          onBack={onBack}
        />
      </div>
    </div>
  );
}
