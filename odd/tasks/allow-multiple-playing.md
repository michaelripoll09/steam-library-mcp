# Allow multiple games marked playing

## Goal
Allow `Blasphemous 2` and `SILENT HILL 2` (and other games) to remain simultaneously marked `playing`, and make `gaming_get_current_game` return all currently playing games.

## Scope
- Change tracker behavior so marking a game `playing` no longer pauses another game.
- Add a forward migration that removes the legacy one-playing unique index without changing migration history.
- Update the tracker service/tool contract from one current game to a list.
- Preserve existing completed, paused, dropped, and backlog behavior.
- Add regression tests for multiple playing games and migration compatibility.

## Non-goals
- No Steam-side status changes.
- No migration or schema redesign unless exploration proves it necessary.
- No dashboard redesign unless compilation requires a narrow type update.

## Tasks
1. Map tracker status contracts and tests.
2. Support multiple playing games.
3. Add regression coverage and run checks.

## Evidence
- User selected: `gaming_get_current_game` should return several playing games.
- Existing behavior observed: `setStatus` calls `pauseCurrent` before setting `playing`.
- Worker RED/GREEN evidence: focused suite passed 52 tests after adding multi-playing coverage.
- Verification: focused suite 52/52 passed; `npm run typecheck:server` passed; `git diff --check` passed.
- Runtime MCP check: `SILENT HILL 2` and `Blasphemous 2` both return with status `playing`.
- No commit created because repository safety policy requires explicit user request for commits.

## Risk
Legacy databases with an inconsistent migration-2 state lacking `one_playing_entry` are not covered; normal tracked upgrade history is covered.
