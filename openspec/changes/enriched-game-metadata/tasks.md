# Tasks: Enriched Game Metadata

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 600–850 authored lines across client, service, tools, tests, docs |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR #1 client/config → PR #2 normalization/cache/service → PR #3 MCP tools/contracts/docs |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Secure IGDB OAuth/client boundary | PR #1 (base = feature/tracker branch) | `npm exec vitest run tests/igdb/client.test.ts tests/config.test.ts` | Stubbed fetch: invalid config, timeout, 429 | Revert `src/igdb/*`, config/error changes, and unit tests |
| 2 | Normalize owned metadata with cache/rate-limit policy | PR #2 (base = PR #1 branch) | `npm exec vitest run tests/services/metadata-service.test.ts tests/domain/metadata.test.ts` | Fake clock/client: TTL, stale fallback, concurrency 4 | Revert `src/domain/metadata.ts`, `src/services/metadata-service.ts`, tests |
| 3 | Expose seven-tool MCP contracts and docs | PR #3 (base = PR #2 branch) | `npm exec vitest run tests/tools/metadata-tools.test.ts tests/integration/tool-discovery.test.ts` | Built stdio MCP scenario: discover seven tools and query owned metadata | Unregister two metadata tools and revert tool/schema/README changes |

## Phase 1: IGDB Boundary (PR #1)

- [x] 1.1 RED: add failing tests for lazy IGDB config, exact unavailable envelope, secret redaction, OAuth schema, 10s timeout, invalid payload, and exactly one 429 retry.
- [x] 1.2 GREEN: modify `src/config.ts`, `src/errors.ts`; create `src/igdb/schemas.ts`, `token-provider.ts`, `client.ts` using free Twitch credentials and no paid infrastructure.
- [x] 1.3 REFACTOR: centralize safe messages, injectable fetch/clock/backoff, and ensure validated values only are returned/cached; commit `feat(metadata): add secure IGDB client boundary`.

## Phase 2: Owned Metadata Service (PR #2)

- [x] 2.1 RED: add tests for ownership-before-IGDB, category `1` + exact UID matching, lowest-ID tie-break, normalization/status, filters, 24h/1h/7d TTLs, and concurrency limit four.
- [x] 2.2 GREEN: create `src/domain/metadata.ts` and `src/services/metadata-service.ts`; integrate existing Steam ownership lookup, cache, stale fallback, and bounded rate-limit behavior.
- [x] 2.3 REFACTOR: isolate deterministic matching/filter helpers and preserve no recommendation/ranking/scoring fields; commit `feat(metadata): add owned normalization and cache`.

## Phase 3: MCP Surface and Verification (PR #3)

- [x] 3.1 RED: add contract tests for exact seven-tool discovery, input rejection before upstream calls, metadata error/success shapes, filter semantics, and unaffected five Steam tools.
- [x] 3.2 GREEN: modify `src/tools/schemas.ts`, `src/server.ts`; create `src/tools/register-metadata-tools.ts`; update `README.md` with free IGDB/Twitch setup and rollback behavior.
- [x] 3.3 REFACTOR: run built stdio integration, verify no tracker/recommendation behavior, and commit `feat(metadata): expose owned game metadata tools`.

## Bounded V3 Contract Remediation

- [x] R1 RED/GREEN: restore metadata query `limit` bounds/default/truncation and the exact top-level unavailable envelope.
- [x] R2 RED/GREEN: cover optional partial metadata, negative-cache expiry, seven-day stale cutoff, successful payloads, and invalid year ranges.
- [x] R3 REFACTOR: align the design with the unified thirteen-tool surface and run the bounded quality suite.
