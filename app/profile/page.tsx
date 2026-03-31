"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import NextImage from "next/image";
import dynamic from "next/dynamic";
import { useAuth } from "@/hooks/useAuth";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useGeocoding } from "@/hooks/useGeocoding";
import ImageCropper from "@/components/shared/ImageCropper";
import LocationAutocomplete from "@/components/shared/LocationAutocomplete";
import ClimbDetailModal from "@/components/shared/ClimbDetailModal";
import type { ClimbDetailData } from "@/components/shared/ClimbDetailModal";
import type { ClimbPin } from "@/components/map/ClimbsMap";

const ClimbsMap = dynamic(() => import("@/components/map/ClimbsMap"), { ssr: false });

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
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_PROFILE: ProfileData = { displayName: "", location: "", bio: "", profilePicture: "" };
const TEXT_LIMIT = 500;
const PAGE_SIZE = 16;

// ---------------------------------------------------------------------------
// Profile page — view / edit mode
// ---------------------------------------------------------------------------

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const { request: geoRequest, loading: geoLoading } = useGeolocation();
  const { reverseGeocode } = useGeocoding();

  // View / edit mode
  const [editing, setEditing] = useState(false);

  const [profile, setProfile] = useState<ProfileData>(EMPTY_PROFILE);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Photo cropper
  const [showCropper, setShowCropper] = useState(false);

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

  // Search & follow
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [following, setFollowing] = useState<string[]>([]);
  const [followingProfiles, setFollowingProfiles] = useState<Map<string, SearchResult>>(new Map());
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Climb detail modal
  const [selectedClimb, setSelectedClimb] = useState<ClimbDetailData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

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

  // ------ Load climbs (paginated) -----------------------------------------

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setLoadingClimbs(true);

    const params = new URLSearchParams({
      page: String(climbPage),
      pageSize: String(PAGE_SIZE),
    });
    if (filterState) params.set("state", filterState);
    if (filterArea) params.set("area", filterArea);
    if (filterRoute) params.set("route", filterRoute);
    if (filterRating) params.set("rating", filterRating);

    (async () => {
      try {
        const res = await fetch(`/api/profile/${user.id}/climbs/page?${params}`);
        if (!res.ok) throw new Error("Failed to load climbs.");
        const data = (await res.json()) as ClimbPageResponse;
        if (!cancelled) {
          setClimbs(data.items);
          setClimbTotal(data.total);
        }
      } catch (err) {
        console.error("[profile] climbs error:", err);
      } finally {
        if (!cancelled) setLoadingClimbs(false);
      }
    })();

    return () => { cancelled = true; };
  }, [authLoading, user, climbPage, filterState, filterArea, filterRoute, filterRating]);

  // ------ Load pins when map mode is active --------------------------------

  useEffect(() => {
    if (viewMode !== "map" || authLoading || !user) return;
    let cancelled = false;
    setLoadingPins(true);

    (async () => {
      try {
        const res = await fetch(`/api/profile/${user.id}/pins`);
        if (!res.ok) return;
        const data = (await res.json()) as { pins?: Array<{ key: string; lat: number; lng: number; route: string; area: string; state: string; runType: string; timestamp?: string }> };
        if (!cancelled && Array.isArray(data.pins)) {
          setPins(data.pins.map((p) => ({
            key: p.key,
            lat: p.lat,
            lng: p.lng,
            label: `${p.route} — ${p.area}`,
            runType: p.runType,
            timestamp: p.timestamp,
          })));
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoadingPins(false); }
    })();

    return () => { cancelled = true; };
  }, [viewMode, authLoading, user]);

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

  const handleCropDone = useCallback((dataUrl: string) => {
    setProfile((p) => ({ ...p, profilePicture: dataUrl }));
    setShowCropper(false);
  }, []);

  // ------ Climb detail handlers -------------------------------------------

  const handleCardClick = useCallback((climb: ClimbSummary) => {
    setSelectedClimb(climb);
  }, []);

  const handlePinClick = useCallback(async (climbKey: string) => {
    if (!user) return;
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
        `/api/profile/${user.id}/climbs/detail?key=${encodeURIComponent(climbKey)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as ClimbDetailData;
      setSelectedClimb(data);
    } catch (err) {
      console.error("[profile] detail fetch error:", err);
    } finally {
      setLoadingDetail(false);
    }
  }, [user, climbs]);

  // ------ GPS for location ------------------------------------------------

  const handleUseGPS = useCallback(async () => {
    const geo = await geoRequest();
    if (!geo) return;
    const result = await reverseGeocode(geo.lat, geo.lng);
    if (result) {
      const { city, town, village, county, state, country } = result.address ?? {};
      const locality = city ?? town ?? village ?? county ?? "";
      const region = state ?? country ?? "";
      const locationStr = [locality, region].filter(Boolean).join(", ");
      if (locationStr) setProfile((p) => ({ ...p, location: locationStr }));
    }
  }, [geoRequest, reverseGeocode]);

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

  if (authLoading || loadingProfile) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <div className="flex flex-col items-center gap-4 py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-edge border-t-fg" />
          <p className="text-sm text-fg-muted">Loading profile&#8230;</p>
        </div>
      </main>
    );
  }

  // =========================================================================
  // EDIT MODE
  // =========================================================================
  if (editing) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-fg">Edit Profile</h1>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-lg border border-edge px-3 py-1.5 text-xs text-fg-secondary transition hover:border-edge-hover hover:text-fg"
          >
            Done
          </button>
        </div>

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
            <button
              type="button"
              onClick={() => setShowCropper(true)}
              className="cursor-pointer rounded-lg border border-edge px-3 py-1.5 text-xs text-fg-secondary transition hover:border-edge-hover hover:text-fg"
            >
              {profile.profilePicture ? "Change photo" : "Upload photo"}
            </button>
            {profile.profilePicture && (
              <button
                type="button"
                onClick={() => setProfile((p) => ({ ...p, profilePicture: "" }))}
                className="text-xs text-fg-muted hover:text-fg-secondary"
              >
                Remove photo
              </button>
            )}
          </div>
        </section>

        {/* ---- Photo cropper modal ---- */}
        {showCropper && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
            <div className="w-full max-w-lg rounded-2xl border border-edge bg-surface p-6 shadow-2xl">
              <h2 className="mb-4 text-sm font-semibold text-fg">Crop profile photo</h2>
              <ImageCropper onCrop={handleCropDone} onCancel={() => setShowCropper(false)} />
            </div>
          </div>
        )}

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
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <LocationAutocomplete
                  value={profile.location}
                  onChange={(v) => setProfile((p) => ({ ...p, location: v.slice(0, TEXT_LIMIT) }))}
                  placeholder="e.g. Boulder, CO"
                />
              </div>
              <button
                type="button"
                onClick={handleUseGPS}
                disabled={geoLoading}
                title="Use current location"
                className="flex shrink-0 items-center justify-center rounded-lg border border-edge bg-inset px-2.5 py-2 text-fg-secondary transition hover:border-accent/60 hover:text-fg disabled:opacity-50"
              >
                {geoLoading ? (
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-edge border-t-accent" />
                ) : (
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="3"/>
                    <path strokeLinecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                  </svg>
                )}
              </button>
            </div>
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
              {saving ? "Saving\u2026" : "Save profile"}
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
            <p className="text-xs text-fg-muted">Searching\u2026</p>
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
      </main>
    );
  }

  // =========================================================================
  // VIEW MODE (default)
  // =========================================================================

  const displayName = profile.displayName || user?.email || "User";

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      {/* ---- Profile header (read-only) ---- */}
      <section className="mb-8 flex items-center gap-6">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-edge bg-inset">
          {profile.profilePicture ? (
            <NextImage
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
          {profile.location && (
            <p className="text-xs text-fg-muted">{profile.location}</p>
          )}
          {profile.bio && (
            <p className="mt-1 text-sm text-fg-secondary">{profile.bio}</p>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-2 w-fit rounded-lg border border-edge px-3 py-1.5 text-xs text-fg-secondary transition hover:border-accent/60 hover:text-accent"
          >
            Edit profile
          </button>
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
            className={`px-3 py-1.5 transition ${viewMode === "list" ? "bg-primary text-fg" : "text-fg-secondary hover:text-fg"}`}
          >
            List
          </button>
          <button
            type="button"
            onClick={() => setViewMode("map")}
            className={`px-3 py-1.5 transition ${viewMode === "map" ? "bg-primary text-fg" : "text-fg-secondary hover:text-fg"}`}
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
                    className="group relative cursor-pointer overflow-hidden rounded-xl border border-edge bg-card transition hover:border-edge-hover"
                  >
                    {/* Thumbnail or placeholder */}
                    <div className="relative aspect-square w-full bg-inset">
                      {c.thumbnail ? (
                        <NextImage
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
                        className={[
                          "absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                          c.runType === "send"
                            ? "bg-emerald-500/80 text-white"
                            : "bg-amber-500/80 text-white",
                        ].join(" ")}
                      >
                        {c.runType}
                      </span>
                    </div>

                    {/* Info overlay */}
                    <div className="px-3 py-2.5">
                      <p className="truncate text-xs font-medium text-fg">{c.route}</p>
                      <p className="truncate text-[10px] text-fg-muted">
                        {c.area} &middot; {c.state}
                      </p>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[10px] text-fg-muted">{c.timestamp}</span>
                        {c.rating && (
                          <span className="rounded bg-accent/20 px-1 py-0.5 text-[10px] font-medium text-accent">
                            {c.rating}
                          </span>
                        )}
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

      {/* ---- Climb detail modal ---- */}
      {selectedClimb && (
        <ClimbDetailModal climb={selectedClimb} onClose={() => setSelectedClimb(null)} />
      )}

      {/* ---- Loading detail spinner ---- */}
      {loadingDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-edge border-t-fg" />
        </div>
      )}
    </main>
  );
}
