# gaming-tracker-tools Specification

## Purpose

Expose stable MCP contracts for tracker reads and explicit status commands.

## Requirements

### Requirement: Required tracker tool surface

The coordinated server MUST register all six tracker tools with strict schemas: `gaming_get_backlog`, `gaming_get_current_game`, `gaming_mark_playing`, `gaming_mark_completed`, `gaming_mark_dropped`, and `gaming_get_completed`. Getter inputs MUST be `{}`; mark inputs MUST be `{appId: positive safe integer}`.

#### Scenario: Discovery
- GIVEN a connected MCP client
- WHEN it lists tools
- THEN all six names appear exactly once with their required schemas

### Requirement: Canonical read contracts

`gaming_get_backlog` and `gaming_get_completed` MUST return `{games: Game[]}` ordered by `updatedAt` descending then `appId`; `gaming_get_current_game` MUST return `{game: Game|null}`. Empty reads MUST return `{games:[]}` or `{game:null}` and MUST NOT mutate storage.

#### Scenario: Empty reads
- GIVEN no owned games match a requested status and no current game exists
- WHEN each getter is called
- THEN it returns its canonical empty envelope

### Requirement: Canonical mutation contracts

`gaming_mark_playing`, `gaming_mark_completed`, and `gaming_mark_dropped` MUST return exactly `{ outcome: 'updated'|'unchanged', appId, status }` on success. A not-owned app MUST return `{ outcome: 'not_owned', appId }`; no rejected mark may partially succeed.

#### Scenario: Successful mark
- GIVEN a valid owned `appId`
- WHEN a mark tool is called
- THEN the canonical success envelope is returned and the same status is visible after restart

### Requirement: Safe MCP error envelopes

Validation, ownership, and persistence failures MUST use `{ error: { code, message } }` with only these tool-level codes: `INVALID_INPUT`, `OWNERSHIP_UNAVAILABLE`, and `PERSISTENCE_FAILURE`. Migration failures are startup/stdio failures, not tool envelopes. Messages MUST NOT expose SQL, credentials, filesystem paths, or raw provider payloads.

#### Scenario: Persistence failure
- GIVEN SQLite rejects a read or transaction
- WHEN a tracker tool is called
- THEN it returns `{ error: { code: 'PERSISTENCE_FAILURE', message } }` and does not claim a status change
