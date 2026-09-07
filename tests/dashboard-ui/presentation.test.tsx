// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { expect, test } from "vitest";
import {
  presentationError,
  recommendationReason,
  homeActivity,
} from "../../dashboard-ui/src/presentation.js";

test("translates progress failures without exposing internal messages", () => {
  expect(
    presentationError(new Error("The requested plan-item progress transition is not allowed.")),
  ).toBe("No se puede realizar ese cambio de progreso.");
  expect(presentationError(new Error("SQLITE_BUSY: internal database path"))).toBe(
    "No se pudo completar la operación. Inténtalo de nuevo.",
  );
});
test("translates recommendation codes without inventing unknown reasons", () => {
  expect(recommendationReason("priority_high")).toBe("Prioridad alta");
  expect(recommendationReason("duration_unknown")).toBe("Duración desconocida");
  expect(recommendationReason("future_reason")).toBeUndefined();
});
test("recent activity uses actual last-played dates and excludes unknown dates", () => {
  const game = {
    appId: 1,
    name: "Game",
    coverUrl: "",
    status: "playing" as const,
    accessType: "owned" as const,
    isPlayable: true,
    playtimeMinutes: 20,
  };
  expect(
    homeActivity([
      game,
      { ...game, appId: 2, lastPlayedAt: "2026-08-01" },
      { ...game, appId: 3, lastPlayedAt: "2026-09-01" },
    ]).map((entry) => entry.appId),
  ).toEqual([3, 2]);
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { HomeView } from "../../dashboard-ui/src/views/home-view.js";
afterEach(cleanup);
test("Home shows actual artwork and an honest activity summary without invented weekly data", () => {
  const game = {
    appId: 1,
    name: "Hades",
    coverUrl: "https://example.com/cover.jpg",
    status: "playing",
    accessType: "owned",
    isPlayable: true,
    playtimeMinutes: 60,
    lastPlayedAt: "2026-09-01",
  };
  render(
    <HomeView
      library={
        {
          games: [game],
          totals: { totalGames: 1, totalPlaytimeMinutes: 60 },
          statusStats: { playing: 1, backlog: 0 },
        } as never
      }
      intelligenceState={{ plans: [] } as never}
      isLoading={false}
      error={undefined}
      taskSummary={undefined}
      onNavigate={() => {}}
    />,
  );
  expect(screen.getByRole("heading", { name: "Continuar jugando" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Actividad reciente" })).toBeInTheDocument();
  expect(
    screen.getByText("Steam no proporciona un desglose semanal en esta vista."),
  ).toBeInTheDocument();
  expect(screen.getAllByAltText("Portada de Hades").length).toBeGreaterThan(0);
});

import { GameDetailsDrawer } from "../../dashboard-ui/src/game-details/game-details-drawer.js";
import { ManualCollectionView } from "../../dashboard-ui/src/views/manual-collection-view.js";
test("drawer renders actual achievement progress and Steam icons", () => {
  render(
    <GameDetailsDrawer
      game={{
        appId: 1,
        name: "Hades",
        coverUrl: "",
        status: "playing",
        accessType: "owned",
        isPlayable: true,
        playtimeMinutes: 60,
      }}
      closeButtonRef={{ current: null }}
      isUpdatingStatus={false}
      statusError={undefined}
      statusMessage={undefined}
      achievementResult={{
        status: "available",
        progress: {
          appId: 1,
          name: "Hades",
          unlockedCount: 1,
          totalCount: 2,
          completionPercent: 50,
          achievements: [
            {
              apiName: "a",
              displayName: "First",
              description: null,
              achieved: true,
              unlockTime: null,
              iconUrl: "https://example.com/icon.jpg",
              iconGrayUrl: null,
            },
          ],
        },
      }}
      isLoadingAchievements={false}
      achievementError={undefined}
      onLoadAchievements={async () => {}}
      onClose={() => {}}
      onStatusChange={async () => {}}
    />,
  );
  expect(screen.getByRole("progressbar", { name: "Logros desbloqueados" })).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  expect(screen.getByRole("progressbar", { name: "Logros desbloqueados" })).toHaveAttribute(
    "aria-valuemax",
    "2",
  );
  expect(screen.getByRole("combobox", { name: "Estado" }).closest(".details-body")).not.toBeNull();
  expect(
    screen.getByRole("progressbar", { name: "Logros desbloqueados" }).closest(".details-copy"),
  ).toBeNull();
  expect(document.querySelector(".achievement-icon")).toHaveAttribute(
    "src",
    "https://example.com/icon.jpg",
  );
  expect(screen.queryByRole("button", { name: "Jugar" })).not.toBeInTheDocument();
});
test("manual collection has an actionable honest empty state", () => {
  render(
    <ManualCollectionView
      collection={[]}
      steam=""
      error={undefined}
      saving={false}
      onSteamChange={() => {}}
      onAdd={() => {}}
      onUpdate={() => {}}
      onRemove={() => {}}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Aún no tienes juegos agregados" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Agregar" })).toBeInTheDocument();
});

import { PlayNowView } from "../../dashboard-ui/src/views/play-now-view.js";
test("Play Now distinguishes total game duration from remaining session fit", () => {
  const game = {
    appId: 1,
    name: "Hades",
    coverUrl: "",
    status: "playing",
    accessType: "owned",
    isPlayable: true,
    playtimeMinutes: 4500,
  };
  const state = {
    availableMinutes: "60",
    sessionMode: "solo",
    recommendations: {
      recommendations: [
        {
          appId: 1,
          name: "Hades",
          durationEstimateMinutes: 4556,
          estimatedRemainingMinutes: 56,
          reasons: ["finishable_in_session"],
          explanation: "technical English",
        },
      ],
    },
    preference: { priority: "normal", playMode: "any" },
  };
  render(<PlayNowView games={[game] as never} state={state as never} onOpenGame={() => {}} />);
  expect(screen.getByText("Duración total estimada: 75h 56m")).toBeInTheDocument();
  expect(screen.getByText("~56m restantes")).toBeInTheDocument();
  expect(screen.queryByText("technical English")).not.toBeInTheDocument();
});
