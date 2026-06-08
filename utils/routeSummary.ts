/**
 * One route (state/area/route) with aggregate info folded from its runs.
 * Returned by `GET /api/profile/[userId]/routes` and consumed by the Routes
 * collection view + map. Shared so the route handler and the client agree.
 */
export interface RouteSummary {
  state: string;
  area: string;
  route: string;
  /** Number of runs (attempts + sends) recorded on this route. */
  climbCount: number;
  /** Human label for the most recent run. */
  lastClimbedLabel: string;
  /** Sort key — epoch millis of the most recent run. */
  lastClimbedTs: number;
  /** S3 key of the most recent run (the one auto-selected when opening the route). */
  lastClimbKey: string;
  /** Run type of the most recent run — drives the map pin colour. */
  runType: string;
  /** Most recent run's thumbnail, rating, and GPS (one fetch per route). */
  thumbnail?: string;
  rating?: string;
  coordinates?: { lat: number; lng: number };
  /** True when the route has GPS to center the map on. */
  hasGps: boolean;
}

export interface RouteListResponse {
  items: RouteSummary[];
  total: number;
}

/** Sort options for the route-grouped collection. */
export type RouteSort = "recent" | "oldest" | "route";
