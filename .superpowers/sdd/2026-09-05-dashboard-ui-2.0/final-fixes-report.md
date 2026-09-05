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
