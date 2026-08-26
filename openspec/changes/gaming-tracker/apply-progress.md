# Apply Progress: Gaming Tracker

**Artifact store:** Hybrid (OpenSpec copy; Engram synchronization requires the orchestrator memory adapter.)
**Delivery strategy:** `auto-chain`
**Chain strategy:** `feature-branch-chain`
**Current work unit:** 2 — Versioned persistence and migrations (PR 2 base: PR 1)

## Completed Tasks

- [x] 1.1 Configure the SQLite dependency, tracker database path, and foundation tests. Commit: `e16b93d` (`feat(tracker): configure sqlite foundation`).
- [x] 1.2 Add immutable tracker domain contracts. Commit: `8220c09` (`feat(tracker): add domain contracts`).
- [x] 2.1 Add transactional, checksum-verified SQLite migrations and database opening. Commit: pending this work unit.

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/config-domain.test.ts`, `tests/tracker/domain.test.ts` | Unit | Prior completed work | Prior completed work | Prior completed work (`e16b93d`) | Prior completed work | Prior completed work |
| 1.2 | `tests/tracker/domain.test.ts` | Unit | Prior completed work | Prior completed work | Prior completed work (`8220c09`) | Prior completed work | Prior completed work |
| 2.1 | `tests/tracker/sqlite/migrations.test.ts` | Integration | N/A (new files) | `npm test -- --run tests/tracker/sqlite/migrations.test.ts` exited 1 because `migrations.js` did not exist. | Same command passed: 1 file, 5 tests. | File-backed restart, edited checksum, future-version, and rollback scenarios exercise separate paths. | Prettier normalized the new source/test files; focused tests remained green. |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `npm test -- --run tests/tracker/sqlite/migrations.test.ts` — passed (1 file, 5 tests). |
| Runtime harness | Temporary SQLite database migrated, closed, reopened, and rechecked; checksum mismatch, unsupported newer version, and invalid migration all produced the expected safe failure/rollback behavior in the focused test run. |
| Static checks | `npm run typecheck`, `npm run lint`, and `npm run format:check` passed. |
| Native driver installation | `npm rebuild better-sqlite3` succeeded; `node --input-type=module -e "await import('better-sqlite3')"` printed `better-sqlite3 import OK`. |
| Rollback boundary | Revert `src/tracker/sqlite/database.ts`, `src/tracker/sqlite/migrations.ts`, `tests/tracker/sqlite/migrations.test.ts`, and this task/progress update. No user database is deleted. |

## Remaining Tasks

- [ ] 2.2 Add the SQLite repository, parameter binding, unique partial `playing` index, ordering, and transaction-scoped writer.
- [ ] 3.1 Add ownership-aware lifecycle validation and safe errors.
- [ ] 3.2 Complete status transitions and derived views.
- [ ] 4.1 Register and wire the six tracker MCP tools.
- [ ] 4.2 Add stdio/recovery scenarios, documentation, and final quality gates.

## Notes

- Migration history is immutable through SHA-256 checksums derived from each migration definition and verified against `schema_migrations` before pending DDL runs.
- Every migration batch executes under `BEGIN IMMEDIATE`; errors roll back the migration table and all DDL in the batch.
- The unique partial `playing` index and repository are deliberately deferred to task 2.2. No Phase 3 work was implemented.
