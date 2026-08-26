# Steam Families library sync design

**Date:** 2026-08-26
**Status:** Approved for implementation

## Goal

Expose a complete Steam library to the MCP client: games permanently owned by the configured user and games currently available through Steam Families, while preserving the distinction between ownership and temporary family access.

## Constraints

- Keep the existing Steam Web API key flow for personally owned games.
- Obtain family-library data only through a short-lived Steam web-session token stored locally and never exposed through MCP tools, logs, source control, or documentation examples.
- Treat the Steam Families endpoint as best-effort because it is undocumented and may change.
- Continue serving personally owned games when family synchronization is unavailable.
- Do not represent a family-shared license as permanent ownership.

## Architecture

Introduce a `SteamFamilyApiClient` alongside the existing owned-games client. It obtains the merged family catalog from Steam's family-library service using a local `STEAM_WEBAPI_TOKEN`. A `SteamLibraryService` merges both sources by AppID:

1. An owned record wins when the same game appears in both sources.
2. A family-only record is labeled `family_shared` and includes current `playable` availability.
3. Source metadata is preserved internally and exposed through stable MCP result types.
4. Existing library, search, game lookup, tracker, and metadata workflows consume this accessible-library view.

The merged accessible library is cached for five minutes. A missing, expired, rejected, malformed, or changed family response produces a safe availability state and falls back to the owned library rather than failing all Steam tools.

## Data contract

Extend game results with:

- `accessType`: `owned` | `family_shared`
- `isPlayable`: boolean

Owner SteamIDs returned by Steam are treated as private family metadata and are not returned by default. They may be retained only when needed for local merge diagnostics, with no logging.

`steam_get_library`, `steam_search_library`, and `steam_get_game` operate on the accessible library. Counts distinguish owned games from family-shared games. The tracker accepts either access type because both are games the user can play. A game that becomes unavailable remains in local tracker history but is clearly reported as not playable.

## Configuration and security

Add an optional `STEAM_WEBAPI_TOKEN` entry to `.env.example` with an empty value and README instructions that it is a temporary session credential. The token is never accepted as a tool argument, returned to a client, printed, committed, or included in errors. Family synchronization is disabled when it is absent.

## Failure handling

- No token: owned library operates normally; tools state that family sync is unavailable.
- Invalid or expired token: safe family-sync warning plus owned-library fallback.
- Upstream schema drift: reject the response, keep owned data, and emit a redacted diagnostic event.
- Family game not currently playable: return it with `family_shared` and `isPlayable: false`.

## Tests

Use TDD to cover:

- owned-only, family-only, and duplicate AppID merging;
- precedence of owned data;
- playable/unplayable family games;
- absent, expired, and malformed family-token responses;
- cache behavior and fallback to owned library;
- no token, owner ID, or credentials in MCP results or logs;
- integration coverage for library, search, game lookup, tracker, and metadata using family-shared fixtures.

## Rollout

Implement this as an optional V4 capability. The existing server stays backward-compatible for users without Steam Families or without the local session token.