# Proposal: Gaming Tracker

## Intent

Add durable, user-controlled game progress tracking to the coordinated MCP release without confusing Steam playtime with personal completion state. Steam remains authoritative for ownership; the tracker records only explicit status choices for the configured single user.

## Scope

### In Scope
- Local SQLite persistence with versioned, testable migrations and statuses `backlog`, `playing`, `completed`, `dropped`, and `paused`.
- Six MCP tools: `gaming_get_backlog`, `gaming_get_current_game`, `gaming_mark_playing`, `gaming_mark_completed`, `gaming_mark_dropped`, and `gaming_get_completed`.
- Ownership validation against Steam before writes; not-owned app IDs return one stable safe outcome and never create or modify tracker rows.
- Validated, parameterized, atomic writes. Marking a new current game transitions any prior `playing` game to `paused` in the same transaction.
- TDD and behavior-oriented work-unit commits containing implementation, tests, and relevant documentation.

### Out of Scope
- Recommendations, ratings, notes, playtime-derived completion, multi-user accounts, cloud synchronization, and IGDB metadata or enrichment.
- Importing inferred statuses from existing Steam activity.

## Capabilities

### New Capabilities
- `gaming-tracker-state`: Personal status lifecycle, SQLite persistence, migrations, ownership checks, and single-current-game invariant.
- `gaming-tracker-tools`: Contracts for the six tracker MCP tools, including empty states and predictable rejected writes.

### Modified Capabilities
- `steam-library-tools`: Replace the core change's “exactly five tools” discovery constraint so Steam query tools can coexist with tracker tools in the coordinated release.

## Approach

Place a tracker application service between MCP adapters, the Steam ownership service, and a SQLite repository. Validate inputs before I/O, confirm ownership before mutation, and execute status transitions in transactions using bound parameters. Inject repository, ownership, and clock boundaries for deterministic unit and migration tests.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/` | Modified | Tracker domain, service, SQLite adapter, migrations, and tools |
| `tests/` | Modified | Lifecycle, ownership, migration, and MCP contract tests |
| `README.md` | Modified | Tracker setup, storage, tools, and recovery guidance |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Database corruption or migration failure | Low | Transactional migrations, version checks, backup guidance |
| Ownership changes after tracking | Medium | Steam remains authoritative; reads expose status only for currently owned games |
| Unsafe or conflicting writes | Low | Validation, parameter binding, transactions, single-writer tests |

## Rollback Plan

Revert tracker work-unit commits and restore the pre-migration database backup. Never silently delete the user's database; incompatible schema versions fail safely with recovery guidance.

## Dependencies

- Steam Library Core ownership lookup and MCP foundation.
- A maintained SQLite driver compatible with the selected Node.js LTS runtime.

## Success Criteria

- [ ] All six tools satisfy documented contracts across empty, owned, not-owned, and upstream-failure cases.
- [ ] Status survives restart; migrations are repeatable and fail atomically.
- [ ] No status is inferred from playtime, and rejected writes leave storage unchanged.
- [ ] Focused tests and coordinated release checks pass; each work unit remains independently reversible.
