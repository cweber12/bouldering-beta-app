"use client";

import { useState, useCallback } from "react";
import type { RouteAttempt } from "@/storage/sessionStore";
import {
  sanitizeDirName,
  serializeAttemptMetadata,
  serializeAttemptData,
  loadAttemptFromJson,
} from "@/utils/fsHelpers";
import { useAuth } from "@/hooks/useAuth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type S3Status = "idle" | "loading" | "error";

export interface S3AttemptEntry {
  /** S3 object key, e.g. "RouteData/{userId}/Colorado/RedRocks/TheClassic/run-1234-attempt.json" */
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
  /**
   * Fetch and deserialise another user's RouteAttempt via the prefix-gated
   * cross-user endpoint. `key` is the full `RouteData/{ownerUserId}/…` key; the
   * owner is parsed from it. Use for guest slots in cross-user comparison.
   */
  downloadAttemptCrossUser: (key: string) => Promise<RouteAttempt>;
  /** Permanently delete an object from S3 by its key. */
  deleteAttempt: (key: string) => Promise<void>;
  /** List attempt objects under an optional prefix (defaults to "RouteData/{userId}"). */
  listAttempts: (prefix?: string) => Promise<S3AttemptEntry[]>;
  /** List immediate sub-"folder" names under a prefix (uses S3 delimiter listing). */
  listPrefixes: (prefix: string) => Promise<string[]>;
  /** User-scoped S3 prefix, e.g. "RouteData/{userId}". */
  userPrefix: string | null;
  status: S3Status;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

const KEY_PREFIX = "RouteData";

function deriveS3Key(userId: string, attempt: RouteAttempt): string {
  const state = sanitizeDirName(attempt.state || "Unknown State");
  const area = sanitizeDirName(attempt.area || "Unknown Area");
  const route = sanitizeDirName(attempt.route || "Unknown Route");
  const runType = attempt.runType ?? "attempt";
  return `${KEY_PREFIX}/${userId}/${state}/${area}/${route}/${attempt.id}-${runType}.json`;
}

/** Derive the heavy-data sibling key for a metadata key. */
function dataKeyFor(metaKey: string): string {
  return metaKey.replace(/\.json$/, ".data.json");
}

/** POST a JSON document to S3 at `key`. Throws with the server error on failure. */
async function putObject(key: string, body: string): Promise<void> {
  const res = await fetch("/api/s3/put", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, body }),
  });
  if (!res.ok) {
    throw new Error(((await res.json()) as { error?: string }).error ?? "Upload failed.");
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useS3Storage(): S3StorageResult {
  const { user } = useAuth();
  const [status, setStatus] = useState<S3Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function setErr(msg: string) {
    setStatus("error");
    setErrorMessage(msg);
  }

  // ---- Upload ----------------------------------------------------------------

  const uploadAttempt = useCallback(
    async (attempt: RouteAttempt): Promise<string> => {
      if (!user) throw new Error("Authentication required.");
      setStatus("loading");
      setErrorMessage(null);
      const key = deriveS3Key(user.uid, attempt);

      try {
        // Split write: small queryable metadata under `key`, heavy frames/matches/
        // descriptors under the sibling `.data.json`. List/card/detail readers only
        // ever fetch the metadata object, so browsing never pulls the heavy blob.
        //
        // Write data-first, metadata-last (fail-closed): the metadata object is the
        // record's existence marker — list/detail views key off it. If the heavy
        // write fails we never write the marker, so a half-saved run is invisible
        // rather than appearing in the list with missing frames.
        await putObject(dataKeyFor(key), JSON.stringify(serializeAttemptData(attempt)));
        await putObject(key, JSON.stringify(serializeAttemptMetadata(attempt)));
        setStatus("idle");
        return key;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErr(msg);
        throw err;
      }
    },
    [user],
  );

  // ---- Download --------------------------------------------------------------

  const downloadAttempt = useCallback(async (key: string): Promise<RouteAttempt> => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/s3/get?key=${encodeURIComponent(key)}`);
      if (!res.ok) {
        const err = ((await res.json()) as { error?: string }).error ?? "Download failed.";
        setErr(err);
        throw new Error(err);
      }
      const raw = (await res.json()) as Record<string, unknown>;
      // v2 split format: metadata carries no heavy fields — fetch the sibling
      // data object and merge. Legacy combined files have `frames` inline.
      const isSplit = raw.schemaVersion != null || raw.frames === undefined;
      if (isSplit) {
        const dataRes = await fetch(`/api/s3/get?key=${encodeURIComponent(dataKeyFor(key))}`);
        if (!dataRes.ok) {
          throw new Error(
            "This run's frame data could not be loaded — the heavy-data file is " +
              "missing or unreadable. The run may not have finished saving.",
          );
        }
        const data = (await dataRes.json()) as Record<string, unknown>;
        Object.assign(raw, data);
      }
      const attempt = loadAttemptFromJson(raw);
      setStatus("idle");
      return attempt;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErr(msg);
      throw err;
    }
  }, []);

  // ---- Cross-user download ---------------------------------------------------

  const downloadAttemptCrossUser = useCallback(async (key: string): Promise<RouteAttempt> => {
    setStatus("loading");
    setErrorMessage(null);
    // The owner is the first path segment after the RouteData prefix:
    // RouteData/{ownerUserId}/{state}/{area}/{route}/{id}-{runType}.json
    const ownerUserId = key.split("/")[1] ?? "";
    if (!ownerUserId) {
      const msg = "Could not determine the owner of this run.";
      setErr(msg);
      throw new Error(msg);
    }
    try {
      const res = await fetch(
        `/api/profile/${encodeURIComponent(ownerUserId)}/climbs/attempt?key=${encodeURIComponent(key)}`,
      );
      if (!res.ok) {
        const err = ((await res.json()) as { error?: string }).error ?? "Download failed.";
        setErr(err);
        throw new Error(err);
      }
      // The endpoint already merges the heavy-data sibling, so the payload is a
      // complete attempt — rehydrate descriptors exactly as downloadAttempt does.
      const raw = (await res.json()) as Record<string, unknown>;
      const attempt = loadAttemptFromJson(raw);
      setStatus("idle");
      return attempt;
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
        const err = ((await res.json()) as { error?: string }).error ?? "Delete failed.";
        setErr(err);
        throw new Error(err);
      }
      // Best-effort removal of the heavy-data sibling (absent for legacy files).
      await fetch(`/api/s3/delete?key=${encodeURIComponent(dataKeyFor(key))}`, {
        method: "DELETE",
      }).catch(() => {});
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
        const err = ((await res.json()) as { error?: string }).error ?? "List failed.";
        setErr(err);
        throw new Error(err);
      }
      const data = (await res.json()) as {
        objects: Array<{ Key?: string; LastModified?: string; Size?: number }>;
      };
      setStatus("idle");
      return data.objects.map((o) => ({
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

  // ---- List prefixes (folder names) ------------------------------------------

  const listPrefixes = useCallback(async (prefix: string): Promise<string[]> => {
    const qs = `?prefix=${encodeURIComponent(prefix)}&delimiter=%2F`;
    try {
      const res = await fetch(`/api/s3/list${qs}`);
      if (!res.ok) {
        const err = ((await res.json()) as { error?: string }).error ?? "List prefixes failed.";
        throw new Error(err);
      }
      const data = (await res.json()) as { prefixes: string[] };
      // Strip the prefix and trailing slash to return just the folder name.
      return data.prefixes
        .map((p) => {
          const relative = p.startsWith(prefix) ? p.slice(prefix.length) : p;
          return relative.replace(/\/$/, "");
        })
        .filter(Boolean);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[useS3Storage] listPrefixes error:", msg);
      return [];
    }
  }, []);

  const userPrefix = user ? `${KEY_PREFIX}/${user.uid}` : null;

  return {
    uploadAttempt,
    downloadAttempt,
    downloadAttemptCrossUser,
    deleteAttempt,
    listAttempts,
    listPrefixes,
    userPrefix,
    status,
    errorMessage,
  };
}
