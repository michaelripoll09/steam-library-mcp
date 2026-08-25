# Design: Enriched Game Metadata

## Technical Approach

Flow: `MCP adapter -> MetadataService -> SteamService + IgdbClient`. `SteamService.getGame(appId)` gates ownership. Zod validates all boundaries. Tools expose structured metadata, never recommendations, ranks, or scores.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|---|---|---|---|
| Lazy configuration | Start Steam core and register all seven tools. Parse IGDB settings into enabled/disabled composition; disabled metadata calls return `METADATA_UNAVAILABLE` | Fail startup; omit tools | Preserves Steam availability and exact discovery. |
| Authentication | `IgdbTokenProvider` exchanges environment-only Twitch credentials and caches tokens until 60 seconds before expiry | Static token; inline auth | Isolates refresh and secrets. |
| Exact match | Accept only IGDB `external_games` entries with official Steam category `1` and `uid === String(appId)` | Names; numeric coercion | Prevents fuzzy, cross-store, and leading-zero matches. If multiple games contain that exact pair, choose the lowest numeric IGDB game ID deterministically. |
| Cache | Validated values only; timers below | Database; raw DTOs | Avoids persistence and invalid-data retention. |
| Tool boundary | Return normalized success or the exact public error envelope | Generated prose | Keeps adapters thin and reasoning client-side. |

## Data Flow

```text
input -> tool Zod -> ownership lookup -> app-ID cache -> token -> IGDB
                                                     -> response Zod
                                                     -> exact pair + normalize
                                                     -> public response
```

Library queries load owned games, enrich their IDs with concurrency `4`, filter, sort by app ID, then apply `limit`.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/config.ts`, `src/errors.ts` | Modify | Lazy IGDB state and errors. |
| `src/igdb/{schemas,token-provider,client}.ts` | Create | Zod, OAuth, timeout/retry, lookup. |
| `src/domain/metadata.ts`, `src/services/metadata-service.ts` | Create | Model, ownership, cache, filters. |
| `src/tools/schemas.ts`, `src/tools/register-metadata-tools.ts`, `src/server.ts` | Modify/Create | Contracts, adapters, composition. |
| `tests/**/*.test.ts`, `README.md` | Modify/Create | Coverage and setup. |

## Interfaces / Contracts

```ts
type MetadataStatus = "complete" | "partial" | "missing";
interface GameMetadataResult {
  appId: number; name: string;
  genres: readonly string[]; tags: readonly string[]; themes: readonly string[];
  releaseDate: string | null; metadataStatus: MetadataStatus;
  missingReason: "not_found" | null; cacheState: "live" | "fresh" | "stale" | "none";
}
interface MetadataUnavailableEnvelope {
  isError: true;
  error: { code: "METADATA_UNAVAILABLE"; message: string; retryable: boolean };
}
interface MetadataService {
  getOwnedGameMetadata(appId: number): Promise<GameMetadataResult>;
  queryOwnedMetadata(input: MetadataQuery): Promise<readonly GameMetadataResult[]>;
}
```

This is the success shape for both tools. Arrays are trimmed, case-insensitively deduplicated, and sorted. IGDB genres map to `genres`, keywords to `tags`, themes to `themes`; `first_release_date` becomes `YYYY-MM-DD` or `null`. Exact data is `complete` only when all three arrays are non-empty and release date is non-null; otherwise `partial`. No exact match is `missing`, with empty arrays, null release date, and `not_found`. Stale values retain complete/partial status and use `cacheState: "stale"`.

`steam_get_game_metadata` accepts exactly `{appId: positive integer}`. `steam_query_library_metadata` accepts `genres?`, `tags?`, `themes?` as non-empty arrays of trimmed non-blank strings; inclusive integer `releaseYearFrom?`/`releaseYearTo?`; and `limit?` from 1–50, default 50. At least one genre/tag/theme/year filter is required: an all-absent filter request is rejected even when `limit` is supplied. From must not exceed to. Matching is case-insensitive, OR within a field and AND across fields.

OAuth Zod requires non-empty `access_token`, bearer type, and positive `expires_in`. IGDB Zod validates IDs, timestamp, named metadata arrays, category, and UID. Invalid data is never cached.

## Cache and Error Model

`IGDB_CACHE_TTL_MS` defaults to `86_400_000` (24 h); positives remain stale-eligible until age `604_800_000` (7 d). Exact-match misses use a `3_600_000` (1 h) negative TTL and are never stale. HTTP 429 permits exactly two TOTAL attempts: the initial request plus one retry. Respect integer `Retry-After` seconds clamped to 0–1,000 ms, otherwise wait 500 ms. After exhaustion, return eligible stale success; without stale data return `{ isError: true, error: { code: "METADATA_UNAVAILABLE", message: "Game metadata is temporarily unavailable.", retryable: true } }`. Invalid configuration returns the same envelope shape with message `Configure IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to use metadata tools.` and `retryable: false`. Timeout, 5xx, network, auth, and invalid payload failures use the temporary-unavailability envelope; ownership/input failures use their existing safe contracts. Nothing exposes secrets, headers, bodies, URLs, causes, or stacks.

## Testing Strategy

| Layer | Coverage | Approach |
|---|---|---|
| Unit | status shape, exact/duplicate match, normalization, filters, TTLs, concurrency | Vitest fakes for clock/cache/clients. |
| Integration | OAuth, timeout, 429 timing, payload drift/redaction | Stubbed fetch and fake timers. |
| Contract/E2E | seven-tool discovery, lazy config, ownership-before-IGDB, structured results | In-memory MCP transport and built stdio server. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable classification, or new process boundary.

## Migration / Rollout

No migration or paid infrastructure. IGDB is free but requires a free Twitch developer account and client credentials. Metadata enables when both IGDB variables validate; otherwise Steam tools remain operational and metadata tools return `METADATA_UNAVAILABLE`.

## Open Questions

None.
