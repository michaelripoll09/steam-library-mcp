# Dashboard UI 2.0 final fixes

## Scope

UI-only final-review corrections. No API, domain, or image changes.

## Corrections

- Loaded manual collection and backlog plans once at dashboard initialization, independently of navigation; mutation paths retain their explicit refreshes.
- Replaced Home's pre-library zero totals with loading, error, and unavailable states, and added total playtime once a library snapshot exists.
- Restored the cover fallback sequence: supplied cover, official Steam icon, then generated gradient.
- Added semantic progress-bar ARIA values and a reusable `InlineNotice` primitive with info, success, warning, and error tones; the manual collection UI uses it for guidance and errors.

## Regression coverage

- RED: `npm test -- tests/dashboard-ui/app.test.tsx` failed with six expected behavior failures before implementation (initial manual/backlog load, cover fallback, Home loading/error, progress semantics, notice semantics).
- GREEN: focused suite passes with 61 tests.

## Verification

- `npm test -- tests/dashboard-ui/app.test.tsx` — 61 passed.
- `npm run typecheck:dashboard` — passed.
- `npm run lint` — passed.
- `npm run dashboard:build` — passed.
- `git diff --check` — passed.

## Risks

- The additional initial requests are intentional and occur only when the supplied API exposes the matching manual/intelligence capabilities.

## Terminal review fixes — 2026-09-05

### Corrections

- `TasksView` now uses `TaskState.hasLoaded` to distinguish pending loading, an initial-load failure, and a confirmed empty task list. It never renders the empty state while a request is pending or has failed.
- Backlog progress selections now live in `useIntelligenceState` as keyed client-side drafts. The API PATCH remains unchanged and is called only when the user selects **Actualizar progreso**; a successful save clears that draft.

### Regression evidence

- RED: `npm test -- --run tests/dashboard-ui/task-controls.test.tsx tests/dashboard-ui/app.test.tsx` failed with the expected missing loading-state role and discarded Backlog draft.
- GREEN: the same focused command passed 68 tests after the fixes.
- `npm run typecheck` passed both server and dashboard TypeScript projects.

### Scope and risks

- No server contracts, request payloads, persistent storage, images, or worktrees changed.
- Drafts are scoped to the mounted dashboard session and are intentionally cleared only after the corresponding save succeeds; failed saves retain the user's selected value.
