/**
 * Build-time application version stamped onto every diagnostics record.
 *
 * Resolves to the short git SHA of the build, injected by `next.config.ts` as
 * `NEXT_PUBLIC_APP_VERSION` (see the `env` block there). Falls back to "dev"
 * when the variable is absent (e.g. a build outside a git checkout). Stamping
 * each record with the code version lets trend analysis tell whether a shift in
 * detection quality came from a condition or from a tuning change.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
