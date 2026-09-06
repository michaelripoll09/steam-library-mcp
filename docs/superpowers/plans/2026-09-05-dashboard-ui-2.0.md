# Dashboard UI 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose the Steam Library dashboard as an accessible, responsive workspace with six focused views while retaining every current HTTP, MCP, and domain behavior.

**Architecture:** `DashboardApp` remains the single request/state coordinator: it owns `activeView`, loaded data, filters, forms, mutations, task state, and achievement caches. A persistent `AppShell` swaps focused presentation views without unmounting coordinator state. Existing intelligence and task component state moves into app-level hooks invoked once, so changing view never refetches and Home summaries cannot duplicate task polling.

**Tech Stack:** React 19, TypeScript 5.9, Vite 8, existing CSS, Vitest 4, Testing Library, existing `DashboardApi`.

**Spec:** `docs/superpowers/specs/2026-09-05-dashboard-ui-2.0-design.md`

## Global Constraints

- Work only in the primary checkout on `feat/dashboard-ui-2.0`; no worktree.
- Do not change backend, HTTP endpoints/contracts, MCP, SQLite/migrations, Steam client, recommendation/tracker/backlog/task/achievement algorithms, or `src/dashboard/contracts.ts`.
- Add no dependencies: no router, UI framework, Tailwind, Redux, or animation library.
- Use in-memory-only `DashboardView = "home" | "library" | "play-now" | "backlog" | "manual" | "tasks"`; do not change URL/history or reload.
- `DashboardApp` keeps API clients, library/manual/task/intelligence data, filters, selection, forms, mutations, loading/errors, and per-app achievement cache. Navigation must not recreate/refetch any of them.
- Preserve current cover chain: `coverUrl`, official Steam icon, then deterministic gradient fallback. Do not add cover sources.
- Backlog/recommendation UI shows only contract data; do not invent duration, ordering, scheduling, completion, or remaining-time fields.
- Retain manual/Family `accessType`, `isPlayable`, and local-only wording; do not imply ownership or Steam Families sync.
- Keep semantic controls, visible focus, live/error states, Escape, focus trap, and focus restoration. Do not use clickable `div`s.
- Desktop `>=1200px`, tablet `768px–1199px`, mobile `<768px`; mobile interactive controls are at least 44px. Honor reduced motion.
- Use existing neutral Spanish copy conventions. Do not touch `images/`.

---

## File Structure

- Modify: `dashboard-ui/src/app.tsx` — state/API coordinator; `activeView`; view mapping.
- Create: `dashboard-ui/src/navigation/app-shell.tsx` — persistent sidebar, top bar, responsive navigation.
- Create: `dashboard-ui/src/views/home-view.tsx` — summary-only orientation and navigation actions.
- Create: `dashboard-ui/src/views/library-view.tsx` — header, sync, filters, card grid.
- Create: `dashboard-ui/src/views/play-now-view.tsx` — recommendation hero/list and secondary preferences.
- Create: `dashboard-ui/src/views/backlog-view.tsx` — planner controls/plans/progress.
- Create: `dashboard-ui/src/views/manual-collection-view.tsx` — manual utility form/rows.
- Create: `dashboard-ui/src/views/tasks-view.tsx` — activity list/cancel controls.
- Create: `dashboard-ui/src/components/game-card.tsx` — accessible card variants and existing cover use.
- Create: `dashboard-ui/src/components/progress-bar.tsx` — accessible presentation for supplied progress.
- Create: `dashboard-ui/src/components/inline-notice.tsx` — `info | success | warning | error` presentation.
- Create: `dashboard-ui/src/game-details/game-details-drawer.tsx` — responsive accessible details drawer.
- Create: `dashboard-ui/src/intelligence-state.ts` — existing intelligence state machine used once by `DashboardApp`.
- Create: `dashboard-ui/src/task-state.ts` — existing race-safe list/poll/cancel state used once by `DashboardApp`.
- Modify: `dashboard-ui/src/library-panel.tsx`, `game-details.tsx`, `intelligence-panel.tsx`, `manual-collection-panel.tsx`, `task-panel.tsx` — retain only reused exports/compatibility shims or remove after all callers migrate; never retain duplicate implementations.
- Modify: `dashboard-ui/src/styles.css` — graphite tokens, focused views, responsive and reduced-motion styles.
- Modify: `tests/dashboard-ui/app.test.tsx`, `tests/dashboard-ui/task-controls.test.tsx` — composition/accessibility/state regression tests.

### Task 1: Persistent shell and state-preserving navigation

