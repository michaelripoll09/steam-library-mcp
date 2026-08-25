# Tasks: Gaming Tracker

Prerequisites: Steam Library Core ownership service and MCP foundation must be merged first; IGDB/enrichment is not a dependency and is out of scope. Use strict RED → GREEN → REFACTOR. Each work unit ends with a small conventional commit and push only after its focused checks pass.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 650–850 authored lines across source, tests, config, README |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR/base | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Domain/config and SQLite dependency | PR 1; base=feature/gaming-tracker | `npm test -- --run tests/tracker/domain.test.ts` | `npm run typecheck`; no network | package/config and `src/domain/tracker.ts` |
| 2 | Versioned persistence and migrations | PR 2; base=PR 1 | `npm test -- --run tests/tracker/sqlite` | Temp SQLite: migrate, restart, checksum/newer-version failure | `src/tracker/sqlite/**` and migration tests |
| 3 | Ownership-aware lifecycle service | PR 3; base=PR 2 | `npm test -- --run tests/tracker/service.test.ts` | Fake Steam ownership: mark A then B; verify A paused atomically | `src/tracker/gaming-tracker-service.ts` and unit tests |
| 4 | MCP tools, stdio, docs | PR 4; base=PR 3 | `npm test -- --run tests/tools/gaming-tools.test.ts` | Built stdio: discover 11 tools, malformed input, stdout/error redaction | tool/server wiring, contract tests, README |

## Phase 1: Foundation

- [ ] 1.1 RED: add failing Vitest smoke/domain tests; GREEN: add `better-sqlite3` 13, TypeScript types, DB-path config, and strict TDD commands; REFACTOR: centralize status/error constants.
- [ ] 1.2 RED: test status vocabulary, immutable contracts, and safe serialization; GREEN: create `src/domain/tracker.ts`; REFACTOR: keep ports readonly and driver-independent.

## Phase 2: SQLite Persistence

- [ ] 2.1 RED: test migration recovery, repeatability, checksum mismatch, unsupported newer version, and atomic failure; GREEN: create `src/tracker/sqlite/database.ts` and `migrations.ts`; REFACTOR: isolate immutable checksums and `BEGIN IMMEDIATE`.
- [ ] 2.2 RED: test parameter binding, unique partial `playing` index, ordering, and rollback; GREEN: create `tracker-repository.ts`; REFACTOR: expose transaction-scoped writer only.

## Phase 3: Service

- [ ] 3.1 RED: test invalid `appId` before Steam/SQLite, not-owned and unavailable ownership with no writes; GREEN: create `src/tracker/gaming-tracker-service.ts`; REFACTOR: map typed safe errors.
- [ ] 3.2 RED: test explicit marks, idempotency, restart durability, backlog/current/completed filtering, and atomic A→paused/B→playing; GREEN: complete service; REFACTOR: inject clock and simplify read projection.

## Phase 4: MCP Integration / Release

- [ ] 4.1 RED: test six strict schemas, empty envelopes, exact success/not-owned/error contracts, registration no-write, protocol-only stdout, and redaction of paths/SQL/secrets/provider payloads; GREEN: create `src/tools/register-gaming-tools.ts` and wire `src/server.ts`; REFACTOR: keep adapters thin.
- [ ] 4.2 RED: add stdio restart and migration-failure scenarios; GREEN: update `README.md` with local SQLite backup/recovery; REFACTOR: run full quality gates and push each verified unit.
