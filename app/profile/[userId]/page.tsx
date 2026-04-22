"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/utils/cn";
import { useAuth } from "@/hooks/useAuth";
import ClimbDetailModal from "@/components/shared/ClimbDetailModal";
import type { ClimbDetailData } from "@/components/shared/ClimbDetailModal";
import type { ClimbPin } from "@/components/map/ClimbsMap";
import ClimbOptionsDropdown from "@/components/shared/ClimbOptionsDropdown";

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

interface ClimbSummary {
  key: string;
  state: string;
  area: string;
  route: string;
  runType: string;
  timestamp: string;
  rating?: string;
  notes?: string;
  thumbnail?: string;
  coordinates?: { lat: number; lng: number };
}

interface ClimbPageResponse {
  items: ClimbSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 16;

// ---------------------------------------------------------------------------
// Public Profile Page
// ---------------------------------------------------------------------------

export default function PublicProfilePage() {
  const params = useParams();
  const userId = typeof params.userId === "string" ? params.userId : "";
  const { user, loading: authLoading } = useAuth();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  // Climb grid state
  const [climbs, setClimbs] = useState<ClimbSummary[]>([]);
  const [climbTotal, setClimbTotal] = useState(0);
  const [climbPage, setClimbPage] = useState(1);
  const [loadingClimbs, setLoadingClimbs] = useState(true);

  // Filters
  const [filterState, setFilterState] = useState("");
  const [filterArea, setFilterArea] = useState("");
  const [filterRoute, setFilterRoute] = useState("");
  const [filterRating, setFilterRating] = useState("");

  // Map / list toggle
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [pins, setPins] = useState<ClimbPin[]>([]);
  const [loadingPins, setLoadingPins] = useState(false);

  const [following, setFollowing] = useState<string[]>([]);
  const isOwnProfile = user?.uid === userId;
  const isFollowing = following.includes(userId);

  // Climb detail modal
  const [selectedClimb, setSelectedClimb] = useState<ClimbDetailData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

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

  // ------ Load climbs (paginated) -----------------------------------------

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoadingClimbs(true);

    const searchParams = new URLSearchParams({
      page: String(climbPage),
      pageSize: String(PAGE_SIZE),
    });
    if (filterState) searchParams.set("state", filterState);
    if (filterArea) searchParams.set("area", filterArea);
    if (filterRoute) searchParams.set("route", filterRoute);
    if (filterRating) searchParams.set("rating", filterRating);

    (async () => {
      try {
        const res = await fetch(`/api/profile/${userId}/climbs/page?${searchParams}`);
        if (!res.ok) throw new Error("Failed to load climbs.");
        const data = (await res.json()) as ClimbPageResponse;
        if (!cancelled) {
          setClimbs(data.items);
          setClimbTotal(data.total);
        }
      } catch (err) {
        console.error("[profile view] climbs error:", err);
      } finally {
        if (!cancelled) setLoadingClimbs(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, climbPage, filterState, filterArea, filterRoute, filterRating]);

  // ------ Load pins when map mode is active --------------------------------

  useEffect(() => {
    if (viewMode !== "map" || !userId) return;
    let cancelled = false;
    setLoadingPins(true);

    (async () => {
      try {
        const res = await fetch(`/api/profile/${userId}/pins`);
        if (!res.ok) return;
        const data = (await res.json()) as { pins?: Array<{ key: string; lat: number; lng: number; route: string; area: string; runType: string; timestamp?: string }> };
        if (!cancelled && Array.isArray(data.pins)) {
          setPins(data.pins.map((p) => ({
            key: p.key,
            lat: p.lat,
            lng: p.lng,
            label: `${p.route} \u2014 ${p.area}`,
            runType: p.runType,
            timestamp: p.timestamp,
          })));
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoadingPins(false); }
    })();

    return () => { cancelled = true; };
  }, [viewMode, userId]);

  // ------ Load follow list ------------------------------------------------

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

  // ------ Climb detail handlers -------------------------------------------

  const handleCardClick = useCallback((climb: ClimbSummary) => {
    setSelectedClimb(climb);
  }, []);

  const handlePinClick = useCallback(async (climbKey: string) => {
    // Check if we already have this climb in the grid data.
    const found = climbs.find((c) => c.key === climbKey);
    if (found) {
      setSelectedClimb(found);
      return;
    }
    // Otherwise fetch the detail from the API.
    setLoadingDetail(true);
    try {
      const res = await fetch(
        `/api/profile/${userId}/climbs/detail?key=${encodeURIComponent(climbKey)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as ClimbDetailData;
      setSelectedClimb(data);
    } catch (err) {
      console.error("[profile view] detail fetch error:", err);
    } finally {
      setLoadingDetail(false);
    }
  }, [userId, climbs]);

  // ------ Filter helpers --------------------------------------------------

  const applyFilters = useCallback(() => {
    setClimbPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFilterState("");
    setFilterArea("");
    setFilterRoute("");
    setFilterRating("");
    setClimbPage(1);
  }, []);

  const totalPages = Math.max(1, Math.ceil(climbTotal / PAGE_SIZE));

  // ------ Render ----------------------------------------------------------

  const displayName = profile?.displayName || profile?.userId || "User";

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <Link
        href="/profile"
        className="mb-6 inline-block text-xs text-fg-muted hover:text-accent"
      >
        &larr; Back to my profile
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
                    className="rounded-lg border border-edge px-3 py-1 text-xs text-fg-secondary transition hover:border-danger hover:text-danger"
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

        {/* ---- Filters ---- */}
        <section className="mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">State</label>
              <input
                type="text"
                value={filterState}
                onChange={(e) => setFilterState(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                placeholder="Any"
                className="w-28 rounded-lg border border-edge bg-inset px-2 py-1.5 text-xs text-fg placeholder:text-fg-placeholder focus:border-accent focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">Area</label>
              <input
                type="text"
                value={filterArea}
                onChange={(e) => setFilterArea(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                placeholder="Any"
                className="w-28 rounded-lg border border-edge bg-inset px-2 py-1.5 text-xs text-fg placeholder:text-fg-placeholder focus:border-accent focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">Route</label>
              <input
                type="text"
                value={filterRoute}
                onChange={(e) => setFilterRoute(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                placeholder="Any"
                className="w-28 rounded-lg border border-edge bg-inset px-2 py-1.5 text-xs text-fg placeholder:text-fg-placeholder focus:border-accent focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">Rating</label>
              <input
                type="text"
                value={filterRating}
                onChange={(e) => setFilterRating(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                placeholder="Any"
                className="w-24 rounded-lg border border-edge bg-inset px-2 py-1.5 text-xs text-fg placeholder:text-fg-placeholder focus:border-accent focus:outline-none"
              />
            </div>
            {(filterState || filterArea || filterRoute || filterRating) && (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-lg px-2 py-1.5 text-xs text-fg-muted transition hover:text-fg-secondary"
              >
                Clear
              </button>
            )}
          </div>
        </section>

        {/* ---- List / Map toggle ---- */}
        <section className="mb-6 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">
            Climbs {climbTotal > 0 && <span className="text-fg-muted">({climbTotal})</span>}
          </h2>
          <div className="flex rounded-lg border border-edge text-xs">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn("px-3 py-1.5 transition", viewMode === "list" ? "bg-primary text-fg" : "text-fg-secondary hover:text-fg")}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode("map")}
              className={cn("px-3 py-1.5 transition", viewMode === "map" ? "bg-primary text-fg" : "text-fg-secondary hover:text-fg")}
            >
              Map
            </button>
          </div>
        </section>

        {/* ---- Map view ---- */}
        {viewMode === "map" && (
          <section className="mb-6 rounded-xl border border-edge overflow-hidden">
            {loadingPins ? (
              <div className="flex items-center justify-center h-80 text-xs text-fg-muted">
                Loading map&#8230;
              </div>
            ) : pins.length === 0 ? (
              <div className="flex items-center justify-center h-80 text-xs text-fg-muted">
                No GPS-tagged climbs yet.
              </div>
            ) : (
              <ClimbsMap pins={pins} height={400} onPinClick={handlePinClick} />
            )}
          </section>
        )}

        {/* ---- Climb grid (4×4) ---- */}
        {viewMode === "list" && (
          <section className="mb-8">
            {loadingClimbs ? (
              <div className="flex flex-col items-center gap-4 py-10">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-edge border-t-fg" />
                <p className="text-sm text-fg-muted">Loading climbs&#8230;</p>
              </div>
            ) : climbs.length === 0 ? (
              <p className="py-8 text-center text-xs text-fg-muted">
                {climbTotal === 0 ? "No climbs recorded yet." : "No climbs match the current filters."}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {climbs.map((c) => (
                    <div
                      key={c.key}
                      onClick={() => handleCardClick(c)}
                      className="group relative cursor-pointer rounded-xl border border-edge bg-card transition hover:border-edge-hover"
                    >
                      {/* Thumbnail or placeholder */}
                      <div className="relative aspect-square w-full overflow-hidden rounded-t-xl bg-inset">
                        {c.thumbnail ? (
                          <Image
                            src={c.thumbnail}
                            alt={`${c.route} climb`}
                            fill
                            unoptimized
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-3xl text-fg-muted/30">
                            <svg className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                            </svg>
                          </div>
                        )}

                        {/* Run type badge */}
                        <span
                            className={cn(
                              "absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              c.runType === "send"
                                ? "bg-send/80 text-fg-inverse"
                                : "bg-attempt/80 text-fg-inverse",
                            )}
                        >
                          {c.runType}
                        </span>
                      </div>

                      {/* Info + options */}
                      <div className="flex items-start gap-1 px-2 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-fg">{c.route}</p>
                          <p className="truncate text-[10px] text-fg-muted">
                            {c.area} &middot; {c.state}
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-[10px] text-fg-muted">{c.timestamp}</span>
                            {c.rating && (
                              <span className="rounded bg-accent/20 px-1 py-0.5 text-[10px] font-medium text-accent">
                                {c.rating}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 self-center" onClick={(e) => e.stopPropagation()}>
                          <ClimbOptionsDropdown climbKey={c.key} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-6 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setClimbPage((p) => Math.max(1, p - 1))}
                      disabled={climbPage <= 1}
                      className="rounded-lg border border-edge px-3 py-1.5 text-xs text-fg-secondary transition hover:border-edge-hover hover:text-fg disabled:opacity-30"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-fg-muted">
                      Page {climbPage} of {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setClimbPage((p) => Math.min(totalPages, p + 1))}
                      disabled={climbPage >= totalPages}
                      className="rounded-lg border border-edge px-3 py-1.5 text-xs text-fg-secondary transition hover:border-edge-hover hover:text-fg disabled:opacity-30"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
        </>
      )}

      {/* ---- Climb detail modal ---- */}
      {selectedClimb && (
        <ClimbDetailModal climb={selectedClimb} onClose={() => setSelectedClimb(null)} />
      )}

      {/* ---- Loading detail spinner ---- */}
      {loadingDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/70 backdrop-blur-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-edge border-t-fg" />
        </div>
      )}
    </main>
  );
}