**Files:**
- Create: `dashboard-ui/src/navigation/app-shell.tsx`
- Create: `dashboard-ui/src/views/home-view.tsx`
- Modify: `dashboard-ui/src/app.tsx`, `dashboard-ui/src/styles.css`
- Test: `tests/dashboard-ui/app.test.tsx`

**Interfaces:**
- Produces: `export type DashboardView = "home" | "library" | "play-now" | "backlog" | "manual" | "tasks"`.
- Produces: `AppShell({ activeView, onViewChange, children }: Readonly<{ activeView: DashboardView; onViewChange: (view: DashboardView) => void; children: React.ReactNode }>)`.
- Produces: `HomeView({ library, taskSummary, onNavigate }: Readonly<{ library: DashboardLibrary | undefined; taskSummary: HomeTaskSummary; onNavigate: (view: DashboardView) => void }>)`.
- Consumes: existing `DashboardLibrary` and app-owned library state. `HomeTaskSummary` is a read-only count/status projection, never an API source.

- [ ] **Step 1: Write the failing navigation tests.**

```tsx
test("changes all six destinations without changing the URL or refetching the library", async () => {
  const user = userEvent.setup();
  const api = { getLibrary: vi.fn().mockResolvedValue(library) };
  render(<DashboardApp api={api as never} />);
  await screen.findByRole("heading", { name: "Inicio" });
  for (const name of ["Biblioteca", "Play Now", "Backlog", "Colección manual", "Tareas"]) {
    await user.click(screen.getByRole("button", { name }));
  }
  expect(api.getLibrary).toHaveBeenCalledTimes(1);
  expect(window.location.pathname).toBe("/");
});

test("preserves a library search after navigating away and back", async () => {
  const user = userEvent.setup();
  render(<DashboardApp api={{ getLibrary: vi.fn().mockResolvedValue(library) } as never} />);
  await user.click(screen.getByRole("button", { name: "Biblioteca" }));
  await user.type(await screen.findByRole("searchbox", { name: "Buscar juegos" }), "hades");
  await user.click(screen.getByRole("button", { name: "Inicio" }));
  await user.click(screen.getByRole("button", { name: "Biblioteca" }));
  expect(screen.getByRole("searchbox", { name: "Buscar juegos" })).toHaveValue("hades");
});
```

- [ ] **Step 2: Run the focused test and confirm RED.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx`

Expected: FAIL because the stacked page has no state-driven destinations.

- [ ] **Step 3: Add `activeView` and implement the shell.**

```tsx
const [activeView, setActiveView] = useState<DashboardView>("home");
return (
  <AppShell activeView={activeView} onViewChange={setActiveView}>
    <main data-view={activeView}>{renderActiveView(activeView)}</main>
  </AppShell>
);
```

Use six native buttons with `aria-current="page"` on the active view, a labelled top bar, and a main landmark. `HomeView` renders only total games, `statusStats.playing`, `statusStats.backlog`, total playtime, compact task status, and buttons that call `onNavigate`; it must not render full lists, filters, planners, or editors. Keep fetching in `DashboardApp`; no effect may depend on `activeView`.

- [ ] **Step 4: Add responsive shell styles.**

```css
.dashboard-workspace { min-height: 100dvh; display: grid; grid-template-columns: 15rem minmax(0, 1fr); }
.dashboard-sidebar { position: sticky; top: 0; height: 100dvh; }
@media (max-width: 1199px) { .dashboard-workspace { grid-template-columns: 4.5rem minmax(0, 1fr); } }
@media (max-width: 767px) { .dashboard-workspace { grid-template-columns: 1fr; } .dashboard-sidebar { position: static; height: auto; } }
```

Use graphite surfaces and cold-blue active/focus treatment; compact controls retain accessible destination labels.

- [ ] **Step 5: Run focused tests and confirm GREEN.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx`

Expected: PASS for six destinations, stable URL, and preserved filters.

- [ ] **Step 6: Commit.**

```bash
git add dashboard-ui/src/app.tsx dashboard-ui/src/navigation/app-shell.tsx dashboard-ui/src/views/home-view.tsx dashboard-ui/src/styles.css tests/dashboard-ui/app.test.tsx
git commit -m "feat: add dashboard workspace shell"
```

### Task 2: Library workspace and game-card grid

**Files:**
- Create: `dashboard-ui/src/views/library-view.tsx`, `dashboard-ui/src/components/game-card.tsx`
- Modify: `dashboard-ui/src/app.tsx`, `dashboard-ui/src/library-panel.tsx`, `dashboard-ui/src/styles.css`
- Test: `tests/dashboard-ui/app.test.tsx`

