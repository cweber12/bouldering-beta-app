# Profile & Social

Storage formats, API routes, and validators for profile/social features. Read this before working in `app/profile/`, `app/people/`, `app/api/profile/`, or the profile-facing components (`components/map/ClimbsMap.tsx`, `components/shared/ClimbDetailModal.tsx`).

- Profile data stored at `ProfileData/{userId}/profile.json` (displayName, location, bio, profilePicture as base64 data URL).
- Search index at `ProfileData/_index/{userId}.json` (displayName, email, location) — updated on every profile save.
- Following list at `ProfileData/{userId}/following.json` — array of user IDs.
- Profile API routes: `/api/profile` (own GET/PUT), `/api/profile/[userId]` (public GET), `/api/profile/[userId]/climbs` (public climb list), `/api/profile/[userId]/climbs/detail` (single climb detail by key), `/api/profile/follow` (GET/POST/DELETE), `/api/profile/search?q=` (GET).
- `isValidProfileKey()` and `isValidRoutePrefix()` validate cross-user reads.
- Profile text fields capped at `PROFILE_TEXT_LIMIT` (500 chars); profile picture must be a `data:image/` URL.
- `ClimbDetailModal` (`components/shared/ClimbDetailModal.tsx`) — reusable modal showing full climb info + thumbnail image. Used from both profile pages.
- `ClimbsMap` (`components/map/ClimbsMap.tsx`) — accepts optional `onPinClick` callback and `key` field on pins for navigation.
- Profile and following data live in S3 under the `ProfileData/` prefix (same bucket as route data) — there is no separate database service.
