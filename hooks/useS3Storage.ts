"use client";

import { useState, useCallback } from "react";
import type { RouteAttempt } from "@/storage/sessionStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type S3Status = "idle" | "loading" | "error";

export interface S3AttemptEntry {
  /** S3 object key, e.g. "RouteData/Colorado/RedRocks/TheClassic/attempt-1234.json" */
  key: string;
  /** Last-modified timestamp from S3, ISO string. */
  lastModified?: string;
  /** Object size in bytes. */
  size?: number;
}

export interface S3StorageResult {
  /** Upload a RouteAttempt JSON to S3. Key is derived from the attempt metadata. */
  uploadAttempt: (attempt: RouteAttempt) => Promise<string>;
  /** Fetch and deserialise a RouteAttempt from S3 by its object key. */
  downloadAttempt: (key: string) => Promise<RouteAttempt>;
  /** Permanently delete an object from S3 by its key. */
  deleteAttempt: (key: string) => Promise<void>;
  /** List attempt objects under an optional prefix (defaults to "RouteData"). */
  listAttempts: (prefix?: string) => Promise<S3AttemptEntry[]>;
  status: S3Status;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

const KEY_PREFIX = "RouteData";

function sanitize(name: string): string {
  return name.trim().replace(/[<>:"/\\|?*]/g, "_") || "Unknown";
}

function deriveS3Key(attempt: RouteAttempt): string {
  const state = sanitize(attempt.state || "Unknown State");
  const area  = sanitize(attempt.area  || "Unknown Area");
  const route = sanitize(attempt.route || "Unknown Route");
  return `${KEY_PREFIX}/${state}/${area}/${route}/${attempt.id}.json`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useS3Storage(): S3StorageResult {
  const [status, setStatus]           = useState<S3Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function setErr(msg: string) {
    setStatus("error");
    setErrorMessage(msg);
  }

  // ---- Upload ----------------------------------------------------------------

  const uploadAttempt = useCallback(async (attempt: RouteAttempt): Promise<string> => {
    setStatus("loading");
    setErrorMessage(null);
    const key = deriveS3Key(attempt);

    const serializable = {
      ...attempt,
      orbFeatures: attempt.orbFeatures
        ? { ...attempt.orbFeatures, descriptors: Array.from(attempt.orbFeatures.descriptors) }
        : null,
    };

    try {
      const res = await fetch("/api/s3/put", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, body: JSON.stringify(serializable) }),
      });
      if (!res.ok) {
        const err = (await res.json() as { error?: string }).error ?? "Upload failed.";
        setErr(err);
        throw new Error(err);
      }
      setStatus("idle");
      return key;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErr(msg);
      throw err;
    }
  }, []);

  // ---- Download --------------------------------------------------------------

  const downloadAttempt = useCallback(async (key: string): Promise<RouteAttempt> => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/s3/get?key=${encodeURIComponent(key)}`);
      if (!res.ok) {
        const err = (await res.json() as { error?: string }).error ?? "Download failed.";
        setErr(err);
        throw new Error(err);
      }
      const raw = await res.json() as Record<string, unknown>;
      // Re-hydrate descriptors from Array → Uint8Array.
      if (raw.orbFeatures && typeof raw.orbFeatures === "object") {
        const orb = raw.orbFeatures as Record<string, unknown>;
        if (Array.isArray(orb.descriptors)) {
          orb.descriptors = new Uint8Array(orb.descriptors as number[]);
        }
      }
      setStatus("idle");
      return raw as unknown as RouteAttempt;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErr(msg);
      throw err;
    }
  }, []);

  // ---- Delete ----------------------------------------------------------------

  const deleteAttempt = useCallback(async (key: string): Promise<void> => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/s3/delete?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = (await res.json() as { error?: string }).error ?? "Delete failed.";
        setErr(err);
        throw new Error(err);
      }
      setStatus("idle");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErr(msg);
      throw err;
    }
  }, []);

  // ---- List ------------------------------------------------------------------

  const listAttempts = useCallback(async (prefix?: string): Promise<S3AttemptEntry[]> => {
    setStatus("loading");
    setErrorMessage(null);
    const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
    try {
      const res = await fetch(`/api/s3/list${qs}`);
      if (!res.ok) {
        const err = (await res.json() as { error?: string }).error ?? "List failed.";
        setErr(err);
        throw new Error(err);
      }
      const data = await res.json() as { objects: Array<{ Key?: string; LastModified?: string; Size?: number }> };
      setStatus("idle");
      return data.objects.map(o => ({
        key: o.Key ?? "",
        lastModified: o.LastModified,
        size: o.Size,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErr(msg);
      throw err;
    }
  }, []);

  return { uploadAttempt, downloadAttempt, deleteAttempt, listAttempts, status, errorMessage };
}
