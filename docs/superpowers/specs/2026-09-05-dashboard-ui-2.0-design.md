# Dashboard UI 2.0 Design

Dashboard UI 2.0 reorganizes the existing dashboard into a state-driven application shell with focused views. It changes presentation and client-side composition only: server endpoints, MCP tools, persistence, recommendation semantics, and existing API contracts remain unchanged.

## Decision summary

| Area          | Decision                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Navigation    | Use local `activeView` state; do not add React Router or dependencies.                                   |
| Layout        | Introduce a persistent `AppShell` with sidebar navigation and top bar.                                   |
| Shared state  | Keep API clients, loaded data, filters, selections, mutation state, and achievement caches in `app.tsx`. |
| Content       | Render focused Home, Library, Play Now, Backlog, Manual, and Tasks views.                                |
| Preferences   | Keep Play Now and backlog preference controls as a secondary section within Play Now.                    |
| Detail        | Replace the current game-detail presentation with an accessible drawer.                                  |
| Compatibility | Reuse existing HTTP APIs, components, filters, selects, and semantic behavior.                           |

## Goals

1. Make the dashboard easier to scan by giving each major workflow a dedicated view.
2. Preserve current dashboard behavior while changing how it is composed and navigated.
3. Keep navigation instant and stateful without a routing dependency.
4. Maintain the accessibility guarantees of game detail while moving it into a drawer.
5. Support narrow screens and users who request reduced motion.

## Non-goals

- No backend, MCP server, database, schema, migration, endpoint, or tool changes.
- No changes to recommendation, session, backlog, tracker, Family, manual-collection, task, or achievement semantics.
- No new dashboard dependency, including a router or animation library.
- No URL routing, deep-linking, browser-history behavior, or persisted selected view in this slice.
- No new backlog duration model or inference. The UI may show only duration information already supplied by the existing contract.
- No new image service or cover-art contract. Library cards use the existing cover source and its established fallback when a cover is unavailable.
- Home is not a second copy of full editors, full tables, or all library content.

## Information architecture

### Persistent application shell

`AppShell` owns the page chrome:

- A sidebar contains the six primary destinations: Home, Library, Play Now, Backlog, Manual, and Tasks.
- A top bar provides the current-view title and existing global dashboard context that is already available without adding a new contract.
- The main region renders exactly one active view at a time.
- Navigation updates `activeView` in memory. It does not change the URL and does not reload the page.

The shell is present across views. On small screens, its navigation must remain reachable through a compact control or layout treatment while preserving the same six destinations and their labels.

### View responsibilities

| View     | Purpose                                    | Included behavior                                                                                                             | Excluded behavior                                              |
| -------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Home     | Fast orientation                           | Summary cards, concise status, and links/actions that switch to the relevant view                                             | Full list/editor duplication                                   |
| Library  | Browse and inspect games                   | Existing search/filter/sort/select controls, game grid/cards, selection, and game-detail drawer                               | New filtering semantics or cover sources                       |
| Play Now | Decide what to play                        | Existing Play Now recommendation output, solo/friends mode controls, session-aware context, and secondary Preferences section | A separate primary Preferences destination                     |
| Backlog  | Plan finite play time                      | Existing backlog plan controls and result presentation                                                                        | Invented duration or scheduling details                        |
| Manual   | Maintain manually entered collection games | Existing manual collection create/update/remove flows and Family/access presentation                                          | Ownership or entitlement claims not supported by existing APIs |
| Tasks    | Manage local tasks                         | Existing task list and task mutation flows                                                                                    | A separate backend task model                                  |

Home action links are view changes, not duplicated workflows. For example, a Home backlog summary can lead to Backlog, but Home does not host the full backlog planner.

## Component boundaries

### `app.tsx` remains the state coordinator

`app.tsx` retains the existing cross-view concerns:

- API client calls and request orchestration;
- loaded library, tracker, recommendation, backlog, manual-collection, task, and achievement data;
- caches and request/loading/error state, including per-game achievement state;
- current filter, selection, mutation, and dialog/drawer state;
- shared handlers passed to views and existing reusable controls.

It adds the minimal view-selection state and maps the active view to a view component. It must not split caches or refetch solely because a user changes views.

### Presentation components

`AppShell` receives the active destination and a callback to change it. Each view receives only the state and actions it needs. Existing controls should be reused rather than reimplemented. A view can arrange those controls differently, but must preserve their existing request payloads, validation, and outcomes.

