# Route console is own-user-only (cross-user viewing deferred)

## Status

accepted

## Context

The route console lives at `/route/{userId}/{state}/{area}/{route}` — the
`{userId}` in the path reads as though any user's route could be opened and
compared (e.g. from another climber's profile or a map pin). In practice the
console loads every **Run** and the **Route Photo** through `/api/s3/get`, which
`isValidKey` scopes to the *authenticated* user. So opening another user's route
would fail every climb load with "Invalid key."

## Decision

The route console is **own-user-only for now**: the `{userId}` segment is always
the signed-in user. Other users' climbs remain read-only via the profile
`ClimbDetailModal` (`/api/profile/{userId}/climbs/detail`, gated by
`isValidRoutePrefix`). Cross-user route viewing is explicitly deferred to a future
implementation. The Route-Photo chooser, saved-photo probe (`/api/s3/list`), and
photo load all ride on the own-user endpoints accordingly.

## Consequences

- The `{userId}` in the URL is intentionally redundant with the session today;
  it exists so the future cross-user path is a routing change, not a URL change.
- Enabling cross-user viewing later means routing climb-data **and** Route-Photo
  reads through a public, `isValidRoutePrefix`-gated endpoint (mirroring the
  climbs/detail API) rather than `/api/s3/get` — not a URL or component-shape
  change.
- Until then, a stray link to `/route/{someoneElse}/…` degrades to empty slots
  rather than showing their climbs.
