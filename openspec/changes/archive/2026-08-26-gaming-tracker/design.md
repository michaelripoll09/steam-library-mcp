# Design: Gaming Tracker

## Technical Approach

Add a tracker slice beside Steam: MCP adapters call `GamingTrackerService` through ownership, clock, and SQLite ports. Reads combine current ownership with explicit choices; only explicit `gaming_mark_*` invocations change status rows. Startup may migrate schema but never status rows.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|---|---|---|---|
| SQLite driver | `better-sqlite3` 13 on Node >=22 | `node:sqlite`; async `sqlite3` | Synchronous transactions fit a single-user stdio process. `node:sqlite` remains release-candidate; isolate the driver. |
| Schema | `tracker_entries(appId INTEGER PRIMARY KEY, status TEXT CHECK(...), createdAt TEXT, updatedAt TEXT)`, `schema_migrations(version, name, checksum, appliedAt)`, and a unique partial `playing` index | Event log; ORM | Database-enforced vocabulary/current-game invariant with auditable timestamps and no metadata coupling. |
| Migrations | Immutable TypeScript migrations under `BEGIN IMMEDIATE`; verify checksums and reject newer versions | Ad-hoc DDL; `user_version` | Repeatable tests, atomic failure, edited-history detection. Migrations change schema only. |
| Transactions | Repository owns `transaction(work)` with a transaction-scoped writer | Independent service writes | Pausing the prior current game and upserting the new one commit or roll back together. |
| Ownership | Inject `OwnershipLookup.getOwnedGames()`, backed by cached `SteamService.getLibrary()` | Direct Steam API calls | Reuses normalized Steam authority and makes rejection/failure tests deterministic. |
| Statuses | Explicit marks persist `playing`, `completed`, or `dropped`; replacement writes `paused`; stored `backlog` is reserved for migration/future commands. Backlog reads derive owned games with no row, `backlog`, or `paused`. | Seed on reads; infer from playtime | Reads remain useful and side-effect free; absence is availability, not a persisted claim. Repeated marks are idempotent with unchanged timestamp. |
| Rejection | Not-owned is a stable non-error outcome; validation, Steam, and storage failures are typed safe errors | Throw for not-owned | Expected ownership rejection stays distinct and no failure claims an uncommitted write. |

## Data Flow

`MCP schema -> tracker adapter -> GamingTrackerService -> OwnershipLookup -> SteamService`

`                                             -> TrackerRepository -> SQLite`

Getters fetch ownership, read rows, and filter no-longer-owned entries. Mark handlers validate `appId`, confirm ownership, then invoke one transaction. Registration and startup never call a mark method.

## File Changes

| File | Action | Description |
|---|---|---|
| `package.json`, `src/config.ts`, `src/server.ts` | Modify | Add driver/types, stable DB-path configuration, mandatory tracker composition and registration. |
| `src/domain/tracker.ts` | Create | Status, view, result, repository, ownership, and clock contracts. |
| `src/tracker/gaming-tracker-service.ts` | Create | Ownership-aware reads and explicit transitions. |
| `src/tracker/sqlite/{database,migrations,tracker-repository}.ts` | Create | Connection, migrations, prepared SQL, transactions. |
| `src/tools/register-gaming-tools.ts` | Create | Six strict MCP schemas/adapters. |
| `tests/tracker/**/*.test.ts`, `tests/tools/gaming-tools.test.ts` | Create | Unit, persistence, transaction, registration, and envelope contracts. |
| `README.md` | Modify | Tools, statuses, storage, backup/recovery. |

## Interfaces / Contracts

```ts
type GameStatus = 'backlog'|'playing'|'completed'|'dropped'|'paused';
type TrackerGame = { appId:number; name:string; status:GameStatus;
  createdAt:string|null; updatedAt:string|null };
interface OwnershipLookup { getOwnedGames(): Promise<readonly SteamGame[]> }
interface TrackerRepository { list(): readonly TrackerEntry[];
  transaction<T>(work:(tx:TrackerWriter)=>T):T }
interface TrackerWriter { pauseCurrent(exceptAppId:number, at:string):void;
  setStatus(appId:number, status:GameStatus, at:string):boolean }
```

Inputs are `{}` for getters and `{appId: positive safe integer}` for marks; unknown keys fail. Canonical JSON envelopes, serialized as one MCP text item, are:

- backlog/completed: `{games: TrackerGame[]}`; empty is `{games:[]}`.
- current: `{game: TrackerGame|null}`; empty is `{game:null}`.
- mark success: `{outcome:'updated'|'unchanged', appId, status}`.
- not-owned: `{outcome:'not_owned', appId}`.
- error (`isError:true`): `{error:{code,message}}`; codes/messages are `INVALID_INPUT` / `"appId must be a positive safe integer."`, `OWNERSHIP_UNAVAILABLE` / `"Steam ownership could not be verified. Try again later."`, and `PERSISTENCE_FAILURE` / `"Tracker storage is unavailable. Check the database path and try again."`.

Derived untracked backlog views use `status:'backlog'` and null timestamps. Collections order by `updatedAt` descending (null last), then `appId`. The coordinated server MUST always register all six named tracker tools alongside the five Steam tools; tracker registration is not optional.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | Transitions, backlog, ownership, idempotency | Vitest fakes; prove no repository call before a valid explicit mark. |
| Integration | Migrations, checksums, constraints, parameters, rollback/restart | Temporary/in-memory SQLite. |
| Contract/E2E | Eleven-tool discovery, exact envelopes/errors, stdio purity | SDK in-memory transport and built stdio scenario. |

## Threat Matrix

Documentation-like paths, Git selection, commit, push, and PR commands are **N/A**: no executable classification or VCS automation. Existing stdio integration is applicable: registration performs no status write; malformed input fails before ownership/storage; stdout remains protocol-only; failures reveal no path, SQL, secret, or provider payload. Contract/E2E RED tests cover these behaviors.

## Migration / Rollout

Create the parent directory, back up an existing database, and migrate before transport connection. Migration/schema failures terminate startup safely before MCP transport and are never tool envelopes. Rollback restores the backup; never delete the database automatically.

## Open Questions

None.
