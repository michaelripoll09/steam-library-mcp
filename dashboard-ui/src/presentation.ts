import type { DashboardGame } from "../../src/dashboard/contracts.js";

export function presentationError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/plan-item progress transition/i.test(message))
    return "No se puede realizar ese cambio de progreso.";
  if (/steam.*unavailable/i.test(message))
    return "Steam no está disponible. Inténtalo de nuevo más tarde.";
  if (/offline|fetch|network/i.test(message))
    return "No se pudo conectar con el servicio. Inténtalo de nuevo.";
  if (/AppID|Steam URL|steam reference/i.test(message))
    return "Introduce una URL de Steam o un AppID válido.";
  return "No se pudo completar la operación. Inténtalo de nuevo.";
}

export function recommendationReason(reason: string): string | undefined {
  const labels: Readonly<Record<string, string>> = {
    priority_high: "Prioridad alta",
    status_playing: "Jugando",
    status_paused: "Pausado",
    finishable_in_session: "Cabe en tu sesión",
    duration_unknown: "Duración desconocida",
  };
  return labels[reason];
}

export function homeActivity(games: readonly DashboardGame[]): readonly DashboardGame[] {
  return games
    .filter((game) => Number.isFinite(Date.parse(game.lastPlayedAt ?? "")))
    .slice()
    .sort((a, b) => Date.parse(b.lastPlayedAt!) - Date.parse(a.lastPlayedAt!))
    .slice(0, 3);
}
