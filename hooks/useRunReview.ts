"use client";

/**
 * Load one Bundle's posted evidence for review: the video, its accepted Ground
 * Truth, the list of runs on disk, and the payload of whichever run is
 * selected.
 *
 * Everything here comes off the corpus rather than out of React state, which is
 * the point — a batch-posted run and a manually-analyzed one are the same file
 * on disk, so the reviewer shows both identically and survives a reload. The
 * run list is deliberately separate from the run payload: the list is small and
 * loads with the Bundle, while the payload carries dense pose frames and
 * detector attempts and is fetched only for the run being looked at.
 *
 * The hook owns the async lifecycle and error boundaries; `RunReviewer` renders
 * what it returns.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { probeVideoMeta, type VideoMeta } from "@/utils/probeVideoMeta";
import { loadGroundTruth, type GroundTruth } from "@/utils/harnessGroundTruth";
import { listRuns, loadRun, type HarnessRunSummary } from "@/utils/harnessRuns";
import type { HarnessPosePayload } from "@/utils/harnessPayloads";

export interface RunReview {
  /** True until the video, truth and run list have all settled. */
  loading: boolean;
  /** Fatal load failure — the video could not be fetched or probed. */
  loadError: string | null;
  videoUrl: string | null;
  videoMeta: VideoMeta | null;
  /** The Bundle's accepted Ground Truth, or null when it has none. */
  groundTruth: GroundTruth | null;
  /** Every run on disk, newest first. */
  runs: HarnessRunSummary[];
  /** The selected run's summary, or null when the Bundle has no runs. */
  selected: HarnessRunSummary | null;
  selectRun: (runTs: string) => void;
  /** The selected run's payload; null while loading or on failure. */
  payload: HarnessPosePayload | null;
  runLoading: boolean;
  /** Why the selected run would not open — a malformed or truncated file. */
  runError: string | null;
}

/**
 * The run to open by default: the newest that pairs with the Bundle's current
 * Ground Truth, since that is the only run whose verdicts are evidence about
 * the current calibration. Falls back to the newest run at all, so an unpaired
 * or truthless Bundle is still inspectable — it is just never the default when
 * a paired run exists. Malformed files are never defaulted to; they cannot open.
 */
export function defaultRunTs(runs: readonly HarnessRunSummary[]): string | null {
  const openable = runs.filter((r) => !r.malformed);
  const paired = openable.find((r) => r.pairsWithTruth);
  return (paired ?? openable[0] ?? runs[0])?.runTs ?? null;
}

export function useRunReview(bundleKey: string): RunReview {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [groundTruth, setGroundTruth] = useState<GroundTruth | null>(null);
  const [runs, setRuns] = useState<HarnessRunSummary[]>([]);
  const [selectedRunTs, setSelectedRunTs] = useState<string | null>(null);
  const [payload, setPayload] = useState<HarnessPosePayload | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // The Bundle: video bytes, accepted truth, and the run list. Truth and the
  // list are non-fatal — a Bundle with neither is still worth opening to see
  // that it has nothing — but the video is what everything is drawn on.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const res = await fetch(`/api/dev/corpus/video?key=${encodeURIComponent(bundleKey)}`);
        if (!res.ok) throw new Error("Failed to load video.");
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        if (cancelled) return;
        setVideoUrl(url);
        const meta = await probeVideoMeta(url);
        if (cancelled) return;
        setVideoMeta(meta);

        const [truth, list] = await Promise.all([
          loadGroundTruth(bundleKey).catch(() => null),
          listRuns(bundleKey).catch(() => [] as HarnessRunSummary[]),
        ]);
        if (cancelled) return;
        setGroundTruth(truth);
        setRuns(list);
        setSelectedRunTs(defaultRunTs(list));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [bundleKey]);

  // The selected run's payload. Refetched per selection rather than cached:
  // these are the tens-of-megabytes artifacts, and holding several would cost
  // more than re-reading the one being looked at.
  useEffect(() => {
    if (!selectedRunTs) {
      setPayload(null);
      setRunError(null);
      return;
    }
    let cancelled = false;
    setRunLoading(true);
    setRunError(null);
    setPayload(null);

    (async () => {
      try {
        const loaded = await loadRun(bundleKey, selectedRunTs);
        if (!cancelled) setPayload(loaded);
      } catch (err) {
        if (!cancelled) setRunError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setRunLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bundleKey, selectedRunTs]);

  const selectRun = useCallback((runTs: string) => setSelectedRunTs(runTs), []);

  const selected = useMemo(
    () => runs.find((r) => r.runTs === selectedRunTs) ?? null,
    [runs, selectedRunTs],
  );

  return {
    loading,
    loadError,
    videoUrl,
    videoMeta,
    groundTruth,
    runs,
    selected,
    selectRun,
    payload,
    runLoading,
    runError,
  };
}