**Interfaces:**
- Produces: `LibraryView({ library, games, filters, isLoading, error, isSyncing, syncError, onFiltersChange, onRetryLoad, onSync, onOpen }: LibraryViewProps)`.
- Produces: `GameCard({ game, onOpen }: Readonly<{ game: DashboardGame; onOpen: (game: DashboardGame, opener: HTMLButtonElement) => void }>)`.
- Consumes: current `LibraryFilters`, `clearLibraryFilters`, `formatPlaytime`, `CoverImage`, `DashboardGame`; views never call APIs.

- [ ] **Step 1: Write the failing Library tests.**

```tsx
test("keeps filters in the Library card grid and opens the selected card", async () => {
  const user = userEvent.setup();
  render(<DashboardApp api={{ getLibrary: vi.fn().mockResolvedValue(library) } as never} />);
  await user.click(screen.getByRole("button", { name: "Biblioteca" }));
  await user.type(await screen.findByRole("searchbox", { name: "Buscar juegos" }), "celeste");
  expect(screen.getByRole("article", { name: "Celeste" })).toBeInTheDocument();
  expect(screen.queryByRole("article", { name: "Hades" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Ver detalles de Celeste" }));
  expect(screen.getByRole("dialog", { name: "Detalles de Celeste" })).toBeInTheDocument();
});

test("uses the established fallback for a missing card cover", () => {
  render(<GameCard game={{ ...library.games[0], coverUrl: "" }} onOpen={vi.fn()} />);
  fireEvent.error(screen.getByRole("img", { name: "Portada de Celeste" }));
  expect(screen.getByRole("img", { name: "Portada no disponible para Celeste" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and confirm RED.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx`

Expected: FAIL because `LibraryView` and `GameCard` do not exist.

- [ ] **Step 3: Move Library composition, preserving filter/cover behavior.**

```tsx
<section aria-labelledby="library-heading" className="library-view">
  <PageHeader title="Biblioteca" meta={`${games.length} mostrados`} action={<SyncButton />} />
  <LibraryToolbar filters={filters} onChange={onFiltersChange} />
  <div className="game-grid">{games.map((game) => <GameCard key={game.appId} game={game} onOpen={onOpen} />)}</div>
</section>
```

Retain current retry/error/empty copy and filter payloads. Cards use only cover, title, textual status, meaningful non-owned access, and formatted existing playtime. State classes derive only from `DashboardGame.status`; never infer a status.

- [ ] **Step 4: Add responsive grid/focus CSS.**

```css
.game-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: 1rem; }
.game-card-button:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 3px; }
```

