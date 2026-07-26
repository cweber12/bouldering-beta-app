/**
 * Scan Setup — the frozen manual inputs attached to a Test Video so its scan can
 * be replayed headlessly by the detection eval harness (see docs/adr/0017 and the
 * Scan Setup glossary entry in CONTEXT.md).
 *
 * Framework-agnostic — no React imports. Used by the calibration page (client),
 * the dev proxy (server), and the batch driver, so it must produce a stable
 * `setupHash` everywhere: the hash is what each detection run stamps to prove it
 * replayed a given Setup.
 */

import type { CropFraction } from "@/utils/cropFraction";
import {
  parseAnalysisInputsEdit,
  parseProvenanceEdit,
  type AnalysisInputsEdit,
  type AnalysisInputsProvenance,
} from "@/utils/harnessMetadata";

/** Bumped only on a breaking change to the Scan Setup shape. */
export const SETUP_VERSION = 1;

/** Snake-case condition labels the harness reads from `setup.json.analysisInputs`. */
export type AnalysisInputs = Record<string, string>;

/** Tap point that may include the tapped frame's video time in seconds. */
export interface ClimberPoint {
  x: number;
  y: number;
  t?: number;
}

/** The manual scan inputs a User would supply interactively, frozen for replay. */
export interface ScanSetupInput {
  /** Seed box for the Climber (MediaPipe acquisition + lighting region). */
  climberCrop: CropFraction;
  /** ORB wall region. */
  wallCrop: CropFraction;
  /** Tap that disambiguates which person is the Climber, or null. */
  climberPoint: ClimberPoint | null;
  /** Fixed (false) vs Panning Capture (true). */
  panning: boolean;
  /** Quality Tier id (pinned per Setup so re-runs stay comparable). */
  qualityTier: string;
}

/** A persisted Scan Setup: the inputs plus a stable hash and server timestamp. */
export interface ScanSetup extends ScanSetupInput {
  version: number;
  /** SHA-256 over the canonicalised inputs — stamped onto every replayed run. */
  setupHash: string;
  /**
   * Manual condition labels (snake_case). Deliberately excluded from
   * {@link canonicalSetupInput} so a label edit never changes `setupHash` — and
   * so it can never orphan saved Ground Truth or prior runs.
   */
  analysisInputs?: AnalysisInputs;
  /**
   * Per-label provenance (`auto-accepted` / `human-overridden` /
   * `human-authored`) for the video-stats prefill flow. Additive sibling of
   * {@link analysisInputs}, equally excluded from the hash.
   */
  analysisInputsProvenance?: Record<string, string>;
  /**
   * The Climber tap used to seed the downloader's ViTPose job, distinct from the
   * in-hash {@link climberPoint} (which seeds MediaPipe in Analyze). Deliberately
   * excluded from {@link canonicalSetupInput} so re-tapping to improve the seed
   * never changes `setupHash` — a re-seed re-authors Ground Truth without
   * re-pairing prior runs. Absent means "use `climberPoint`". See the
   * harness-setup-calibrate-split PRD.
   */
  seedTap?: ClimberPoint;
  /**
   * Where the climb ends — a topout, or the point the attempt is over — in
   * seconds into the video. The climb *start* needs no field: it is
   * {@link climberPoint}'s `t`, which the human already gave at calibration.
   *
   * Deliberately excluded from {@link canonicalSetupInput}, for the same reason
   * as {@link seedTap}: marking a window must not change `setupHash`, or adding
   * one to the 90 already-calibrated Bundles would mark every prior run stale
   * through the freshness chain (ADR 0020) and orphan their Ground Truth.
   *
   * Absent means the window is open on that side, which is exactly how the
   * harness behaves today. The marker is a **scoring** concept the harness
   * applies to a run's attempts — it never bounds this scanner's seek loop, which
   * would be a detection-behavior change. See harness ADR 0007 §4.
   */
  climbEnd?: number;
  /** ISO timestamp, stamped server-side on write. */
  updatedAt: string;
}

