"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import NextImage from "next/image";
import { useAuth } from "@/hooks/useAuth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfileData {
  displayName: string;
  location: string;
  bio: string;
  profilePicture: string;
}

interface SearchResult {
  userId: string;
  displayName?: string;
  email?: string;
  location?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_PROFILE: ProfileData = { displayName: "", location: "", bio: "", profilePicture: "" };
const TEXT_LIMIT = 500;

/** Compress an image File to a data URL (max 256×256, JPEG 80%). */
async function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 256;
      const scale = Math.min(1, MAX / img.naturalWidth, MAX / img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("canvas context unavailable")); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Profile page
// ---------------------------------------------------------------------------

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();

  const [profile, setProfile] = useState<ProfileData>(EMPTY_PROFILE);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Search & follow
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [following, setFollowing] = useState<string[]>([]);
  const [followingProfiles, setFollowingProfiles] = useState<Map<string, SearchResult>>(new Map());
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------ Load profile on mount -------------------------------------------

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) throw new Error("Failed to load profile.");
        const data = (await res.json()) as Partial<ProfileData>;
        if (!cancelled) {
          setProfile({
            displayName: data.displayName ?? "",
            location: data.location ?? "",
            bio: data.bio ?? "",
            profilePicture: data.profilePicture ?? "",
          });
        }
      } catch (err) {
        console.error("[profile] load error:", err);
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    })();

    return () => { cancelled = true; };
  }, [authLoading, user]);

  // ------ Load following list on mount ------------------------------------

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/profile/follow");
        if (!res.ok) return;
        const data = (await res.json()) as { following?: string[] };
        if (!cancelled && Array.isArray(data.following)) {
          setFollowing(data.following);
        }
      } catch (err) {
        console.error("[profile] follow list error:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [authLoading, user]);

  // ------ Load following profiles -----------------------------------------

  useEffect(() => {
    if (following.length === 0) {
      setFollowingProfiles(new Map());
      return;
    }
    let cancelled = false;

    (async () => {
      const map = new Map<string, SearchResult>();
      await Promise.all(
        following.map(async (uid) => {
          try {
            const res = await fetch(`/api/profile/${uid}`);
            if (!res.ok) return;
            const data = (await res.json()) as SearchResult;
            map.set(uid, data);
          } catch { /* skip */ }
        }),
      );
      if (!cancelled) setFollowingProfiles(map);
    })();

    return () => { cancelled = true; };
  }, [following]);

  // ------ Save profile ----------------------------------------------------

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!res.ok) {
        const err = ((await res.json()) as { error?: string }).error ?? "Save failed.";
        setSaveMsg(err);
      } else {
        setSaveMsg("Profile saved.");
      }
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [profile]);

  // ------ Avatar upload ---------------------------------------------------

  const handleAvatarChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressAvatar(file);
      setProfile((p) => ({ ...p, profilePicture: dataUrl }));
    } catch (err) {
      console.error("[profile] avatar compress:", err);
    }
  }, []);

  // ------ Search ----------------------------------------------------------

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);

    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/profile/search?q=${encodeURIComponent(q.trim())}`);
        if (!res.ok) { setSearchResults([]); return; }
        const data = (await res.json()) as { results?: SearchResult[] };
        setSearchResults(data.results ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  }, []);

  // ------ Follow / Unfollow -----------------------------------------------

  const handleFollow = useCallback(async (targetUserId: string) => {
    try {
      const res = await fetch("/api/profile/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { following?: string[] };
      if (Array.isArray(data.following)) setFollowing(data.following);
    } catch (err) {
      console.error("[profile] follow error:", err);
    }
  }, []);

  const handleUnfollow = useCallback(async (targetUserId: string) => {
    try {
      const res = await fetch("/api/profile/follow", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { following?: string[] };
      if (Array.isArray(data.following)) setFollowing(data.following);
    } catch (err) {
      console.error("[profile] unfollow error:", err);
    }
  }, []);

  // ------ Render ----------------------------------------------------------

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="mb-6 text-xl font-semibold text-fg">Profile</h1>

      {(authLoading || loadingProfile) ? (
        <div className="flex flex-col items-center gap-4 py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-edge border-t-fg" />
          <p className="text-sm text-fg-muted">Loading profile&#8230;</p>
        </div>
      ) : (
        <>
        {/* ---- Avatar ---- */}
        <section className="mb-8 flex items-center gap-6">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full border-2 border-edge bg-inset">
            {profile.profilePicture ? (
              <NextImage
                src={profile.profilePicture}
                alt="Profile"
                width={96}
                height={96}
                unoptimized
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-3xl text-fg-muted">
                {(profile.displayName || user?.email || "?")[0]?.toUpperCase()}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="cursor-pointer rounded-lg border border-edge px-3 py-1.5 text-xs text-fg-secondary transition hover:border-edge-hover hover:text-fg">
              Upload photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </label>
            {profile.profilePicture && (
              <button
                onClick={() => setProfile((p) => ({ ...p, profilePicture: "" }))}
                className="text-xs text-fg-muted hover:text-fg-secondary"
              >
                Remove photo
              </button>
            )}
          </div>
        </section>

        {/* ---- Profile fields ---- */}
        <section className="mb-8 flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-secondary">
              Display name
            </label>
            <input
              type="text"
              maxLength={TEXT_LIMIT}
              value={profile.displayName}
              onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
              placeholder="Your name"
              className="w-full rounded-lg border border-edge bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-placeholder focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-fg-secondary">
              Location
            </label>
            <input
              type="text"
              maxLength={TEXT_LIMIT}
              value={profile.location}
              onChange={(e) => setProfile((p) => ({ ...p, location: e.target.value }))}
              placeholder="e.g. Boulder, CO"
              className="w-full rounded-lg border border-edge bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-placeholder focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-fg-secondary">
              Bio
            </label>
            <textarea
              maxLength={TEXT_LIMIT}
              rows={3}
              value={profile.bio}
              onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))}
              placeholder="Tell others about your climbing"
              className="w-full resize-y rounded-lg border border-edge bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-placeholder focus:border-accent focus:outline-none"
            />
            <span className="mt-0.5 block text-right text-xs text-fg-muted">
              {profile.bio.length}/{TEXT_LIMIT}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface transition hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
            {saveMsg && (
              <span
                className={`text-xs ${saveMsg === "Profile saved." ? "text-success" : "text-red-400"}`}
              >
                {saveMsg}
              </span>
            )}
          </div>
        </section>

        <hr className="mb-8 border-edge" />

        {/* ---- Search users ---- */}
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-fg">Find climbers</h2>
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search by name or email"
            className="mb-3 w-full rounded-lg border border-edge bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-placeholder focus:border-accent focus:outline-none"
          />

          {searching && (
            <p className="text-xs text-fg-muted">Searching…</p>
          )}

          {searchResults.length > 0 && (
            <ul className="flex flex-col gap-2">
              {searchResults.map((r) => (
                <li
                  key={r.userId}
                  className="flex items-center justify-between rounded-lg border border-edge bg-card px-4 py-2.5"
                >
                  <Link
                    href={`/profile/${r.userId}`}
                    className="flex flex-col gap-0.5 hover:text-accent"
                  >
                    <span className="text-sm font-medium text-fg">
                      {r.displayName || r.email || r.userId}
                    </span>
                    {r.location && (
                      <span className="text-xs text-fg-muted">{r.location}</span>
                    )}
                  </Link>
                  {following.includes(r.userId) ? (
                    <button
                      onClick={() => handleUnfollow(r.userId)}
                      className="rounded-lg border border-edge px-3 py-1 text-xs text-fg-secondary transition hover:border-red-400 hover:text-red-400"
                    >
                      Unfollow
                    </button>
                  ) : (
                    <button
                      onClick={() => handleFollow(r.userId)}
                      className="rounded-lg bg-primary px-3 py-1 text-xs text-fg transition hover:bg-primary/80"
                    >
                      Follow
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
            <p className="text-xs text-fg-muted">No users found.</p>
          )}
        </section>

        {/* ---- Following list ---- */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-fg">
            Following {following.length > 0 && <span className="text-fg-muted">({following.length})</span>}
          </h2>

          {following.length === 0 ? (
            <p className="text-xs text-fg-muted">You&apos;re not following anyone yet. Use the search above to find climbers.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {following.map((uid) => {
                const fp = followingProfiles.get(uid);
                return (
                  <li
                    key={uid}
                    className="flex items-center justify-between rounded-lg border border-edge bg-card px-4 py-2.5"
                  >
                    <Link
                      href={`/profile/${uid}`}
                      className="flex flex-col gap-0.5 hover:text-accent"
                    >
                      <span className="text-sm font-medium text-fg">
                        {fp?.displayName || fp?.email || uid}
                      </span>
                      {fp?.location && (
                        <span className="text-xs text-fg-muted">{fp.location}</span>
                      )}
                    </Link>
                    <button
                      onClick={() => handleUnfollow(uid)}
                      className="rounded-lg border border-edge px-3 py-1 text-xs text-fg-secondary transition hover:border-red-400 hover:text-red-400"
                    >
                      Unfollow
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        </>
      )}
    </main>
  );
}
