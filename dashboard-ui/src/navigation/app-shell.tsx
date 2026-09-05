import type { ReactNode } from "react";

export type DashboardView = "home" | "library" | "play-now" | "backlog" | "manual" | "tasks";

const destinations: readonly Readonly<{ view: DashboardView; label: string; title: string }>[] = [
  { view: "home", label: "Inicio", title: "Inicio" },
  { view: "library", label: "Biblioteca", title: "Biblioteca" },
  { view: "play-now", label: "Play Now", title: "Play Now" },
  { view: "backlog", label: "Backlog", title: "Backlog" },
  { view: "manual", label: "Colección manual", title: "Colección manual" },
  { view: "tasks", label: "Tareas", title: "Tareas" },
];

export function AppShell({
  activeView,
  onViewChange,
  children,
}: Readonly<{
  activeView: DashboardView;
  onViewChange: (view: DashboardView) => void;
  children: ReactNode;
}>) {
  const activeDestination = destinations.find((destination) => destination.view === activeView);

  return (
    <div className="dashboard-workspace">
      <aside className="dashboard-sidebar" aria-label="Navegación principal">
        <p className="dashboard-brand">Steam</p>
        <nav aria-label="Secciones del panel">
          <ul className="dashboard-navigation">
            {destinations.map((destination) => (
              <li key={destination.view}>
                <button
                  className="dashboard-navigation-button"
                  type="button"
                  aria-current={activeView === destination.view ? "page" : undefined}
                  onClick={() => onViewChange(destination.view)}
                >
                  {destination.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="dashboard-content">
        <header className="dashboard-topbar" aria-label="Barra superior del panel">
          <p className="eyebrow">Archivo personal de juegos</p>
          <h1>{activeDestination?.title}</h1>
        </header>
        {children}
      </div>
    </div>
  );
}
