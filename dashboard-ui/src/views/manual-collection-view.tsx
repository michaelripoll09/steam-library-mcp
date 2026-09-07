import { ManualGameRow, type ManualCollectionViewProps } from "../manual-collection-panel.js";
import { InlineNotice } from "../components/inline-notice.js";

export function ManualCollectionView({
  collection,
  steam,
  error,
  saving,
  onSteamChange,
  onAdd,
  onUpdate,
  onRemove,
}: ManualCollectionViewProps) {
  return (
    <section aria-labelledby="manual-collection-heading" className="manual-collection-view">
      <PageHeader />
      <div className="manual-collection-workspace">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onAdd();
          }}
        >
          <label htmlFor="manual-steam-input">URL de Steam o AppID</label>
          <div className="manual-collection-form">
            <input
              id="manual-steam-input"
              value={steam}
              onChange={(event) => onSteamChange(event.target.value)}
              placeholder="https://store.steampowered.com/app/…"
              aria-describedby={error === undefined ? undefined : "manual-collection-error"}
            />
            <button type="submit" disabled={saving}>
              {saving ? "Agregando…" : "Agregar"}
            </button>
          </div>
        </form>
        {error !== undefined && (
          <InlineNotice tone="error">
            <span id="manual-collection-error">{error}</span>
          </InlineNotice>
        )}
        <InlineNotice tone="info">
          El acceso Familia es metadata local declarada por el usuario. Steam Library MCP no
          sincroniza Steam Families.
        </InlineNotice>
      </div>
      {collection.length === 0 ? (
        <section className="utility-empty">
          <h3>Aún no tienes juegos agregados</h3>
          <p>Añade títulos manualmente para tenerlos en cuenta.</p>
        </section>
      ) : (
        <ul className="manual-collection-list">
          {collection.map((game) => (
            <ManualGameRow key={game.appId} game={game} onUpdate={onUpdate} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PageHeader() {
  return (
    <header className="dashboard-view-heading">
      <div>
        <h2 id="manual-collection-heading">Colección manual</h2>
        <p className="subtitle">Agrega juegos que no están en tu biblioteca de Steam.</p>
      </div>
    </header>
  );
}