The Library view presents games as cards in a responsive grid. A card uses existing game metadata and cover selection. When the existing cover value is absent or fails under the project’s established fallback behavior, the card shows the established fallback rather than inventing a URL or fetching a new asset.

## State, loading, and errors

Changing `activeView` must not clear or recreate shared state. The following survive a view change for the lifetime of the mounted dashboard:

- Library search, filters, sort, and current selection.
- Recommendation and backlog input selections and their latest successful results.
- Manual collection and task form state when those existing forms are mounted through the new composition.
- Loaded data and in-flight-safe caches, including achievement progress keyed by game.
- Existing user-visible loading and error states.

A view that has not yet loaded its relevant data uses the same API call and error behavior that exists today. The redesign must not silently hide errors, change retry semantics, or issue extra calls merely to render a new layout.

## Accessible game-detail drawer

The selected Library game opens in a drawer rather than an inline/detail layout. The drawer preserves the existing detail capabilities, including achievement loading and game actions that are already exposed by the UI.

When opened, the drawer:

1. Has a programmatic dialog/drawer name and appropriate dialog semantics.
2. Moves focus into the drawer to a meaningful initial target.
3. Keeps keyboard focus within the drawer while it is open.
4. Closes on Escape and through a visible close control.
5. Restores focus to the element that opened it after close.
6. Does not remove or reinterpret current game, tracker, Family, manual-access, or achievement semantics.

The drawer must remain usable at narrow widths, with content that can scroll without trapping the page in an unusable state.

## Responsive and motion behavior

- Use responsive layouts for sidebar/top bar, summary cards, the Library grid, forms, planner output, and the drawer.
- Preserve readable tap targets and keyboard access on narrow screens.
- Visual transitions, if used, are cosmetic only and must not delay state updates or keyboard interaction.
- Under `prefers-reduced-motion: reduce`, suppress or materially reduce non-essential movement.

## Contract limitations and UI truthfulness

The redesign is a consumer of the current contracts. It must not manufacture precision that the contracts do not provide.

- Backlog UI must not invent per-game duration, completion, ordering, or scheduling details beyond values already returned by the backlog API.
- Manual and Family entries must continue to use the existing access/playability fields and wording. In particular, UI presentation must not imply Steam ownership when the record is manual or Family-based.
- Achievement UI uses the current on-demand availability/progress contract and retains game-scoped loading and errors.
- Cover rendering uses the existing library cover value plus the established fallback. It does not assume all games have valid cover art.

## Testing strategy

The implementation adds or updates tests at the existing dashboard test level to prove both behavior and composition:

| Area                 | Required coverage                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation           | All six destinations render; selecting one changes visible content without resetting preserved shared state.                                                  |
| Home                 | Summaries link to the appropriate view and do not duplicate full editors/lists.                                                                               |
| Library              | Existing filters/selects work in the card/grid view; missing covers use the existing fallback; selecting a card opens the drawer.                             |
| Drawer accessibility | Accessible name, focus entry, focus containment, Escape close, visible close action, and focus restoration.                                                   |
| Play Now             | Solo/friends behavior, session-aware output, and secondary Preferences controls retain existing request semantics.                                            |
| Backlog              | Existing planner inputs/results retain their contract-driven display without invented duration details.                                                       |
| Manual and Tasks     | Existing mutation flows remain reachable and behave as before.                                                                                                |
| Achievements         | On-demand progress remains game-scoped; loading/error for one game does not affect another.                                                                   |
| Responsive/motion    | Responsive shell/grid/drawer behavior and reduced-motion styling are covered by focused component/style assertions where supported by the current test setup. |

Existing backend and MCP tests remain authoritative for contracts; this UI change should add no backend-specific test requirements.

## Acceptance checklist

- [ ] The dashboard has one persistent AppShell with six state-driven destinations.
- [ ] `app.tsx` retains the shared APIs, state, caches, and handlers; view changes do not reset them.
- [ ] Home is summary-only and routes users into focused views.
- [ ] Library uses a responsive game-card grid and an accessible detail drawer.
- [ ] Play Now contains the existing preference controls as a secondary section.
- [ ] Existing HTTP/MCP contracts and all domain semantics are unchanged.
- [ ] Existing cover fallback and contract-limited backlog display are preserved.
- [ ] Narrow-screen and reduced-motion behavior are implemented and tested.

## Next step

Write the implementation plan from this design, sequencing shell extraction, view composition, drawer migration, responsive styling, and focused regression tests without changing backend or MCP contracts.
