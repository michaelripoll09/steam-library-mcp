import { useState } from "react";

import type { DashboardGame, DashboardGameStatus } from "../../../src/dashboard/contracts.js";
import { formatPlaytime } from "../library-filters.js";

export function GameCard({
  game,
  onOpen,
}: Readonly<{
  game: DashboardGame;
  onOpen: (game: DashboardGame, opener: HTMLButtonElement) => void;
}>) {
  return (
    <article className="game-card" aria-label={game.name}>
      <button
        type="button"
        className="game-card-button"
        onClick={(event) => onOpen(game, event.currentTarget)}
        aria-label={`Ver detalles de ${game.name}`}
      >
        <CoverImage game={game} />
        <span className="cover-status">
          <StatusPill status={game.status} />
        </span>
        <span className="game-card-content">
          <strong className="game-card-title">{game.name}</strong>
          <span className="game-card-meta">
            {formatPlaytime(game.playtimeMinutes)} jugado
            {game.accessType !== "owned" && ` · ${formatLabel(game.accessType)}`}
          </span>
        </span>
      </button>
    </article>
  );
}

export function CoverImage({ game }: Readonly<{ game: DashboardGame }>) {
  const [failedSourceCount, setFailedSourceCount] = useState(0);
  const [isLandscape, setIsLandscape] = useState(false);
  const coverUrls =
    game.coverUrl.trim() === ""
      ? []
      : [game.coverUrl, officialSteamIconUrl(game.appId)].filter(
          (url, index, urls) => urls.indexOf(url) === index,
        );
  const coverUrl = coverUrls[failedSourceCount];

  if (coverUrl === undefined) {
    return (
      <div
        className="cover-frame cover-fallback"
        role="img"
        aria-label={`Portada no disponible para ${game.name}`}
        style={{ backgroundImage: coverGradient(game.appId) }}
      >
        <span className="cover-fallback-title" aria-hidden="true">
          {game.name}
        </span>
      </div>
    );
  }

  return (
    <span className="cover-frame">
      <img
        className={`cover-image${isLandscape ? " cover-landscape" : ""}`}
        src={coverUrl}
        alt={`Portada de ${game.name}`}
        onError={() => setFailedSourceCount((count) => count + 1)}
        onLoad={(event) =>
          setIsLandscape(event.currentTarget.naturalWidth > event.currentTarget.naturalHeight)
        }
      />
    </span>
  );
}

function officialSteamIconUrl(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/icon.jpg`;
}

function StatusPill({ status }: Readonly<{ status: DashboardGameStatus }>) {
  return <span className={`status-pill status-${status}`}>{formatLabel(status)}</span>;
}

export function formatLabel(value: string): string {
  return (
    {
      all: "Todos",
      backlog: "Pendiente",
      playing: "Jugando",
      completed: "Completado",
      dropped: "Abandonado",
      paused: "Pausado",
      owned: "Propio",
      family: "Familia",
      manual: "Manual",
      played: "Jugados",
      unplayed: "Sin jugar",
    }[value] ?? value
  );
}

function coverGradient(appId: number): string {
  const hue = Math.abs(appId * 47) % 360;
  return `linear-gradient(145deg, hsl(${hue} 46% 30%), hsl(${(hue + 64) % 360} 52% 11%))`;
}