- [ ] **Step 5: Run and confirm GREEN.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx`

Expected: PASS for filters, selection, labels, and fallback.

- [ ] **Step 6: Commit.**

```bash
git add dashboard-ui/src/app.tsx dashboard-ui/src/views/library-view.tsx dashboard-ui/src/components/game-card.tsx dashboard-ui/src/library-panel.tsx dashboard-ui/src/styles.css tests/dashboard-ui/app.test.tsx
git commit -m "feat: redesign library workspace"
```

### Task 3: Accessible responsive game-details drawer

**Files:**
- Create: `dashboard-ui/src/game-details/game-details-drawer.tsx`
- Modify: `dashboard-ui/src/app.tsx`, `dashboard-ui/src/game-details.tsx`, `dashboard-ui/src/styles.css`
- Test: `tests/dashboard-ui/app.test.tsx`

**Interfaces:**
- Produces: `GameDetailsDrawer(props: GameDetailsDrawerProps)` with the exact current `GameDetails` status/achievement callback types.
- Consumes: `DashboardGame`, `DashboardMutableStatus`, `DashboardAchievementResult`, `CoverImage`, `formatLabel`, `formatPlaytime`.
- Invariant: `DashboardApp` keeps `ReadonlyMap<number, DashboardAchievementResult>`, `ReadonlySet<number>`, and `ReadonlyMap<number, string>` keyed by `game.appId`; drawer state is not global.

- [ ] **Step 1: Write failing drawer accessibility tests.**

```tsx
test("traps focus in the drawer and restores the card opener on Escape", async () => {
  const user = userEvent.setup();
  render(<DashboardApp api={{ getLibrary: vi.fn().mockResolvedValue(library) } as never} />);
  await user.click(screen.getByRole("button", { name: "Biblioteca" }));
  const opener = await screen.findByRole("button", { name: "Ver detalles de Celeste" });
  await user.click(opener);
  const drawer = screen.getByRole("dialog", { name: "Detalles de Celeste" });
  expect(screen.getByRole("button", { name: "Cerrar detalles" })).toHaveFocus();
  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(drawer).toContainElement(document.activeElement);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

test("keeps achievement loading and errors scoped to the selected app", async () => {
  const requests = new Map<number, ReturnType<typeof deferred<DashboardAchievementResult>>>();
  const api = { ...libraryApiFixture(), getAchievements: vi.fn((appId: number) => { const request = deferred<DashboardAchievementResult>(); requests.set(appId, request); return request.promise; }) };
  render(<DashboardApp api={api as never} />);
  // Open Celeste and load, close it, open Hades and load, reject requests.get(10), then assert Hades still shows "Cargando logros…" and no Celeste error.
});
```

- [ ] **Step 2: Run and confirm RED.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx`

Expected: FAIL because the drawer component/layout does not exist.

- [ ] **Step 3: Move existing detail semantics into `GameDetailsDrawer`.**

```tsx
<div className="drawer-backdrop" onMouseDown={onClose}>
  <aside ref={dialogRef} className="game-details-drawer" role="dialog" aria-modal="true" aria-label={`Detalles de ${game.name}`} onMouseDown={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}>
    <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Cerrar detalles">×</button>
    {/* existing artwork, status/access/playability, status control, notice, achievements */}
  </aside>
</div>
```

Port the current Tab-loop exactly. Keep app-level opener/close refs, Escape/backdrop close, focus into close control, and focus restoration. Render artwork, title, textual status/access, playtime, last played, playability, status control, manual warning, and achievements in that order. Achievement loading stays on explicit user intent; available achievements show supplied percent/count and no more than ten current sorted rows.

- [ ] **Step 4: Add responsive drawer styles.**

```css
.game-details-drawer { width: min(42rem, 46vw); max-height: 100dvh; overflow-y: auto; }
@media (max-width: 1199px) { .game-details-drawer { width: min(75vw, 42rem); } }
@media (max-width: 767px) { .game-details-drawer { width: 100vw; height: 100dvh; } }
@media (prefers-reduced-motion: reduce) { .game-details-drawer, .drawer-backdrop { transition: none; } }
```

- [ ] **Step 5: Run and confirm GREEN.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx`

Expected: PASS for dialog name, focus entry/trap/restoration, Escape, status mutation, and app-scoped achievements.

- [ ] **Step 6: Commit.**

```bash
git add dashboard-ui/src/app.tsx dashboard-ui/src/game-details/game-details-drawer.tsx dashboard-ui/src/game-details.tsx dashboard-ui/src/styles.css tests/dashboard-ui/app.test.tsx
git commit -m "feat: replace game modal with details drawer"
```

### Task 4: Shared intelligence state and dedicated Play Now/Backlog views

**Files:**
- Create: `dashboard-ui/src/intelligence-state.ts`, `dashboard-ui/src/views/play-now-view.tsx`, `dashboard-ui/src/views/backlog-view.tsx`, `dashboard-ui/src/components/progress-bar.tsx`
- Modify: `dashboard-ui/src/app.tsx`, `dashboard-ui/src/intelligence-panel.tsx`, `dashboard-ui/src/styles.css`
- Test: `tests/dashboard-ui/app.test.tsx`

**Interfaces:**
- Produces: `useIntelligenceState({ api, games }: Readonly<{ api: IntelligenceApi; games: readonly DashboardGame[] }>): IntelligenceState`.
- Produces: `IntelligenceState` with controlled `availableMinutes`, `sessionMode`, `recommendations`, `selectedAppId`, `preference`, `planAvailableMinutes`, `cadence`, `targetGameCount`, `plans`, `message`, `error`, and current refresh/save/create/update actions.
- Produces: `PlayNowView({ games, state, onOpenGame }: Readonly<{ games: readonly DashboardGame[]; state: IntelligenceState; onOpenGame: (game: DashboardGame, opener: HTMLButtonElement) => void }>)` and `BacklogView({ state }: Readonly<{ state: IntelligenceState }>)`.
- Invariant: invoke `useIntelligenceState` once in `DashboardApp`, never in a conditionally mounted view; it must keep the current preference request version guard and request/payload semantics.

- [ ] **Step 1: Write failing Play Now and Backlog tests.**

```tsx
test("preserves a friends Play Now result after visiting Backlog", async () => {
  const user = userEvent.setup();
  const api = intelligenceApiFixture();
  render(<DashboardApp api={api as never} />);
  await user.click(screen.getByRole("button", { name: "Play Now" }));
  await chooseCustomOption(user, "Modo de sesión", "Con amigos");
  await user.click(screen.getByRole("button", { name: "Encontrar qué jugar" }));
  await waitFor(() => expect(api.getRecommendations).toHaveBeenCalledWith(45, "with_friends"));
  await user.click(screen.getByRole("button", { name: "Backlog" }));
  await user.click(screen.getByRole("button", { name: "Play Now" }));
  expect(screen.getByText("Recomendación de prueba")).toBeInTheDocument();
});

test("uses the existing backlog payload and does not invent remaining duration", async () => {
  const user = userEvent.setup();
  const api = intelligenceApiFixture();
  render(<DashboardApp api={api as never} />);
  await user.click(screen.getByRole("button", { name: "Backlog" }));
  await user.click(screen.getByRole("button", { name: "Crear plan" }));
  expect(api.createPlan).toHaveBeenCalledWith({ cadence: "weekly", availableMinutes: 45, targetGameCount: 3 });
  expect(screen.queryByText(/min restantes estimados/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and confirm RED.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx`

Expected: FAIL because intelligence remains a single panel with component-local state.

- [ ] **Step 3: Extract the existing intelligence state machine without semantic changes.**

```ts
export type IntelligenceState = Readonly<{
  availableMinutes: string;
  sessionMode: DashboardSessionMode;
  recommendations: DashboardRecommendations | undefined;
  plans: readonly DashboardPlan[];
  refreshRecommendations: () => Promise<void>;
  createPlan: () => Promise<void>;
  updateProgress: (planId: string, itemId: string, progress: DashboardPlanItemProgress) => Promise<void>;
  selectedAppId: number | undefined;
  preference: Omit<DashboardRecommendationPreference, "appId">;
  planAvailableMinutes: string;
  cadence: "weekly" | "monthly";
  targetGameCount: string;
  message: string | undefined;
  error: string | undefined;
  selectGame: (appId: number) => void;
  savePreference: () => Promise<void>;
}>;
```

Move positive-integer validation, `preferenceRequestRef`, preference loading, save-and-refresh, plans reload, and progress reload verbatim from `IntelligencePanel`. Preserve `availableMinutes`, `sessionMode`, cadence, count, `playMode`, and every `DashboardApi` call.

- [ ] **Step 4: Implement focused presentation views.**

```tsx
<section aria-labelledby="play-now-heading">
  <PageHeader title="Play Now" />
  <PlayNowControls availableMinutes={state.availableMinutes} sessionMode={state.sessionMode} onFind={state.refreshRecommendations} />
  <PlayNowHero recommendation={state.recommendations?.recommendations[0]} />
  <RecommendationList recommendations={state.recommendations?.recommendations.slice(1, 4) ?? []} />
  <PreferencesSection {...preferenceProps} />
</section>
```

Preferences stays secondary within Play Now. Hero/cards use only existing title, nullable duration, explanation, reasons, and a matching existing library cover/fallback. Backlog shows only supplied plan cadence, budget, target count, items, shortfall message, and existing progress; it never labels a non-contract duration as remaining time.

- [ ] **Step 5: Add preservation/preference/progress tests.**

```tsx
test("keeps Preferences inside Play Now and preserves selected game across navigation", async () => {
  // select a game, visit Backlog, return; assert its preference control and no duplicate getPreference request.
});
test("updates plan progress with the current API", async () => {
  // select Hecho and assert updatePlanItemProgress(planId, itemId, "done").
});
```

- [ ] **Step 6: Run and confirm GREEN.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx`

Expected: PASS for session request semantics, secondary preferences, planner payloads, preserved results/forms, and constrained display.

- [ ] **Step 7: Commit.**

```bash
git add dashboard-ui/src/app.tsx dashboard-ui/src/intelligence-state.ts dashboard-ui/src/views/play-now-view.tsx dashboard-ui/src/views/backlog-view.tsx dashboard-ui/src/components/progress-bar.tsx dashboard-ui/src/intelligence-panel.tsx dashboard-ui/src/styles.css tests/dashboard-ui/app.test.tsx
git commit -m "feat: create dedicated play now and backlog views"
```

### Task 5: Home summaries sourced from shared state

**Files:**
- Modify: `dashboard-ui/src/views/home-view.tsx`, `dashboard-ui/src/app.tsx`, `dashboard-ui/src/styles.css`
- Test: `tests/dashboard-ui/app.test.tsx`

**Interfaces:**
- Consumes: app-owned `DashboardLibrary | undefined`, `IntelligenceState`, and `HomeTaskSummary`.
- Produces: summary actions with `onNavigate("library" | "play-now" | "backlog" | "tasks")`.
- Invariant: Home never calls `DashboardApi`, mounts a planner/manual form, or renders full task/recommendation/library collections.

- [ ] **Step 1: Write the failing Home test.**

```tsx
test("renders compact Home summaries and routes actions to focused views", async () => {
  const user = userEvent.setup();
  render(<DashboardApp api={dashboardApiFixtureWithLibraryAndInsights() as never} />);
  expect(await screen.findByText("Juegos totales")).toBeInTheDocument();
  expect(screen.queryByRole("searchbox", { name: "Buscar juegos" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("URL de Steam o AppID")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Calcular Play Now" }));
  expect(screen.getByRole("heading", { name: "Play Now" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and confirm RED.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx`

Expected: FAIL until Home receives shared summaries and focused actions.

- [ ] **Step 3: Render concise, truthful summaries.**

```tsx
<StatCard label="Juegos totales" value={String(library?.totals.totalGames ?? 0)} />
<StatCard label="Jugando" value={String(library?.statusStats.playing ?? 0)} />
<StatCard label="Backlog" value={String(library?.statusStats.backlog ?? 0)} />
<button type="button" onClick={() => onNavigate("play-now")}>Calcular Play Now</button>
```

Show insight/plan/task values only once already loaded; otherwise use explicit compact loading/empty state rather than fabricated precision. Home actions only change `activeView`.

- [ ] **Step 4: Run and confirm GREEN.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx`

Expected: PASS; Home is summary-only and actions navigate.

- [ ] **Step 5: Commit.**

```bash
git add dashboard-ui/src/app.tsx dashboard-ui/src/views/home-view.tsx dashboard-ui/src/styles.css tests/dashboard-ui/app.test.tsx
git commit -m "feat: add dashboard home view"
```

### Task 6: Manual collection utility workspace

**Files:**
- Create: `dashboard-ui/src/views/manual-collection-view.tsx`
- Modify: `dashboard-ui/src/app.tsx`, `dashboard-ui/src/manual-collection-panel.tsx`, `dashboard-ui/src/styles.css`
- Test: `tests/dashboard-ui/app.test.tsx`

**Interfaces:**
- Produces: `ManualCollectionView({ collection, steam, error, saving, onSteamChange, onAdd, onUpdate, onRemove }: ManualCollectionViewProps)` with current controlled prop types.
- Consumes: `ManualLibraryGame` and `DashboardApp` handlers.
- Invariant: add/update/remove and post-mutation library refresh stay in `DashboardApp`; the view makes no API calls.

- [ ] **Step 1: Write the failing Manual view test.**

```tsx
test("keeps manual Family access and playability editing reachable in its own view", async () => {
  const user = userEvent.setup();
  const api = manualApiFixture();
  render(<DashboardApp api={api as never} />);
  await user.click(screen.getByRole("button", { name: "Colección manual" }));
  await user.selectOptions(await screen.findByLabelText("Acceso de Stardew Valley"), "family");
  expect(api.updateManualCollection).toHaveBeenCalledWith(413150, { accessType: "family" });
  await user.click(screen.getByLabelText("Disponible para jugar: Stardew Valley"));
  expect(api.updateManualCollection).toHaveBeenLastCalledWith(413150, { isPlayable: true });
  expect(screen.getByText(/metadata local declarada por el usuario/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and confirm RED.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx`

Expected: FAIL because the Manual destination does not exist.

- [ ] **Step 3: Implement the focused utility view.**

```tsx
<section aria-labelledby="manual-collection-heading" className="manual-collection-view">
  <PageHeader title="Colección manual" />
  <form onSubmit={(event) => { event.preventDefault(); onAdd(); }}>{/* existing URL/AppID control */}</form>
  <p className="inline-notice">El acceso Familia es metadata local declarada por el usuario. Steam Library MCP no sincroniza Steam Families.</p>
  <ul>{collection.map((game) => <ManualGameRow key={game.appId} game={game} onUpdate={onUpdate} onRemove={onRemove} />)}</ul>
</section>
```

Retain existing IDs, error association, add/remove actions, access select, `isPlayable` checkbox, and textual availability. Never claim entitlement or change collection semantics.

- [ ] **Step 4: Run and confirm GREEN.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx`

Expected: PASS; existing add/update/remove and Family/playability truthfulness remain.

- [ ] **Step 5: Commit.**

```bash
git add dashboard-ui/src/app.tsx dashboard-ui/src/views/manual-collection-view.tsx dashboard-ui/src/manual-collection-panel.tsx dashboard-ui/src/styles.css tests/dashboard-ui/app.test.tsx
git commit -m "feat: redesign manual collection workspace"
```

### Task 7: Shared task state and activity workspace

**Files:**
- Create: `dashboard-ui/src/task-state.ts`, `dashboard-ui/src/views/tasks-view.tsx`
- Modify: `dashboard-ui/src/app.tsx`, `dashboard-ui/src/task-panel.tsx`, `dashboard-ui/src/views/home-view.tsx`, `dashboard-ui/src/styles.css`
- Test: `tests/dashboard-ui/task-controls.test.tsx`, `tests/dashboard-ui/app.test.tsx`

**Interfaces:**
- Produces: `useTaskState(api: TaskApi): TaskState`, where `TaskApi = DashboardApi & Required<Pick<DashboardApi, "getTasks" | "getTask" | "cancelTask">>`.
- Produces: `TaskState = Readonly<{ tasks: readonly LocalTask[]; error: string | undefined; cancellingTaskId: string | undefined; refresh: () => Promise<void>; cancel: (id: string) => Promise<void>; summary: HomeTaskSummary }>`.
- Produces: `TasksView({ state }: Readonly<{ state: TaskState }>)`.
- Invariant: one `useTaskState` call in `DashboardApp`; Home receives `state.summary`, never `TaskApi`, therefore cannot duplicate polling.

- [ ] **Step 1: Write failing single-poller and race tests.**

```tsx
test("does not create a second task poller while switching Home and Tasks", async () => {
  vi.useFakeTimers();
  const api = taskApiFixtureWithRunningTask();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<DashboardApp api={api as never} />);
  await screen.findByText("Sincronizando biblioteca");
  await user.click(screen.getByRole("button", { name: "Tareas" }));
  await user.click(screen.getByRole("button", { name: "Inicio" }));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(api.getTask).toHaveBeenCalledTimes(1);
});

test("keeps cancellation when a stale shared poll resolves", async () => {
  const pendingPoll = deferred<LocalTask>();
  const api = { ...taskApiFixtureWithRunningTask(), getTask: vi.fn(() => pendingPoll.promise), cancelTask: vi.fn(async () => ({ ...runningTask, state: "cancelled" as const })) };
  render(<DashboardApp api={api as never} />);
  // Advance 2,000ms, cancel runningTask.id, resolve pendingPoll with runningTask, and assert "Cancelada" remains while "En ejecución" is absent.
});
```

- [ ] **Step 2: Run and confirm RED.**

Run: `npm test -- --run tests/dashboard-ui/task-controls.test.tsx tests/dashboard-ui/app.test.tsx`

Expected: FAIL because `TaskPanel` local state unmounts/restarts across navigation.

- [ ] **Step 3: Extract the current race-safe logic to `useTaskState`.**

```ts
const activeTaskCount = state.tasks.filter((task) => task.state === "queued" || task.state === "running").length;
const summary: HomeTaskSummary = { totalCount: state.tasks.length, activeCount: activeTaskCount, hasError: state.error !== undefined };
```

Move `tasksRef`, per-task versions, list generation, cancellation set, 2-second poll, reconciliation, and errors unchanged. The app calls this hook once after the existing type guard and passes one stable state object to both views. `TasksView` renders existing type/state/progress/error/cancel data as activity rows and calls `refresh`/`cancel`.

- [ ] **Step 4: Run and confirm GREEN.**

Run: `npm test -- --run tests/dashboard-ui/task-controls.test.tsx tests/dashboard-ui/app.test.tsx`

Expected: PASS for one poller, cancellation race, refresh, and Home summary.

- [ ] **Step 5: Commit.**

```bash
git add dashboard-ui/src/app.tsx dashboard-ui/src/task-state.ts dashboard-ui/src/views/tasks-view.tsx dashboard-ui/src/task-panel.tsx dashboard-ui/src/views/home-view.tsx dashboard-ui/src/styles.css tests/dashboard-ui/task-controls.test.tsx tests/dashboard-ui/app.test.tsx
git commit -m "feat: redesign tasks workspace"
```

### Task 8: Responsive polish and complete quality gates

**Files:**
- Modify: `dashboard-ui/src/styles.css`, `dashboard-ui/src/components/inline-notice.tsx`, `dashboard-ui/src/components/progress-bar.tsx`
- Modify: `tests/dashboard-ui/app.test.tsx`, `tests/dashboard-ui/task-controls.test.tsx`

**Interfaces:**
- Produces: CSS tokens for graphite surfaces, cold-blue focus/selection, restricted muted-gold hero/achievement highlights, textual status treatments, responsive layouts, and reduced-motion overrides.
- Consumes: existing view loading/error values; skeletons are presentation-only and never trigger requests or hide retry/error controls.

- [ ] **Step 1: Write failing responsive/motion and error-visible tests.**

```tsx
test("ships responsive shell, grid, mobile drawer, and reduced-motion CSS", async () => {
  const styles = await readFile(resolve(process.cwd(), "dashboard-ui/src/styles.css"), "utf8");
  expect(styles).toMatch(/@media \(max-width: 1199px\)/);
  expect(styles).toMatch(/@media \(max-width: 767px\)/);
  expect(styles).toMatch(/\.game-details-drawer[\s\S]*width:\s*100vw/);
  expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition:\s*none/);
});

test("keeps Library error and retry visible instead of hiding it behind a skeleton", async () => {
  const user = userEvent.setup();
  render(<DashboardApp api={{ getLibrary: vi.fn().mockRejectedValue(new Error("offline")) } as never} />);
  await user.click(screen.getByRole("button", { name: "Biblioteca" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  expect(screen.getByRole("button", { name: "Reintentar carga de la biblioteca" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and confirm RED.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx tests/dashboard-ui/task-controls.test.tsx`

Expected: FAIL until the final responsive/reduced-motion styling exists.

- [ ] **Step 3: Apply visual polish without behavior changes.**

```css
:root { --surface-0: #11151c; --surface-1: #181e28; --surface-2: #222a36; --color-accent: #66a9e8; --color-premium: #c9a96a; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }
```

Apply 4/8px spacing, restrained radii/shadows, status text plus color, readable empty states, and skeleton blocks only for meaningful Library/Play Now/drawer loads. Gold is restricted to Play Now hero and achievement highlights; no charts, autoplaying movement, or decorative dependency. Guarantee 44px mobile target heights.

- [ ] **Step 4: Run focused dashboard checks.**

Run: `npm test -- --run tests/dashboard-ui/app.test.tsx tests/dashboard-ui/task-controls.test.tsx tests/dashboard-ui/library-filters.test.ts`

Expected: PASS for composition, accessibility, polling, responsive CSS, and existing filters.

- [ ] **Step 5: Run complete gates.**

Run: `npm test -- --run`

Expected: PASS full suite.

Run: `npm run typecheck`

Expected: PASS for server and dashboard projects.

Run: `npm run lint`

Expected: PASS without lint errors.

Run: `npm run format:check`

Expected: PASS with Prettier-clean source.

Run: `npm run build`

Expected: PASS for server TypeScript and Vite dashboard builds.

- [ ] **Step 6: Inspect final scope before commit.**

Run: `git diff --check && git status --short && git diff -- dashboard-ui src/dashboard tests/dashboard-ui`

Expected: no whitespace error; changes limited to dashboard UI/tests and removal/re-export shims; no `images/`, backend contract, API, or domain-service changes.

- [ ] **Step 7: Commit.**

```bash
git add dashboard-ui/src/styles.css dashboard-ui/src/components/inline-notice.tsx dashboard-ui/src/components/progress-bar.tsx tests/dashboard-ui/app.test.tsx tests/dashboard-ui/task-controls.test.tsx
git commit -m "style: polish responsive dashboard UI"
```

## Self-Review

1. **Spec coverage:** Tasks 1–2 cover persistent shell, six views, navigation, Library grid, filters, cover fallback, and state retention. Task 3 covers drawer semantics, status, achievements, narrow widths, focus trap, Escape, and restoration. Task 4 covers Play Now, secondary Preferences, Backlog separation, request semantics, and contract-limited display. Tasks 5–7 cover summary-only Home, Manual truthfulness/mutations, and Tasks with shared polling. Task 8 covers tokens, responsive desktop/tablet/mobile behavior, reduced motion, loading/empty/error treatment, and all quality gates. No backend or contract change is planned.
2. **Placeholder scan:** Checked every task for deferred implementation language and replaced it with concrete component contracts, code, commands, and assertions. No unresolved implementation placeholder remains.
3. **Type consistency:** `DashboardView`, `HomeTaskSummary`, `IntelligenceState`, `TaskApi`, `TaskState`, and view callback names are defined before use. All request calls retain existing `DashboardApi` types: recommendations `(number, DashboardSessionMode)`, plan create `{ cadence, availableMinutes, targetGameCount }`, progress `(planId, itemId, DashboardPlanItemProgress)`, and manual patch `{ accessType?, isPlayable? }`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-05-dashboard-ui-2.0.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
