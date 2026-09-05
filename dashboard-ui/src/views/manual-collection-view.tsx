import { ManualGameRow, type ManualCollectionViewProps } from "../manual-collection-panel.js";

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
          <p id="manual-collection-error" className="status-error" role="alert">
            {error}
          </p>
        )}
        <p className="inline-notice">
          El acceso Familia es metadata local declarada por el usuario. Steam Library MCP no
          sincroniza Steam Families.
        </p>
      </div>
      {collection.length > 0 && (
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
        <p className="eyebrow">Utilidad local</p>
        <h2 id="manual-collection-heading">Colección manual</h2>
      </div>
      <p>Agregá referencias personales sin convertirlas en una confirmación de acceso.</p>
    </header>
  );
}
