# Apply Progress: Steam Library Core

## Completed Tasks

- [x] 1.1 Bootstrap Vitest and strict TypeScript ESM quality tooling.
- [x] 1.2 Validate Steam runtime configuration without secret disclosure.
- [x] 1.3 Define immutable normalized domain models and safe application errors.
- [x] 2.1 Implement the Steam HTTP boundary and response schemas.
- [x] 2.2 Implement SteamID-keyed TTL caching.
- [x] 2.3 Implement the Steam service and domain transformations.
- [x] 3.1 Implement strict MCP input schemas with shared recent-game bounds.
- [x] 3.2 Register exactly five safe, normalized Steam MCP tools.
- [x] 3.3 Compose an injectible MCP server and silent stdio bootstrap.
- [x] 4.1 Add stdio release E2E and README setup/security coverage.
- [x] 4.2 Run final build and quality gates.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/config-domain.test.ts` | Unit | N/A (new) | `npx vitest run tests/config-domain.test.ts` failed because `package.json` was CommonJS. | Focused tooling assertion passed after ESM/Vitest tooling was added. | ESM runtime plus quality configuration checks. | Set `openspec/config.yaml` to strict TDD and recorded exact commands. |
| 1.2 | `tests/config-domain.test.ts` | Unit | N/A (new) | Missing config module test failed. | Focused config tests passed after `loadConfig` was added. | Missing/blank settings and secret redaction. | Centralized defaults and switched the boundary to Zod. |
| 1.3 | `tests/config-domain.test.ts` | Unit | N/A (new) | Missing domain/error module test failed. | Focused domain tests passed after immutable models and safe errors were added. | Optional data, hidden causes, and runtime immutability. | Froze models and arrays while preserving safe JSON output. |
| 2.1 | `tests/steam-client.test.ts` | Integration-style unit | N/A (new) | Missing Steam client test failed. | Focused client tests passed after Zod schemas and timed fetch client were added. | URL encoding, timeout, HTTP, JSON, DTO, network, and recent paths. | Extracted URL construction and JSON parsing. |
| 2.2 | `tests/ttl-cache.test.ts` | Unit | N/A (new) | Missing TTL cache test failed. | Focused cache tests passed after `TtlCache` was added. | Fresh hit, exact-expiry eviction, SteamID isolation, and clear. | Kept expiry deletion co-located with reads. |
| 2.3 | `tests/steam-service.test.ts` | Unit | N/A (new) | Missing service test failed. | Focused service tests passed after normalized library behavior was added. | Cache/refresh, normalization, search, lookup, count bounds, and stats. | Isolated cache-key, count, normalization, and image helpers. |
| 3.1 | `tests/tools-contract.test.ts` | Unit | N/A (new) | `npm test -- --run tests/tools-contract.test.ts` failed because `src/tools/schemas.ts` did not exist. | Focused schema tests passed after Zod schemas were added. | Blank search, invalid app ID, invalid fractional/bounded count, and default 10. | Shared 1–50 bounds and default constants. |
| 3.2 | `tests/tools-contract.test.ts` | Contract unit | N/A (new) | Focused test failed because `src/tools/register-steam-tools.ts` did not exist. | Focused contract tests passed after tool registration adapters were added. | Exact five names, all operations, invalid input short-circuiting, and safe error serialization. | Kept the MCP boundary thin through a registrar port. |
| 3.3 | `tests/server.test.ts` | MCP integration | N/A (new) | `npm test -- --run tests/server.test.ts` failed because `src/server.ts` did not exist. | Focused server tests passed after injected composition and stdio bootstrap were added. | In-memory MCP tool discovery/call plus malformed stdio and silent startup failure checks. | Preserved injected config/client/cache/clock seams. |
| 4.1 | `tests/release-e2e.test.ts`, `tests/readme.test.ts` | E2E + documentation contract | `npm test -- --run tests/server.test.ts` → exit 0; 1 file and 2 tests passed. | E2E build test failed because the `build` script was missing; README tests failed because `README.md` did not exist. | Both focused files passed after adding an emitted production build and README. | Spawned valid framed MCP `initialize` request receives the production server identity; malformed frames and invalid configuration remain silent and redact the API key. | Factored process spawning into one helper; no duplication remained. |
| 4.2 | Quality commands | Release verification | Focused release/docs tests passed. | N/A — verification-only task. | `npm run build`, full Vitest, typecheck, lint, and format check exited 0. | Full suite runs all earlier unit, integration, contract, E2E, and documentation paths. | Ran Prettier before final verification; it made no changes. |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Unit 1 focused tests | `npm test -- --run tests/config-domain.test.ts` → exit 0; 1 file and 9 tests passed. |
| Unit 1 runtime harness | `npm run typecheck` → exit 0; strict NodeNext ESM compilation, with no Steam/stdio runtime boundary in that unit. |
| Unit 1 lint / format | `npm run lint` and `npm run format:check` → exit 0. |
| Unit 1 rollback boundary | Revert the foundation commit to remove tooling, `src/config.ts`, `src/domain/models.ts`, `src/errors.ts`, and its tests without affecting later work. |
| Unit 2 focused tests | `npm test -- --run tests/steam-client.test.ts tests/ttl-cache.test.ts tests/steam-service.test.ts` → exit 0; 3 files and 15 tests passed. |
| Unit 2 runtime harness | Stubbed native fetch exercised encoded URLs, a real abort signal at 10,000 ms, response failures, cache expiry, and failed refreshes → exit 0. |
| Unit 2 type / lint / format | `npm run typecheck`, `npm run lint`, and `npm run format:check` → exit 0. |
| Unit 2 rollback boundary | Revert the work-unit commit to remove `src/steam/`, `src/cache/`, `src/services/`, and their tests without removing foundation or future MCP tools. |
| Unit 3 focused tests | `npm test -- --run tests/tools-contract.test.ts tests/server.test.ts` → exit 0; 2 files and 6 tests passed. |
| Unit 3 runtime harness | In-memory MCP client/server transport listed exactly five tools and invoked `steam_get_recent_games` through injected service composition; malformed stdio input emitted no stdout diagnostics → exit 0. |
| Unit 3 quality checks | `npm run typecheck`, `npm run lint`, and `npm run format:check` → exit 0. |
| Unit 3 rollback boundary | Revert this work-unit commit to remove `src/tools/`, `src/server.ts`, `src/index.ts`, MCP SDK dependency/lockfile changes, and tool/server tests without removing the access/service layer. |
| Unit 4 focused tests | `npm test -- --run tests/release-e2e.test.ts tests/readme.test.ts` → exit 0; 2 files and 5 tests passed. |
| Unit 4 runtime harness | Built `dist/index.js` received a valid framed MCP `initialize` request and returned the server identity; malformed input with valid config exited 0 without secret leakage; invalid config exited 1 without protocol output or secret leakage. |
| Unit 4 final quality gates | `npm run build`, `npm test -- --run`, `npm run typecheck`, `npm run lint`, and `npm run format:check` → exit 0. |
| Unit 4 rollback boundary | Revert the release commit and this verification correction to remove `README.md`, `tsconfig.build.json`, the `build` script, release/docs tests, and task evidence without changing completed MCP core behavior. |

## Delivery

- Mode: chained PR slice (`auto-chain`)
- Chain strategy: `feature-branch-chain`
- Current work unit: 4 — release verification and documentation
- Base / target branch: `codex/steam-library-mcp-tools`
- Native attempt token: `sha256:f84b4d88a1a054dc784a2ea2dbb659185795e84a7e64cbefde334e639b1eb21d`

## Remaining Tasks

- None — all Steam Library Core tasks are complete; next recommended phase is verification.