/** Round to 6 decimals so float noise never changes the hash. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function canonCrop(c: CropFraction) {
  return { x: round6(c.x), y: round6(c.y), w: round6(c.w), h: round6(c.h) };
}

/**
 * Deterministic string form of the Setup inputs (fixed key order, rounded
 * numbers) — the pre-image for {@link hashSetupInput}.
 */
export function canonicalSetupInput(input: ScanSetupInput): string {
  const canonicalPoint = input.climberPoint
    ? {
        x: round6(input.climberPoint.x),
        y: round6(input.climberPoint.y),
        ...(input.climberPoint.t !== undefined ? { t: round6(input.climberPoint.t) } : {}),
      }
    : null;

  return JSON.stringify({
    v: SETUP_VERSION,
    climberCrop: canonCrop(input.climberCrop),
    wallCrop: canonCrop(input.wallCrop),
    climberPoint: canonicalPoint,
    panning: !!input.panning,
    qualityTier: input.qualityTier,
  });
}

/** SHA-256 hex digest of the canonical Setup inputs. */
export async function hashSetupInput(input: ScanSetupInput): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalSetupInput(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Validation — the PUT proxy trusts nothing from the client.
// ---------------------------------------------------------------------------

function isCrop(v: unknown): v is CropFraction {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (["x", "y", "w", "h"] as const).every(
    (k) => typeof c[k] === "number" && Number.isFinite(c[k] as number),
  );
}

function isPoint(v: unknown): v is ClimberPoint {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  if (p.t !== undefined && (typeof p.t !== "number" || !Number.isFinite(p.t) || p.t < 0)) {
    return false;
  }
  return (
    typeof p.x === "number" &&
    typeof p.y === "number" &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y)
  );
}

/**
 * Validate an untrusted request body into a {@link ScanSetupInput}, or null when
 * malformed. A missing/undefined `climberPoint` is accepted as null.
 */
export function parseScanSetupInput(body: unknown): ScanSetupInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (!isCrop(b.climberCrop) || !isCrop(b.wallCrop)) return null;
  if (b.climberPoint != null && !isPoint(b.climberPoint)) return null;
  if (typeof b.panning !== "boolean") return null;
  if (
    typeof b.qualityTier !== "string" ||
    b.qualityTier.length === 0 ||
    b.qualityTier.length > 40
  ) {
    return null;
  }

  return {
    climberCrop: b.climberCrop,
    wallCrop: b.wallCrop,
    climberPoint: isPoint(b.climberPoint) ? b.climberPoint : null,
    panning: b.panning,
    qualityTier: b.qualityTier,
  };
}

/** The keys that make a write a scan-input (crop) save rather than labels-only. */
const SCAN_INPUT_KEYS = [
  "climberCrop",
  "wallCrop",
  "climberPoint",
  "panning",
  "qualityTier",
] as const;

/**
 * True when the body carries any scan-affecting field, so the setup route knows
 * to parse (and re-hash) fresh crops instead of inheriting the saved ones. A
 * labels-only body (`{ analysisInputs }`) has none, and preserves the crops.
 */
export function bodyHasScanInputs(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return SCAN_INPUT_KEYS.some((k) => k in b);
}

/** True when the body carries a `seedTap` edit (the off-hash ViTPose seed tap). */
export function bodyHasSeedTap(body: unknown): boolean {
  return typeof body === "object" && body !== null && "seedTap" in body;
}

/**
 * Validate a `seedTap` edit off an untrusted body. `null` clears the seed tap;
 * a valid {@link ClimberPoint} sets it; anything malformed returns `false` so the
 * route can 422. Callers gate on {@link bodyHasSeedTap} first, so a missing
 * `seedTap` key never reaches here.
 */
export function parseSeedTapEdit(body: unknown): ClimberPoint | null | false {
  const raw = (body as Record<string, unknown>).seedTap;
  if (raw === null) return null;
  return isPoint(raw) ? raw : false;
}

