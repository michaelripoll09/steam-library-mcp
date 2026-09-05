import type { DashboardLibrary } from "../../../src/dashboard/contracts.js";
import type { IntelligenceState } from "../intelligence-state.js";
import { formatPlaytime } from "../library-filters.js";
import type { DashboardView } from "../navigation/app-shell.js";

export type HomeTaskSummary = Readonly<{
  totalCount: number;
  activeCount: number;
  hasError: boolean;
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
  const snapshot = intelligenceState.snapshot;
  const recommendationCount = intelligenceState.recommendations?.recommendations.length;

  return (
    <section className="home-view" aria-labelledby="home-heading">
      <div>
        <p className="eyebrow">Tu espacio de juego</p>
        <h2 id="home-heading">Resumen</h2>
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
      <section className="home-insight-summary" aria-label="Resumen de Play Now">
        <h3>Play Now</h3>
        {snapshot === undefined ? (
          <CompactState>Calcula Play Now para cargar sus recomendaciones y planes.</CompactState>
        ) : (
          <p>
            {snapshot.activePlans.length} planes activos · {snapshot.preferences.highPriorityGames}{" "}
            con prioridad alta
          </p>
        )}
        {recommendationCount !== undefined && (
          <p>{recommendationCount} recomendaciones cargadas.</p>
        )}
      </section>
      <section className="home-task-summary" aria-label="Estado de tareas">
        <span>Tareas locales</span>
        <strong>{formatTaskSummary(taskSummary)}</strong>
      </section>
      <div className="home-navigation-actions" aria-label="Accesos rápidos">
        <button type="button" onClick={() => onNavigate("library")}>
          Ver biblioteca
        </button>
        <button type="button" onClick={() => onNavigate("play-now")}>
          Calcular Play Now
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
  if (summary.hasError) return "Revisar tareas";
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
