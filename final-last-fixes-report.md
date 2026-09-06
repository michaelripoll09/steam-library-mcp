# Final Dashboard UI 2.0 fixes

- Added `hasLoaded` provenance to shared task state so Home does not render an unverified zero-task count before the first `getTasks` request settles.
- Home now shows compact loading, error, and empty task summaries.
- Added regression coverage for pending, failed, and empty initial task loads while retaining the shared polling and stale-response protections.
- Repaired the literal PowerShell escape sequences in the documented TypeScript snippets only.

Verification:

- RED: focused regression assertions failed before the implementation because Home rendered `0 tareas` and `Revisar tareas`.
- GREEN: `npx vitest run tests/dashboard-ui/app.test.tsx tests/dashboard-ui/task-controls.test.tsx` (66 passing).
- `npm run typecheck` passed.
- `npx prettier --check dashboard-ui/src/task-state.ts dashboard-ui/src/views/home-view.tsx tests/dashboard-ui/app.test.tsx` passed.
- `npx eslint dashboard-ui/src/task-state.ts dashboard-ui/src/views/home-view.tsx tests/dashboard-ui/app.test.tsx` passed.

## Backlog save race

- Kept a keyed progress draft after a successful save whenever the draft no longer matches the progress submitted by that request.
- Added a deferred-save regression: changing the selection to `En progreso` while a prior `Hecho` save is pending keeps the newer local draft after the API response and plan refresh.

Verification:

- RED: `npm test -- --run tests/dashboard-ui/app.test.tsx -t "keeps a newer backlog progress draft when an earlier save resolves"` failed with `Expected En progreso; Received Sin iniciar` before the state guard.
- GREEN: the same focused regression passed; `npm test -- --run tests/dashboard-ui/app.test.tsx` passed (65 tests); `npm run typecheck:dashboard` passed.
