"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/hooks/useAuth";
import { attemptTimestampLabel, parseRunType } from "@/utils/fsHelpers";
import type { ClimbPin } from "@/components/map/ClimbsMap";

const ClimbsMap = dynamic(() => import("@/components/map/ClimbsMap"), { ssr: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfileData {
  userId: string;
  displayName?: string;
  location?: string;
  bio?: string;
  profilePicture?: string;
}

interface ClimbEntry {
  key: string;
  label: string;
  runType: string;
  state: string;
  area: string;
  route: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an S3 key into route segments. Key: RouteData/{uid}/{state}/{area}/{route}/{filename} */
function parseClimbKey(key: string): { state: string; area: string; route: string; filename: string } | null {
  const parts = key.split("/");
  // RouteData / userId / state / area / route / filename
  if (parts.length < 6) return null;
  return {
    state: parts[2],
    area: parts[3],
    route: parts[4],
    filename: parts[parts.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Public Profile Page
// ---------------------------------------------------------------------------

export default function PublicProfilePage() {
  const params = useParams();
  const userId = typeof params.userId === "string" ? params.userId : "";
  const { user, loading: authLoading } = useAuth();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [climbs, setClimbs] = useState<ClimbEntry[]>([]);
  const [loadingClimbs, setLoadingClimbs] = useState(true);

  const [pins, setPins] = useState<ClimbPin[]>([]);
  const [loadingPins, setLoadingPins] = useState(false);
  const [showMap, setShowMap] = useState(false);

  const [following, setFollowing] = useState<string[]>([]);
  const isOwnProfile = user?.id === userId;
  const isFollowing = following.includes(userId);

  // ------ Load profile ----------------------------------------------------

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/profile/${userId}`);
        if (!res.ok) throw new Error("Failed to load profile.");
        const data = (await res.json()) as ProfileData;
        if (!cancelled) setProfile(data);
      } catch (err) {
        console.error("[profile view] load error:", err);
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // ------ Load climbs -----------------------------------------------------

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/profile/${userId}/climbs`);
        if (!res.ok) throw new Error("Failed to load climbs.");
        const data = (await res.json()) as { objects: Array<{ Key?: string }> };
        const entries: ClimbEntry[] = [];

        for (const obj of data.objects) {
          if (!obj.Key) continue;
          // Exclude non-run files (like route-image.json)
          if (!obj.Key.match(/run-\d+.*\.json$/) && !obj.Key.match(/attempt-\d+\.json$/)) continue;

          const parsed = parseClimbKey(obj.Key);
          if (!parsed) continue;

          entries.push({
            key: obj.Key,
            label: attemptTimestampLabel(parsed.filename),
            runType: parseRunType(parsed.filename),
            state: parsed.state,
            area: parsed.area,
            route: parsed.route,
          });
        }

        // Group by route, newest first
        entries.sort((a, b) => {
          const cmp = `${a.state}/${a.area}/${a.route}`.localeCompare(`${b.state}/${b.area}/${b.route}`);
          if (cmp !== 0) return cmp;
          // Newer first (later timestamps → higher values in filename)
          return b.key.localeCompare(a.key);
        });

        if (!cancelled) setClimbs(entries);
      } catch (err) {
        console.error("[profile view] climbs error:", err);
      } finally {
        if (!cancelled) setLoadingClimbs(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // ------ Load follow list + pins lazily when map is opened ------------

  useEffect(() => {
    if (!showMap || !userId) return;
    let cancelled = false;
    setLoadingPins(true);

    (async () => {
      try {
        const res = await fetch(`/api/profile/${userId}/pins`);
        if (!res.ok) return;
        const data = (await res.json()) as { pins?: ClimbPin[] };
        if (!cancelled && Array.isArray(data.pins)) setPins(data.pins);
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoadingPins(false);
      }
    })();

    return () => { cancelled = true; };
  }, [showMap, userId]);

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
      } catch { /* ignore */ }
    })();

    return () => { cancelled = true; };
  }, [authLoading, user]);

  // ------ Follow / Unfollow -----------------------------------------------

  const handleFollow = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: userId }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { following?: string[] };
      if (Array.isArray(data.following)) setFollowing(data.following);
    } catch (err) {
      console.error("[profile] follow error:", err);
    }
  }, [userId]);

  const handleUnfollow = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/follow", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: userId }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { following?: string[] };
      if (Array.isArray(data.following)) setFollowing(data.following);
    } catch (err) {
      console.error("[profile] unfollow error:", err);
    }
  }, [userId]);

  // ------ Group climbs by route -------------------------------------------

  const groupedClimbs = climbs.reduce<Map<string, ClimbEntry[]>>((acc, c) => {
    const routeKey = `${c.state} / ${c.area} / ${c.route}`;
    if (!acc.has(routeKey)) acc.set(routeKey, []);
    acc.get(routeKey)!.push(c);
    return acc;
  }, new Map());

  // ------ Render ----------------------------------------------------------

  const displayName = profile?.displayName || profile?.userId || "User";

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <Link
        href="/profile"
        className="mb-6 inline-block text-xs text-fg-muted hover:text-accent"
      >
        ← Back to my profile
      </Link>

      {loadingProfile ? (
        <div className="flex flex-col items-center gap-4 py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-edge border-t-fg" />
          <p className="text-sm text-fg-muted">Loading profile&#8230;</p>
        </div>
      ) : (
        <>
        {/* ---- Profile header ---- */}
        <section className="mb-8 flex items-center gap-6">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-edge bg-inset">
            {profile?.profilePicture ? (
              <Image
                src={profile.profilePicture}
                alt={`${displayName}'s avatar`}
                width={80}
                height={80}
                unoptimized
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl text-fg-muted">
                {displayName[0]?.toUpperCase() ?? "?"}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-fg">{displayName}</h1>
            {profile?.location && (
              <p className="text-xs text-fg-muted">{profile.location}</p>
            )}
            {profile?.bio && (
              <p className="mt-1 text-sm text-fg-secondary">{profile.bio}</p>
            )}

            {!isOwnProfile && !authLoading && user && (
              <div className="mt-2">
                {isFollowing ? (
                  <button
                    onClick={handleUnfollow}
                    className="rounded-lg border border-edge px-3 py-1 text-xs text-fg-secondary transition hover:border-red-400 hover:text-red-400"
                  >
                    Unfollow
                  </button>
                ) : (
                  <button
                    onClick={handleFollow}
                    className="rounded-lg bg-primary px-3 py-1 text-xs text-fg transition hover:bg-primary/80"
                  >
                    Follow
                  </button>
                )}
              </div>
            )}

            {isOwnProfile && (
              <Link
                href="/profile"
                className="mt-2 text-xs text-accent hover:text-accent-hover"
              >
                Edit profile
              </Link>
            )}
          </div>
        </section>

        <hr className="mb-6 border-edge" />

        {/* ---- Climb map ---- */}
        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Climb map</h2>
            <button
              type="button"
              onClick={() => setShowMap((v) => !v)}
              className="text-xs text-fg-secondary transition hover:text-accent"
            >
              {showMap ? "Hide map" : "Show map"}
            </button>
          </div>

          {showMap && (
            <div className="rounded-xl border border-edge overflow-hidden">
              {loadingPins ? (
                <div className="flex items-center justify-center h-40 text-xs text-fg-muted">
                  Loading pins&#8230;
                </div>
              ) : pins.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-xs text-fg-muted">
                  No GPS-tagged climbs yet.
                </div>
              ) : (
                <ClimbsMap pins={pins} height={400} />
              )}
            </div>
          )}
        </section>

        <hr className="mb-6 border-edge" />

        {/* ---- Climbs ---- */}
        <section>
          <h2 className="mb-4 text-sm font-semibold text-fg">Climbs</h2>

          {loadingClimbs ? (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-edge border-t-fg" />
              <p className="text-sm text-fg-muted">Loading climbs&#8230;</p>
            </div>
          ) : climbs.length === 0 ? (
              <p className="text-xs text-fg-muted">No climbs recorded yet.</p>
            ) : (
              <div className="flex flex-col gap-5">
                {[...groupedClimbs.entries()].map(([routeLabel, entries]) => (
                  <div key={routeLabel}>
                    <h3 className="mb-2 text-xs font-medium text-fg-secondary">{routeLabel}</h3>
                    <ul className="flex flex-col gap-1.5">
                      {entries.map((c) => (
                        <li
                          key={c.key}
                          className="flex items-center gap-3 rounded-lg border border-edge bg-card px-4 py-2"
                        >
                          <span
                            className={[
                              "inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              c.runType === "send"
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-amber-500/20 text-amber-400",
                            ].join(" ")}
                          >
                            {c.runType}
                          </span>
                          <span className="text-sm text-fg">{c.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
