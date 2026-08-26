# Apply Progress: Gaming Tracker

**Artifact store:** Hybrid (OpenSpec copy; Engram synchronization requires the orchestrator memory adapter.)
**Delivery strategy:** `auto-chain`
**Chain strategy:** `feature-branch-chain`
**Current work unit:** 3 complete — Ownership-aware lifecycle service (PR 3 base: PR 2)

## Completed Tasks

- [x] 1.1 Configure the SQLite dependency, tracker database path, and foundation tests. Commit: `e16b93d` (`feat(tracker): configure sqlite foundation`).
- [x] 1.2 Add immutable tracker domain contracts. Commit: `8220c09` (`feat(tracker): add domain contracts`).
- [x] 2.1 Add transactional, checksum-verified SQLite migrations and database opening. Commit: pending this work unit.
- [x] 2.2 Add the transaction-scoped SQLite repository and single-current-game index. Commit: pending this work unit.
- [x] 3.1 Add ownership-gated mark validation and safe typed errors. Commit: pending this work unit.
- [x] 3.2 Complete explicit lifecycle transitions and derived views. Commit: pending this work unit.
- [x] 4.1 Register tracker MCP tools and server composition. Commit: pending this work unit.
- [x] 4.2 Document local SQLite backup/recovery and complete quality gates. Commit: pending this work unit.
- [x] 4.2 correction: add tracker stdio restart and newer-schema recovery evidence. Commit: pending this work unit.

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/config-domain.test.ts`, `tests/tracker/domain.test.ts` | Unit | Prior completed work | Prior completed work | Prior completed work (`e16b93d`) | Prior completed work | Prior completed work |
| 1.2 | `tests/tracker/domain.test.ts` | Unit | Prior completed work | Prior completed work | Prior completed work (`8220c09`) | Prior completed work | Prior completed work |
| 2.1 | `tests/tracker/sqlite/migrations.test.ts` | Integration | N/A (new files) | `npm test -- --run tests/tracker/sqlite/migrations.test.ts` exited 1 because `migrations.js` did not exist. | Same command passed: 1 file, 5 tests. | File-backed restart, edited checksum, future-version, and rollback scenarios exercise separate paths. | Prettier normalized the new source/test files; focused tests remained green. |
| 2.2 | `tests/tracker/sqlite/tracker-repository.test.ts` | Integration | `tests/tracker/sqlite/migrations.test.ts` passed: 1 file, 5 tests. | `npm test -- --run tests/tracker/sqlite/tracker-repository.test.ts` exited 1 because `tracker-repository.js` did not exist. | `npm test -- --run tests/tracker/sqlite` passed: 2 files, 10 tests. | Bound malicious status input, partial unique index, ordering, rollback, and escaped-writer scenarios exercise separate paths. | Prettier normalized the changed source/test files; focused tests remained green. |
| 3.1 | `tests/tracker/service.test.ts` | Unit | `npm test -- --run tests/config-domain.test.ts` passed: 1 file, 9 tests. | `npm test -- --run tests/tracker/service.test.ts` exited 1 because `gaming-tracker-service.js` did not exist. | Service and error tests passed: 2 files, 17 tests. | Invalid IDs, not-owned, unavailable ownership, persistence failure, and safe serialization exercise separate paths. | Tracker errors reuse the centralized domain messages; the runtime type guard precedes safe-integer validation. |
| 3.2 | `tests/tracker/service.test.ts` | Integration | `npm test -- --run tests/tracker/service.test.ts` passed: 1 file, 8 tests. | Lifecycle tests failed on the missing A→paused/B→playing transition and absent read methods. | Service tests passed: 1 file, 10 tests. | Explicit marks, idempotency, restart durability, backlog/current/completed views, and replacement-current paths are covered. | Reused injected clock and repository boundary. |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `npm test -- --run tests/tracker/sqlite/migrations.test.ts` — passed (1 file, 5 tests). |
| Runtime harness | Temporary SQLite database migrated, closed, reopened, and rechecked; checksum mismatch, unsupported newer version, and invalid migration all produced the expected safe failure/rollback behavior in the focused test run. |
| Static checks | `npm run typecheck`, `npm run lint`, and `npm run format:check` passed. |
| Native driver installation | `npm rebuild better-sqlite3` succeeded; `node --input-type=module -e "await import('better-sqlite3')"` printed `better-sqlite3 import OK`. |
| Rollback boundary | Revert `src/tracker/sqlite/database.ts`, `src/tracker/sqlite/migrations.ts`, `tests/tracker/sqlite/migrations.test.ts`, and this task/progress update. No user database is deleted. |
| 2.2 focused test command | `npm test -- --run tests/tracker/sqlite` — passed (2 files, 10 tests). |
| 2.2 runtime harness | In-memory SQLite exercised parameter binding, the `playing` partial index, transactional rollback, ordering, and closed-writer rejection. |
| 2.2 static checks | `npm run typecheck`, `npm run lint`, and `npm run format:check` passed. |
| 2.2 rollback boundary | Revert `src/tracker/sqlite/tracker-repository.ts`, migration 2 in `migrations.ts`, `tests/tracker/sqlite/tracker-repository.test.ts`, and this task/progress update. |
| 3.1 focused test command | `npm test -- --run tests/tracker/service.test.ts tests/config-domain.test.ts` — passed (2 files, 17 tests). |
| 3.1 runtime harness | Faked ownership and repository boundaries prove invalid/not-owned/unavailable requests perform no write; storage errors are typed and safely serialized. |
| 3.1 static checks | `npm run typecheck`, `npm run lint`, and `npm run format:check` passed. |
| 3.1 rollback boundary | Revert `src/tracker/gaming-tracker-service.ts`, tracker error additions in `src/errors.ts`, `tests/tracker/service.test.ts`, and this task/progress update. |
| 3.2 focused test command | `npm test -- --run tests/tracker/service.test.ts` — passed (1 file, 10 tests). |
| 3.2 runtime harness | File-backed SQLite restart plus in-memory atomic current-game replacement and derived views. |
| 3.2 rollback boundary | Revert the lifecycle service/test changes and this task/progress update. |

## Remaining Tasks

- [ ] 4.1 Register and wire the six tracker MCP tools.
- [ ] 4.2 Add stdio/recovery scenarios, documentation, and final quality gates.

## Notes

- Migration history is immutable through SHA-256 checksums derived from each migration definition and verified against `schema_migrations` before pending DDL runs.
- Every migration batch executes under `BEGIN IMMEDIATE`; errors roll back the migration table and all DDL in the batch.
- Migration 2 adds the partial `playing` index; the repository binds every value, orders by `updated_at DESC, app_id ASC`, and invalidates writers once their transaction ends.
- Task 3.1 validates positive safe-integer app IDs before I/O and checks ownership before starting a repository transaction. Current-game replacement and read projections remain task 3.2.
- Task 3.2 pauses any previous current game inside the same transaction, exposes ownership-filtered derived reads, and preserves explicit state across restart.
