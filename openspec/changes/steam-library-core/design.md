# Design: Steam Library Core

## Technical Approach

Build a strict TypeScript ESM application with inward dependencies: MCP adapters → `SteamService` → `SteamApiClient`/cache. Zod validates environment, tool input, and Steam responses; only normalized domain values cross into tools. Bootstrap composes the official MCP TypeScript SDK `McpServer` with `StdioServerTransport`. Tracker and IGDB workstreams remain separate.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|---|---|---|---|
| Boundaries | Ports and constructor injection | Tools call Steam directly | Keeps HTTP, credentials, caching, and MCP transport independently testable. |
| Validation | Zod at environment, MCP, and HTTP boundaries | Type assertions | Runtime data is untrusted; parsed values establish internal invariants. |
| HTTP | Native `fetch` with per-request `AbortController`, 10,000 ms | Axios; shared timer | No extra client dependency and deterministic timeout ownership. |
| Cache | In-memory, SteamID-keyed library cache, 300,000 ms TTL | Database; global unkeyed value | Meets single-process freshness needs without persistence or cross-user leakage. |
| Errors | Typed internal errors mapped once by MCP adapters | Expose upstream exceptions | Stable actionable messages cannot leak keys, URLs, or response bodies. |

## Data Flow

`stdio → Zod tool schema → tool adapter → SteamService → cache → SteamApiClient → fetch`

Responses return through `SteamService` normalization and the adapter's MCP text content. Tools never import `fetch`, configuration secrets, or Steam DTOs.

## File Changes

| File | Action | Description |
|---|---|---|
| `package.json`, `tsconfig.json`, ESLint/Prettier/Vitest configs | Create | Node LTS ESM scripts and quality gates. |
| `src/config.ts`, `src/errors.ts`, `src/domain/models.ts` | Create | Validated configuration, safe error taxonomy, stable models. |
| `src/steam/client.ts`, `src/steam/schemas.ts` | Create | Timed native-fetch client and upstream Zod DTO schemas. |
| `src/cache/ttl-cache.ts`, `src/services/steam-service.ts` | Create | TTL port/implementation and application behavior. |
| `src/tools/schemas.ts`, `src/tools/register-steam-tools.ts` | Create | Five MCP contracts and thin adapters. |
| `src/server.ts`, `src/index.ts` | Create | Dependency composition and stdio bootstrap. |
| `tests/**/*.test.ts`, `README.md` | Create | Unit/contract coverage and public usage/security guidance. |

## Interfaces / Contracts

```ts
type AppConfig = Readonly<{ steamApiKey: string; steamId: string;
  requestTimeoutMs: 10_000; libraryCacheTtlMs: 300_000 }>;
interface SteamGame { appId: number; name: string; playtimeMinutes: number;
  recentPlaytimeMinutes?: number; lastPlayedAt?: string; imageUrl?: string }
interface SteamLibrary { steamId: string; games: readonly SteamGame[]; fetchedAt: string }
interface LibraryStats { totalGames: number; playedGames: number; unplayedGames: number;
  totalPlaytimeMinutes: number; recentlyPlayedGames: number }
interface SteamApiClient { getOwnedGames(steamId: string): Promise<unknown>;
  getRecentGames(steamId: string, count?: number): Promise<unknown> }
interface SteamService { getLibrary(): Promise<SteamLibrary>;
  searchLibrary(query: string): Promise<readonly SteamGame[]>;
  getGame(appId: number): Promise<SteamGame>;
  getRecentGames(count?: number): Promise<readonly SteamGame[]>;
  getLibraryStats(): Promise<LibraryStats> }
interface Cache<T> { get(key: string): T | undefined;
  set(key: string, value: T, ttlMs: number): void; clear(): void }
type FetchLike = typeof fetch;
interface Clock { now(): number }
interface Dependencies { config: AppConfig; fetch: FetchLike; clock: Clock;
  cache: Cache<SteamLibrary>; steamClient: SteamApiClient; steamService: SteamService }
interface ToolAdapter { register(server: McpServer): void }
```

`AppError` carries `code`, `safeMessage`, and optional non-serialized `cause`; subclasses are `ConfigError`, `InputError`, `SteamUnavailableError`, `SteamTimeoutError`, `SteamResponseError`, and `GameNotFoundError`. `loadConfig(env)`, `createSteamApiClient({config, fetch})`, `createSteamService(...)`, `registerSteamTools(server, service)`, and `createServer(overrides?)` are factory seams. Tool Zod schemas permit only documented query, `appId`, and bounded `count` fields.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | Config, normalization, filtering, lookup, stats, TTL | Vitest with fake clock/cache/client. |
| Integration | URL encoding, timeout/abort, DTO drift, redaction | Stubbed `FetchLike`; fake timers. |
| Contract | Five tool schemas, outputs, safe failures, registration | In-memory SDK server/client transport; no network. |
| E2E | Stdio startup and one request | Spawn built server with stub-injectable composition; secrets absent from stdout/stderr. |

## Threat Matrix

All reference rows are N/A: this change does not classify documentation-like executables or operate on Git repositories, commits, pushes, or PR commands. Stdio process integration is applicable separately: malformed frames must fail safely, stdout must contain protocol traffic only, and shutdown/transport errors must not disclose secrets; RED contract/E2E tests cover these behaviors.

## Migration / Rollout

No migration required. Release only after unit, contract, stdio E2E, type, lint, and format gates pass.

## Open Questions

None.
