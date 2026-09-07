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

const navigationIcons: Record<DashboardView, string> = {
  home: "M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9",
  library: "M4 4h4v16H4zM10 4h4v16h-4zM16 5l4-1 3 15-4 1z",
  "play-now": "m8 4 12 8-12 8Z",
  backlog: "M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1",
  manual: "M3 6h7l2 2h9v12H3ZM12 11v6M9 14h6",
  tasks: "m3 6 2 2 4-4M12 6h9m-18 8 2 2 4-4M12 14h9M12 20h9",
};

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
        <p className="dashboard-brand" aria-label="Steam">
          Steam
        </p>
        <nav aria-label="Secciones del panel">
          <ul className="dashboard-navigation">
            {destinations.map((destination) => (
              <li key={destination.view}>
                <button
                  className="dashboard-navigation-button"
                  type="button"
                  title={destination.label}
                  aria-label={destination.label}
                  aria-current={activeView === destination.view ? "page" : undefined}
                  onClick={() => onViewChange(destination.view)}
                >
                  <svg
                    className="dashboard-navigation-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={navigationIcons[destination.view]} />
                  </svg>
                  <span className="dashboard-navigation-label">{destination.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="dashboard-content">
        <header className="dashboard-topbar" aria-label="Barra superior del panel">
          <p className="eyebrow">Steam Library MCP</p>
          <h1>{activeDestination?.title}</h1>
        </header>
        {children}
      </div>
    </div>
  );
}
