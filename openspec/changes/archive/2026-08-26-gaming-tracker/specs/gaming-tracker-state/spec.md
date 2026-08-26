# gaming-tracker-state Specification

## Purpose

Persist explicit personal game statuses while Steam remains authoritative for ownership.

## Requirements

### Requirement: Versioned SQLite persistence

The tracker MUST persist `appId`, one status (`backlog`, `playing`, `completed`, `dropped`, or `paused`), and `updatedAt` in a versioned SQLite schema. Migrations MUST be schema-only, transactional, repeatable, checksum-verified, and reject unsupported versions without changing user data.

#### Scenario: Migration recovery
- GIVEN an older supported database
- WHEN startup applies migrations
- THEN the schema reaches the current version atomically and a second startup makes no further change

#### Scenario: Migration failure
- GIVEN a migration cannot complete, has a checksum mismatch, or the database is newer than supported
- WHEN startup opens the database
- THEN startup fails with the safe `PERSISTENCE_FAILURE` code and recovery guidance, while preserving the prior schema and rows

### Requirement: Explicit status lifecycle

Only mark commands MAY change status: mark-playing sets `playing`, mark-completed sets `completed`, and mark-dropped sets `dropped`; any owned game may transition to a mark target. Repeated marks MUST be idempotent (`outcome:'unchanged'`). Steam playtime MUST NOT infer status. Backlog reads MAY include owned games with no row, `backlog`, or `paused`.

#### Scenario: Explicit transition
- GIVEN an owned game and a valid mark command
- WHEN the command is applied
- THEN only the requested status is persisted and playtime is ignored

### Requirement: Ownership gate before mutation

Every mark operation MUST validate a positive safe-integer `appId`, query ownership before opening a write transaction, and perform no repository write when ownership is false or the lookup fails. Not-owned MUST return `{ outcome: 'not_owned', appId }`; lookup failure MUST return an `OWNERSHIP_UNAVAILABLE` error envelope.

#### Scenario: Rejected ownership
- GIVEN `appId` is not owned or Steam ownership is unavailable
- WHEN a mark command is called
- THEN it returns the canonical rejection/error and tracker rows remain unchanged

### Requirement: Atomic single-current invariant

At most one row MAY be `playing`. Marking a new owned game as `playing` MUST pause any prior `playing` row and set the target to `playing` in one transaction; failure MUST roll back both changes.

#### Scenario: Replace current game
- GIVEN game A is `playing` and game B is owned
- WHEN B is marked `playing`
- THEN A is `paused`, B is `playing`, and the commit is atomic

### Requirement: Safe validated writes

Malformed input MUST return `{error:{code:'INVALID_INPUT',message}}` before Steam or SQLite access. Persistence failures MUST return `{error:{code:'PERSISTENCE_FAILURE',message}}` and MUST NOT claim an uncommitted change.

#### Scenario: Invalid appId
- GIVEN `appId` is missing, non-integer, or non-positive
- WHEN any mark tool receives it
- THEN validation fails before external or database access
