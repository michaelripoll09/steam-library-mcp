import type { ManualLibraryGame } from "../../src/manual-library/manual-library.js";

export function ManualCollectionPanel({
  collection,
  steam,
  error,
  saving,
  onSteamChange,
  onAdd,
  onUpdate,
  onRemove,
}: Readonly<{
  collection: readonly ManualLibraryGame[];
  steam: string;
  error: string | undefined;
  saving: boolean;
  onSteamChange: (value: string) => void;
  onAdd: () => void;
  onUpdate: (
    appId: number,
    patch: { accessType?: "manual" | "family"; isPlayable?: boolean },
  ) => void;
  onRemove: (appId: number) => void;
}>) {
  return (
    <section className="manual-collection-panel" aria-labelledby="manual-collection-heading">
      <div>
        <p className="eyebrow">Colección manual</p>
        <h2 id="manual-collection-heading">Juegos agregados manualmente</h2>
        <p>Esta lista no confirma que Steam te dé acceso ni que el juego esté disponible ahora.</p>
      </div>
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
      {collection.length > 0 && (
        <ul className="manual-collection-list">
          {collection.map((game) => (
            <li key={game.appId}>
              <span>
                {game.name} <small>· AppID {game.appId}</small>
              </span>
              <label>
                Acceso de {game.name}
                <select
                  value={game.accessType}
                  onChange={(event) =>
                    onUpdate(game.appId, {
                      accessType: event.target.value as "manual" | "family",
                    })
                  }
                >
                  <option value="manual">Manual</option>
                  <option value="family">Familia</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={game.isPlayable}
                  onChange={(event) => onUpdate(game.appId, { isPlayable: event.target.checked })}
                />
                Disponible para jugar: {game.name}
              </label>
              <span>{game.isPlayable ? "Listo para jugar" : "No disponible para jugar"}</span>
              <button
                type="button"
                onClick={() => onRemove(game.appId)}
                aria-label={`Quitar ${game.name}`}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
