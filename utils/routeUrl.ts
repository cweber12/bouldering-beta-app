/** The two console modes: a focused single-climb viewer, or a 2–4 climb comparison. */
export type ConsoleMode = "single" | "multiple";

/** Route context that identifies a single route (mirrors the S3 key path). */
export interface RouteContext {
  state: string;
  area: string;
  route: string;
}

export interface RouteUrlOptions {
  /** Climb keys to load into slots. In single mode only the first is emitted. */
  keys?: string | string[];
  /** Explicit console mode; omitted → derived from the key count on read. */
  mode?: ConsoleMode;
}

/**
 * Builds the dedicated `/route/{userId}/{state}/{area}/{route}` console URL.
 *
 * Route context lives in the path (the segments are the same `state/area/route`
 * strings the app already passes around — they come straight from the S3 key,
 * so they are canonical). Selected climb keys + mode ride in the query: the keys
 * CSV is encoded as a whole (commas included), matching the reader which splits
 * on "," after decoding.
 *
 * `mode` is emitted only when supplied; when absent the console derives the mode
 * from the key count (1 → single, ≥2 → multiple).
 */
export function buildRouteUrl(
  userId: string,
  ctx: RouteContext,
  opts: RouteUrlOptions = {},
): string {
  const seg = (s: string) => encodeURIComponent(s);
  const base = `/route/${seg(userId)}/${seg(ctx.state)}/${seg(ctx.area)}/${seg(ctx.route)}`;
  const params: string[] = [];
  if (opts.keys != null) {
    const csv = Array.isArray(opts.keys) ? opts.keys.join(",") : opts.keys;
    if (csv) params.push(`keys=${encodeURIComponent(csv)}`);
  }
  if (opts.mode) params.push(`mode=${opts.mode}`);
  return params.length ? `${base}?${params.join("&")}` : base;
}
