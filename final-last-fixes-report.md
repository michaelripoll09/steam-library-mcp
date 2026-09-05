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
