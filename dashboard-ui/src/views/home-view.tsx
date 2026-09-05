import type { DashboardLibrary } from "../../../src/dashboard/contracts.js";
import type { DashboardView } from "../navigation/app-shell.js";

export type HomeTaskSummary = Readonly<{
  label: string;
  status: string;
}>;

export function HomeView({
  library,
  taskSummary,
  onNavigate,
}: Readonly<{
  library: DashboardLibrary | undefined;
  taskSummary: HomeTaskSummary;
  onNavigate: (view: DashboardView) => void;
}>) {
  return (
    <section className="home-view" aria-labelledby="home-heading">
      <div>
        <p className="eyebrow">Tu espacio de juego</p>
        <h2 id="home-heading">Resumen</h2>
        <p className="subtitle">Una lectura rápida de tu biblioteca y de lo que sigue.</p>
      </div>
      <div className="home-summary-grid" aria-label="Resumen de la biblioteca">
        <SummaryCard label="Juegos" value={String(library?.totals.totalGames ?? 0)} />
        <SummaryCard label="Jugando" value={String(library?.statusStats.playing ?? 0)} />
        <SummaryCard label="Backlog" value={String(library?.statusStats.backlog ?? 0)} />
        <SummaryCard
          label="Tiempo invertido"
          value={formatPlaytime(library?.totals.totalPlaytimeMinutes ?? 0)}
        />
      </div>
      <section className="home-task-summary" aria-label="Estado de tareas">
        <span>{taskSummary.label}</span>
        <strong>{taskSummary.status}</strong>
      </section>
      <div className="home-navigation-actions" aria-label="Accesos rápidos">
        <button type="button" onClick={() => onNavigate("library")}>
          Ver biblioteca
        </button>
        <button type="button" onClick={() => onNavigate("play-now")}>
          Elegir qué jugar
        </button>
        <button type="button" onClick={() => onNavigate("backlog")}>
          Planificar backlog
        </button>
        <button type="button" onClick={() => onNavigate("manual")}>
          Gestionar colección manual
        </button>
        <button type="button" onClick={() => onNavigate("tasks")}>
          Ver tareas
        </button>
      </div>
    </section>
  );
}

function SummaryCard({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatPlaytime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}
