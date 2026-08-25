# Apply Progress: Steam Library Core

## Completed Tasks

- [x] 1.1 Bootstrap Vitest and strict TypeScript ESM quality tooling.
- [x] 1.2 Validate Steam runtime configuration without secret disclosure.
- [x] 1.3 Define immutable normalized domain models and safe application errors.
- [x] 2.1 Implement the Steam HTTP boundary and response schemas.
- [x] 2.2 Implement SteamID-keyed TTL caching.
- [x] 2.3 Implement the Steam service and domain transformations.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/tooling.test.ts` | Unit | N/A (new) | `npx vitest run tests/tooling.test.ts` failed because `package.json` was CommonJS. | Focused test passed after ESM/Vitest tooling was added. | ESM runtime plus quality configuration checks. | Set `openspec/config.yaml` to strict TDD and recorded the exact commands. |
| 1.2 | `tests/config-domain.test.ts` | Unit | N/A (new) | `npm test -- --run tests/config.test.ts` failed because `src/config.ts` did not exist. | Focused config tests passed after `loadConfig` was added. | Missing and blank settings, with secret redaction. | Centralized defaults and switched the boundary to Zod. |
| 1.3 | `tests/config-domain.test.ts` | Unit | N/A (new) | `npm test -- --run tests/domain-errors.test.ts` failed because domain modules did not exist. | Focused domain tests passed after immutable models and safe errors were added. | Optional data, hidden causes, and runtime immutability. | Froze models and arrays while preserving safe JSON output. |
| 2.1 | `tests/steam-client.test.ts` | Integration-style unit | N/A (new) | `npm test -- --run tests/steam-client.test.ts` failed because `src/steam/client.ts` did not exist. | Focused client tests passed after Zod schemas and the timed fetch client were added. | URL encoding, timeout abort, HTTP, JSON, DTO, network, and recent DTO paths. | Extracted URL construction and JSON parsing from the request boundary. |
| 2.2 | `tests/ttl-cache.test.ts` | Unit | N/A (new) | `npm test -- --run tests/ttl-cache.test.ts` failed because `src/cache/ttl-cache.ts` did not exist. | Focused cache tests passed after `TtlCache` was added. | Fresh hit, exact-expiry eviction, SteamID-key isolation, and clear. | Kept expiry deletion co-located with cache reads. |
| 2.3 | `tests/steam-service.test.ts` | Unit | N/A (new) | `npm test -- --run tests/steam-service.test.ts` failed because `src/services/steam-service.ts` did not exist. | Focused service tests passed after normalized library behavior was added. | Cache hit/expiry, failed refresh, normalization, search, lookup, recent 1–50 bounds, and stats. | Isolated cache-key, count validation, game normalization, and image URL helpers. |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Unit 1 focused tests | `npm test -- --run tests/config-domain.test.ts` → exit 0; 1 file and 9 tests passed. |
| Unit 1 runtime harness | `npm run typecheck` → exit 0; strict NodeNext ESM compilation, with no Steam/stdio runtime boundary in that unit. |
| Unit 1 lint / format | `npm run lint` and `npm run format:check` → exit 0. |
| Unit 1 rollback boundary | Revert the foundation commit to remove tooling, `src/config.ts`, `src/domain/models.ts`, `src/errors.ts`, and its tests without affecting later Steam client/service/tool work. |
| Unit 2 focused tests | `npm test -- --run tests/steam-client.test.ts tests/ttl-cache.test.ts tests/steam-service.test.ts` → exit 0; 3 files and 15 tests passed. |
| Unit 2 runtime harness | Stubbed native-fetch scenario exercised encoded request URLs, a real `AbortController` signal at 10,000 ms, HTTP/JSON/DTO failures, cache expiry, and failed refreshes → exit 0. |
| Unit 2 type / lint / format | `npm run typecheck`, `npm run lint`, and `npm run format:check` → exit 0. |
| Unit 2 rollback boundary | Revert this work-unit commit to remove `src/steam/`, `src/cache/`, `src/services/`, and `tests/steam-client.test.ts`, `tests/ttl-cache.test.ts`, `tests/steam-service.test.ts` without removing the foundation or future MCP tools. |

## Delivery

- Mode: chained PR slice (`auto-chain`)
- Chain strategy: `feature-branch-chain`
- Current work unit: 2 — Steam boundary, TTL cache, and service
- Base / target branch: `codex/steam-library-core-foundation`
- Native attempt token: `sha256:fc3e03f7edecc16edeb16294efd1213311accd357350fc304f94d1268ee06d8b`

## Remaining Tasks

- [ ] 3.1–3.3 Implement MCP tools and stdio composition.
- [ ] 4.1–4.2 Complete end-to-end verification and documentation.
