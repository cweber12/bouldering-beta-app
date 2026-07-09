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

/** Bumped only on a breaking change to the Scan Setup shape. */
export const SETUP_VERSION = 1;

/** The manual scan inputs a User would supply interactively, frozen for replay. */
export interface ScanSetupInput {
  /** Seed box for the Climber (MediaPipe acquisition + lighting region). */
  climberCrop: CropFraction;
  /** ORB wall region. */
  wallCrop: CropFraction;
  /** Tap that disambiguates which person is the Climber, or null. */
  climberPoint: { x: number; y: number } | null;
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
  return JSON.stringify({
    v: SETUP_VERSION,
    climberCrop: canonCrop(input.climberCrop),
    wallCrop: canonCrop(input.wallCrop),
    climberPoint: input.climberPoint
      ? { x: round6(input.climberPoint.x), y: round6(input.climberPoint.y) }
      : null,
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

function isPoint(v: unknown): v is { x: number; y: number } {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
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
  if (typeof b.qualityTier !== "string" || b.qualityTier.length === 0 || b.qualityTier.length > 40) {
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
