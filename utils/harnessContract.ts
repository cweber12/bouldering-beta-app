/**
 * Harness contract probe — `GET {HARNESS_API_BASE}/api/contract` (relayed via
 * /api/dev/contract) self-describes what the analysis harness speaks: advertised
 * endpoints, artifact schema versions, an apiVersion that bumps only on breaking
 * changes, and whether label suggestions are fit. Harness-facing features gate
 * on this instead of assuming an endpoint exists, and degrade visibly (never a
 * silent mid-calibration 404) when the probe fails or a feature isn't
 * advertised. See the video-stats handoff (`.scratch/video-stats-prefill`).
 *
 * Framework-agnostic — no React imports. The parse + gate helpers are pure and
 * unit-tested; the probe seam is a module-cached fetch over the dev proxy.
 */

/** The contract apiVersion this scanner build was written against. */
export const EXPECTED_HARNESS_API_VERSION = 1;

/** The harness self-description, reduced to what the scanner gates on. */
export interface HarnessContract {
  apiVersion: number;
  /** Advertised `/api/*` endpoint paths, derived from the live route table. */
  endpoints: string[];
  /** Whether suggestion thresholds are fit — false means stats compute but no
   * labels are suggested. */
  suggestionsAvailable: boolean;
}

/** Parse a raw contract response body, or null when it isn't one. */
export function parseHarnessContract(raw: unknown): HarnessContract | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.apiVersion !== "number" || !Array.isArray(c.endpoints)) return null;
  const endpoints = c.endpoints.filter((e): e is string => typeof e === "string");
  const suggestions =
    typeof c.suggestions === "object" && c.suggestions !== null
      ? (c.suggestions as Record<string, unknown>)
      : {};
  return {
    apiVersion: c.apiVersion,
    endpoints,
    suggestionsAvailable: suggestions.available === true,
  };
}

/**
 * What the probe result allows. "Probe failed" and "probe succeeded but the
 * feature isn't advertised" are the same degraded state: manual labels, with a
 * visible reason.
 */
export interface VideoStatsGate {
  /** POST /api/video-stats after every Setup save so the artifact tracks crops. */
  statsEnabled: boolean;
  /** Prefill the condition-label form from the response's suggestions. */
  prefillEnabled: boolean;
  /** Human-readable degraded reason when anything is disabled, else null. */
  degradedReason: string | null;
}

/** Decide the video-stats feature gate from a (possibly failed) probe. */
export function videoStatsGate(contract: HarnessContract | null): VideoStatsGate {
  if (!contract) {
    return {
      statsEnabled: false,
      prefillEnabled: false,
      degradedReason:
        "Analysis harness unreachable — condition labels are manual this session.",
    };
  }
  if (contract.apiVersion !== EXPECTED_HARNESS_API_VERSION) {
    return {
      statsEnabled: false,
      prefillEnabled: false,
      degradedReason: `Harness apiVersion ${contract.apiVersion} does not match the expected ${EXPECTED_HARNESS_API_VERSION} — update one side; labels are manual.`,
    };
  }
  if (!contract.endpoints.includes("/api/video-stats")) {
    return {
      statsEnabled: false,
      prefillEnabled: false,
      degradedReason:
        "The harness does not advertise /api/video-stats — labels are manual.",
    };
  }
  if (!contract.suggestionsAvailable) {
    return {
      statsEnabled: true,
      prefillEnabled: false,
      degradedReason:
        "Harness suggestion thresholds are not fit yet — video stats are recorded, labels are manual.",
    };
  }
  return { statsEnabled: true, prefillEnabled: true, degradedReason: null };
}

// ---------------------------------------------------------------------------
// Client seam over the dev proxy — probed once per page load, module-cached
// (same singleton posture as usePoseModel/useOpenCV).
// ---------------------------------------------------------------------------

let probePromise: Promise<HarnessContract | null> | null = null;

/** Probe the harness contract once per session; any failure reads as null. */
export function probeHarnessContract(): Promise<HarnessContract | null> {
  probePromise ??= (async () => {
    try {
      const res = await fetch("/api/dev/contract");
      const body = (await res.json()) as { contract?: unknown };
      if (!res.ok) return null;
      return parseHarnessContract(body.contract);
    } catch {
      return null;
    }
  })();
  return probePromise;
}
