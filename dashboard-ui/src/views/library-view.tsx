import type { DashboardGame, DashboardLibrary } from "../../../src/dashboard/contracts.js";
import type { LibraryFilters } from "../library-filters.js";
import { LibraryPanel } from "../library-panel.js";

export type LibraryViewProps = Readonly<{
  library: DashboardLibrary | undefined;
  games: readonly DashboardGame[];
  filters: LibraryFilters;
  isLoading: boolean;
  error: string | undefined;
  isSyncing: boolean;
  syncError: string | undefined;
  onFiltersChange: (filters: LibraryFilters) => void;
  onRetryLoad: () => void;
  onSync: () => void;
  onOpen: (game: DashboardGame, opener: HTMLButtonElement) => void;
}>;

export function LibraryView({
  library,
  games,
  filters,
  isLoading,
  error,
  isSyncing,
  syncError,
  onFiltersChange,
  onRetryLoad,
  onSync,
  onOpen,
}: LibraryViewProps) {
  return (
    <section aria-labelledby="library-heading" className="library-view">
      <div className="dashboard-view-heading">
        <div>
          <h2 id="library-heading">Biblioteca</h2>
          <p className="subtitle">Explora, filtra y administra tu colección.</p>
        </div>
        <div className="library-view-actions">
          {library !== undefined && <p className="result-count">{games.length} mostrados</p>}
          <button className="sync-button" type="button" onClick={onSync} disabled={isSyncing}>
            {isSyncing ? "Sincronizando biblioteca…" : "Sincronizar biblioteca"}
          </button>
        </div>
      </div>
      {syncError !== undefined && (
        <section className="notice notice-error" role="alert">
          <p>{syncError}</p>
          <button type="button" onClick={onSync} disabled={isSyncing}>
            Reintentar sincronización
          </button>
        </section>
      )}
      <LibraryPanel
        library={library}
        games={games}
        filters={filters}
        isLoading={isLoading}
        error={error}
        onFiltersChange={onFiltersChange}
        onRetryLoad={onRetryLoad}
        onOpen={onOpen}
      />
    </section>
  );
}