/** True when the body carries a `climbEnd` key at all (including `null`). */
export function bodyHasClimbEnd(body: unknown): boolean {
  return typeof body === "object" && body !== null && "climbEnd" in body;
}

/**
 * Validate a `climbEnd` edit off an untrusted body against the climb start
 * (`climberPoint.t`, or undefined when the setup has no tap / no tap time).
 *
 * `null` clears the marker; a finite second ≥ 0 that is **strictly after** the
 * climb start sets it; anything else returns `false` so the route can 422. The
 * ordering rule mirrors the harness endpoint's own (`climb_end > climb_start`,
 * both ≥ 0) so a window this scanner accepts is never one the harness rejects
 * later — a 422 here is cheaper than a scaffold job that dies on submit.
 *
 * Callers gate on {@link bodyHasClimbEnd} first, so a missing key never arrives.
 */
export function parseClimbEndEdit(body: unknown, climbStart?: number): number | null | false {
  const raw = (body as Record<string, unknown>).climbEnd;
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return false;
  if (climbStart !== undefined && raw <= climbStart) return false;
  return raw;
}

/** The climb start for a setup: the setup tap's time, when it carries one. */
export function climbStartOf(setup: Pick<ScanSetup, "climberPoint">): number | undefined {
  return setup.climberPoint?.t;
}

/** Pull only the scan-input fields off a persisted setup, for re-hashing on merge. */
export function pickScanInput(setup: ScanSetup): ScanSetupInput {
  return {
    climberCrop: setup.climberCrop,
    wallCrop: setup.wallCrop,
    climberPoint: setup.climberPoint,
    panning: setup.panning,
    qualityTier: setup.qualityTier,
  };
}

// ---------------------------------------------------------------------------
// Client seam over the dev proxy (mirrors utils/harnessGroundTruth).
// ---------------------------------------------------------------------------

/**
 * Persist a condition-label edit through the merging setup write; returns the
 * merged `analysisInputs` block. Scan-affecting fields and `setupHash` are left
 * untouched server-side. Re-exports the label edit type for the caller's use.
 */
export type { AnalysisInputsEdit };

export async function saveSetupLabels(
  bundleKey: string,
  edit: AnalysisInputsEdit,
  provenance?: AnalysisInputsProvenance,
): Promise<unknown> {
  const res = await fetch(`/api/dev/corpus/setup?key=${encodeURIComponent(bundleKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      analysisInputs: edit,
      ...(provenance && Object.keys(provenance).length > 0
        ? { analysisInputsProvenance: provenance }
        : {}),
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Failed to save labels.");
  return body.setup?.analysisInputs ?? null;
}

/**
 * Persist the off-hash ViTPose seed tap through the merging setup write; returns
 * the merged `seedTap`. Crops, labels, and `setupHash` are left untouched
 * server-side (`setupHash` never covers `seedTap`), so re-seeding never re-pairs
 * prior runs. Passing `null` clears the seed tap (falls back to `climberPoint`).
 */
export async function saveSeedTap(
  bundleKey: string,
  seedTap: ClimberPoint | null,
): Promise<ClimberPoint | null> {
  const res = await fetch(`/api/dev/corpus/setup?key=${encodeURIComponent(bundleKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seedTap }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Failed to save seed tap.");
  return body.setup?.seedTap ?? null;
}

/**
 * Persist an end-of-climb marker through the merging setup write. `null` clears
 * it. Like {@link saveSeedTap}, this leaves `setupHash` and every scan-affecting
 * field untouched server-side, so marking a window never re-pairs prior runs.
 */
export async function saveClimbEnd(
  bundleKey: string,
  climbEnd: number | null,
): Promise<number | null> {
  const res = await fetch(`/api/dev/corpus/setup?key=${encodeURIComponent(bundleKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ climbEnd }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Failed to save the end-of-climb marker.");
  return body.setup?.climbEnd ?? null;
}

// Re-exported so the setup route validates label edits without a second import.
export { parseAnalysisInputsEdit, parseProvenanceEdit };
