import { CoverImage } from "../components/game-card.js";
import { homeActivity } from "../presentation.js";
import type { DashboardLibrary } from "../../../src/dashboard/contracts.js";
import type { IntelligenceState } from "../intelligence-state.js";
import { formatPlaytime } from "../library-filters.js";
import type { DashboardView } from "../navigation/app-shell.js";

export type HomeTaskSummary = Readonly<{
  totalCount: number;
  activeCount: number;
  hasError: boolean;
  hasLoaded: boolean;
}>;

type HomeDestination = Extract<DashboardView, "library" | "play-now" | "backlog" | "tasks">;

export function HomeView({
  library,
  isLoading,
  error,
  intelligenceState,
  taskSummary,
  onNavigate,
}: Readonly<{
  library: DashboardLibrary | undefined;
  isLoading: boolean;
  error: string | undefined;
  intelligenceState: IntelligenceState;
  taskSummary: HomeTaskSummary | undefined;
  onNavigate: (view: HomeDestination) => void;
}>) {
  const games = library?.games ?? [];
  const continueGame = games.find((game) => game.status === "playing" && game.isPlayable);
  const activity = homeActivity(games);
  const nextItems = intelligenceState.plans
    .flatMap((plan) => plan.items)
    .filter((item) => item.progress === "not_started")
    .slice(0, 3);
  const snapshot = intelligenceState.snapshot;
  const recommendationCount = intelligenceState.recommendations?.recommendations.length;

  return (
    <section className="home-view" aria-labelledby="home-heading">
      <div>
        <p className="eyebrow">Tu espacio de juego</p>
        <h2 id="home-heading">Hola, ¿qué vas a jugar?</h2>
        <p className="subtitle">Una lectura rápida de tu biblioteca y de lo que sigue.</p>
      </div>
      {library === undefined ? (
        <LibrarySummaryState isLoading={isLoading} error={error} />
      ) : (
        <div className="home-summary-grid" aria-label="Resumen de la biblioteca">
          <StatCard label="Juegos totales" value={String(library.totals.totalGames)} />
          <StatCard label="Jugando" value={String(library.statusStats.playing)} />
          <StatCard label="Backlog" value={String(library.statusStats.backlog)} />
          <StatCard
            label="Tiempo jugado"
            value={formatPlaytime(library.totals.totalPlaytimeMinutes)}
          />
        </div>
      )}
      <div className="home-feature-grid">
        <section className="home-continue" aria-label="Resumen de Play Now">
          {continueGame && <CoverImage game={continueGame} />}
          <div className="home-continue-copy">
            <h3>{continueGame ? "Continuar jugando" : "Tu próxima partida"}</h3>
            <strong>{continueGame?.name ?? "Descubre qué jugar"}</strong>
            <p>
              {continueGame
                ? formatPlaytime(continueGame.playtimeMinutes) + " jugado"
                : "Una recomendación para el tiempo que tienes disponible."}
            </p>
            <button className="primary-button" type="button" onClick={() => onNavigate("play-now")}>
              Calcular Play Now
            </button>
          </div>
        </section>
        <section className="home-insight-summary">
          <h3>Tu actividad</h3>
          <strong className="activity-value">
            {library ? formatPlaytime(library.totals.totalPlaytimeMinutes) : "—"}
          </strong>
          <p>Tiempo total en tu biblioteca</p>
          <p className="home-compact-state">
            Steam no proporciona un desglose semanal en esta vista.
          </p>
          {snapshot && (
            <p>
              {snapshot.activePlans.length} planes activos ·{" "}
              {snapshot.preferences.highPriorityGames} con prioridad alta
            </p>
          )}
          {recommendationCount !== undefined && (
            <p>{recommendationCount} recomendaciones cargadas.</p>
          )}
        </section>
      </div>
      <div className="home-lists-grid">
        <section className="home-list-card">
          <h3>Actividad reciente</h3>
          {activity.length ? (
            <ul className="home-game-list">
              {activity.map((game) => (
                <li key={game.appId}>
                  <CoverImage game={game} />
                  <div>
                    <strong>{game.name}</strong>
                    <span>
                      {formatPlaytime(game.playtimeMinutes)} total ·{" "}
                      {new Intl.DateTimeFormat("es-CO", {
                        dateStyle: "medium",
                        timeZone: "UTC",
                      }).format(new Date(game.lastPlayedAt!))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <CompactState>No hay fechas de actividad disponibles.</CompactState>
          )}
        </section>
        <section className="home-list-card">
          <h3>Próximo en tu backlog</h3>
          {nextItems.length ? (
            <ul className="home-game-list">
              {nextItems.map((item, index) => {
                const game = games.find((game) => game.appId === item.appId);
                return (
                  <li key={item.id + index}>
                    {game && <CoverImage game={game} />}
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {item.durationEstimateMinutes == null
                          ? "Duración desconocida"
                          : "~" + formatPlaytime(item.durationEstimateMinutes) + " estimadas"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <CompactState>Crea un plan para ver aquí tus próximos juegos.</CompactState>
          )}
        </section>
      </div>
      <section className="home-task-summary" aria-label="Estado de tareas">
        <span>Tareas locales</span>
        <strong>{formatTaskSummary(taskSummary)}</strong>
      </section>
      <div className="home-navigation-actions" aria-label="Accesos rápidos">
        <button type="button" onClick={() => onNavigate("library")}>
          Ver biblioteca
        </button>

        <button type="button" onClick={() => onNavigate("backlog")}>
          Ver backlog
        </button>
        <button type="button" onClick={() => onNavigate("tasks")}>
          Ver tareas
        </button>
      </div>
    </section>
  );
}

function formatTaskSummary(summary: HomeTaskSummary | undefined): string {
  if (summary === undefined) return "No disponibles";
  if (!summary.hasLoaded) return "Cargando tareas…";
  if (summary.hasError) return "No se pudieron cargar las tareas";
  if (summary.totalCount === 0) return "No hay tareas";
  if (summary.activeCount > 0) {
    return summary.activeCount === 1 ? "1 activa" : `${summary.activeCount} activas`;
  }
  return summary.totalCount === 1 ? "1 tarea" : `${summary.totalCount} tareas`;
}

function StatCard({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LibrarySummaryState({
  isLoading,
  error,
}: Readonly<{
  isLoading: boolean;
  error: string | undefined;
}>) {
  if (isLoading) return <CompactState>Cargando biblioteca…</CompactState>;
  if (error !== undefined) return <p role="alert">{error}</p>;
  return <CompactState>La biblioteca no está disponible.</CompactState>;
}

function CompactState({ children }: Readonly<{ children: string }>) {
  return <p className="home-compact-state">{children}</p>;
}
