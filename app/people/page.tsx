"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

interface SearchResult {
  userId: string;
  displayName?: string;
  email?: string;
  location?: string;
}

export default function PeoplePage() {
  const { user, loading: authLoading } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, []);

  const runSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    try {
      const res = await fetch(`/api/profile/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        setSearchResults([]);
        return;
      }
      const data = (await res.json()) as { results?: SearchResult[] };
      setSearchResults(data.results ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const query = event.target.value;
      setSearchQuery(query);

      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      if (query.trim().length < 2) {
        setSearchResults([]);
        setSearching(false);
        return;
      }

      searchTimeout.current = setTimeout(() => {
        void runSearch(query);
      }, 350);
    },
    [runSearch],
  );

  if (authLoading || !user) {
    return (
      <main className="mx-auto flex w-full max-w-4xl items-center justify-center px-6 py-16">
        <div className="flex flex-col items-center gap-4 py-20">
          <LoadingSpinner className="h-10 w-10" />
          <p className="text-sm text-fg-muted">Loading people&#8230;</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <section className="mb-6 rounded-2xl border border-edge/60 bg-surface-alt/70 px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
              Discover climbers
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">People</h1>
            <p className="mt-2 text-sm text-fg-secondary">
              Search by display name, account ID, or email, open a public profile, then choose a
              climb to view or compare.
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <Link href="/profile" className="ui-control rounded-md px-3 py-2 font-medium text-fg">
              My profile
            </Link>
            <Link href="/routes" className="ui-control rounded-md px-3 py-2 font-medium text-fg">
              Routes
            </Link>
          </div>
        </div>

        <div className="mt-5">
          <label htmlFor="people-search" className="mb-2 block text-xs font-medium text-fg-muted">
            Find climbers
          </label>
          <input
            id="people-search"
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search by name, account ID, or email"
            className="ui-input w-full px-3 py-2 text-sm"
            autoComplete="off"
          />
          <p className="mt-2 text-xs text-fg-muted">
            Results do not include your own account.
          </p>
        </div>
      </section>

      <section>
        {searching && (
          <div className="flex items-center gap-3 rounded-xl border border-edge/60 bg-surface px-4 py-4 text-sm text-fg-secondary">
            <LoadingSpinner className="h-5 w-5" />
            Searching climbers&#8230;
          </div>
        )}

        {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
          <div className="rounded-xl border border-edge/60 bg-surface px-4 py-4 text-sm text-fg-secondary">
            No users found.
          </div>
        )}

        {searchResults.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {searchResults.map((result) => (
              <li key={result.userId}>
                <Link
                  href={`/profile/${result.userId}`}
                  className="group flex h-full flex-col rounded-xl border border-edge/60 bg-surface px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-fg group-hover:text-accent">
                        {result.displayName || result.email || result.userId}
                      </h2>
                      <p className="mt-1 text-sm text-fg-secondary">
                        {result.location || result.email || "Public profile"}
                      </p>
                    </div>
                    <span className="rounded-full bg-send-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-send">
                      Open
                    </span>
                  </div>
                  <p className="mt-4 text-xs leading-5 text-fg-muted">
                    View their climb grid, open any climb for details, and use Compare with mine on
                    a climb modal.
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
