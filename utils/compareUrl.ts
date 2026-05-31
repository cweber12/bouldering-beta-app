/** The two console modes: a focused single-climb viewer, or a 2–4 climb comparison. */
export type ConsoleMode = "single" | "multiple";

/**
 * Builds the `/compare` URL for one or more climb keys with optional route
 * context. The key CSV is encoded as a whole (commas included) — the compare
 * page reads `params.get("keys")`, which decodes back to a comma-separated list
 * before splitting. Route context scopes the climb rail and route-photo auto-load.
 *
 * `mode` is emitted only when supplied; when absent the console derives the mode
 * from the key count (1 → single, ≥2 → multiple), so existing callers keep working.
 */
export function buildCompareUrl(
  keys: string | string[],
  ctx: { state?: string; area?: string; route?: string; mode?: ConsoleMode } = {},
): string {
  const csv = Array.isArray(keys) ? keys.join(",") : keys;
  const parts = [`keys=${encodeURIComponent(csv)}`];
  if (ctx.state) parts.push(`state=${encodeURIComponent(ctx.state)}`);
  if (ctx.area) parts.push(`area=${encodeURIComponent(ctx.area)}`);
  if (ctx.route) parts.push(`route=${encodeURIComponent(ctx.route)}`);
  if (ctx.mode) parts.push(`mode=${ctx.mode}`);
  return `/compare?${parts.join("&")}`;
}
