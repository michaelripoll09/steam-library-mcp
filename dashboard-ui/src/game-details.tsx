import { useRef } from "react";

import type {
  DashboardAchievementResult,
  DashboardGame,
  DashboardMutableStatus,
} from "../../src/dashboard/contracts.js";
import type { SteamAchievement } from "../../src/domain/achievements.js";
import { formatPlaytime } from "./library-filters.js";
import { CoverImage, formatLabel } from "./library-panel.js";

const MUTABLE_STATUSES: readonly DashboardMutableStatus[] = [
  "playing",
  "paused",
  "completed",
  "dropped",
];

export function GameDetails({
  game,
  closeButtonRef,
  isUpdatingStatus,
  statusError,
  statusMessage,
  achievementResult,
  isLoadingAchievements,
  achievementError,
  onLoadAchievements,
  onClose,
  onStatusChange,
}: Readonly<{
  game: DashboardGame;
  closeButtonRef: React.RefObject<HTMLButtonElement | null>;
  isUpdatingStatus: boolean;
  statusError: string | undefined;
  statusMessage: string | undefined;
  achievementResult: DashboardAchievementResult | undefined;
  isLoadingAchievements: boolean;
  achievementError: string | undefined;
  onLoadAchievements: (() => Promise<void>) | undefined;
  onClose: () => void;
  onStatusChange: (status: DashboardMutableStatus) => Promise<void>;
}>) {
  const dialogRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusableElements === undefined || focusableElements.length === 0) return;

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="game-details"
        role="dialog"
        aria-modal="true"
        aria-label={`Detalles de ${game.name}`}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <button
          ref={closeButtonRef}
          className="dialog-close"
          type="button"
          onClick={onClose}
          aria-label="Cerrar detalles"
        >
          ×
        </button>
        <CoverImage game={game} />
        <div className="details-copy">
          <p className="eyebrow">{`Juego ${formatLabel(game.accessType).toLowerCase()}`}</p>
          <h2 id="game-details-title">{game.name}</h2>
          <p>{formatPlaytime(game.playtimeMinutes)} jugado</p>
          {game.manualCollection && (
            <p className="manual-game-notice">
              Administrado manualmente: no confirma acceso ni disponibilidad actual en Steam.
            </p>
          )}
          {game.lastPlayedAt !== undefined && (
            <p>Última vez jugado: {formatLastPlayed(game.lastPlayedAt)}</p>
          )}
          <p>{game.isPlayable ? "Listo para jugar" : "No se puede jugar actualmente"}</p>
          <label className="status-control">
            <span>Estado</span>
            <select
              value={game.status}
              disabled={isUpdatingStatus}
              aria-busy={isUpdatingStatus}
              onChange={(event) =>
                void onStatusChange(event.target.value as DashboardMutableStatus)
              }
            >
              {!MUTABLE_STATUSES.includes(game.status as DashboardMutableStatus) && (
                <option value={game.status} disabled>
                  {formatLabel(game.status)}
                </option>
              )}
              {MUTABLE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <div className="dialog-live-region" aria-live="polite">
            {isUpdatingStatus && "Guardando estado…"}
            {statusMessage}
          </div>
          {statusError !== undefined && (
            <p className="status-error" role="alert">
              {statusError}
            </p>
          )}
          {onLoadAchievements !== undefined && (
            <section className="achievement-progress" aria-labelledby="achievement-progress-title">
              <h3 id="achievement-progress-title">Logros</h3>
              {achievementResult === undefined &&
                !isLoadingAchievements &&
                achievementError === undefined && (
                  <button type="button" onClick={() => void onLoadAchievements()}>
                    Cargar logros
                  </button>
                )}
              {isLoadingAchievements && <p aria-live="polite">Cargando logros…</p>}
              {achievementError !== undefined && (
                <p className="achievement-error" role="alert">
                  No se pudieron cargar los logros. {achievementError}
                </p>
              )}
              {achievementResult?.status === "unavailable" && (
                <p className="achievement-unavailable">Los logros no están disponibles.</p>
              )}
              {achievementResult?.status === "available" && (
                <>
                  <p className="achievement-count">
                    {achievementResult.progress.unlockedCount} /{" "}
                    {achievementResult.progress.totalCount} ·{" "}
                    {achievementResult.progress.completionPercent}%
                  </p>
                  <ul className="achievement-list" aria-label="Logros recientes y pendientes">
                    {achievementResult.progress.achievements
                      .slice()
                      .sort(compareAchievements)
                      .slice(0, 10)
                      .map((achievement) => (
                        <li key={achievement.apiName}>
                          <strong>{achievement.displayName}</strong>
                          <span>{achievement.achieved ? "Desbloqueado" : "Pendiente"}</span>
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function compareAchievements(left: SteamAchievement, right: SteamAchievement): number {
  if (left.achieved !== right.achieved) return left.achieved ? -1 : 1;
  if (left.achieved) {
    const byUnlockTime = Date.parse(right.unlockTime ?? "") - Date.parse(left.unlockTime ?? "");
    if (!Number.isNaN(byUnlockTime) && byUnlockTime !== 0) return byUnlockTime;
  }
  return left.displayName.localeCompare(right.displayName, "es");
}

function formatLastPlayed(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "en una fecha desconocida";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}
