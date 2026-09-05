// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { DashboardLibrary } from "../../src/dashboard/contracts.js";
import { DashboardApp } from "../../dashboard-ui/src/app.js";
import { CoverImage } from "../../dashboard-ui/src/library-panel.js";
import { ManualCollectionPanel } from "../../dashboard-ui/src/manual-collection-panel.js";

const library: DashboardLibrary = {
  games: [
    {
      appId: 10,
      name: "Celeste",
      status: "backlog",
      coverUrl: "https://cdn.example/celeste.jpg",
      accessType: "owned",
      isPlayable: true,
      playtimeMinutes: 0,
    },
    {
      appId: 20,
      name: "Hades",
      status: "playing",
      coverUrl: "https://cdn.example/hades.jpg",
      accessType: "manual",
      isPlayable: true,
      playtimeMinutes: 125,
      lastPlayedAt: "2026-08-26T18:30:00.000Z",
    },
  ],
  totals: { totalGames: 2, playedGames: 1, unplayedGames: 1, totalPlaytimeMinutes: 125 },
  statusStats: { backlog: 1, playing: 1, completed: 0, dropped: 0, paused: 0 },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DashboardApp", () => {
  test("uses one default API client for the initial library request across rerenders", async () => {
    const fetch = vi.spyOn(window, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(library), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const { rerender } = render(<DashboardApp />);
    await screen.findByRole("article", { name: "Celeste" });
    rerender(<DashboardApp />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls).toEqual(
      expect.arrayContaining([
        ["/api/library", { method: "GET" }],
        ["/api/tasks", { method: "GET" }],
        ["/api/manual-collection", { method: "GET" }],
      ]),
    );
  });

  test("loads persisted manual collection entries with the default API", async () => {
    const fetch = vi.spyOn(window, "fetch").mockImplementation((input) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            input === "/api/manual-collection"
              ? [
                  {
                    appId: 413150,
                    name: "Stardew Valley",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                  },
                ]
              : library,
          ),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(<DashboardApp />);
    expect(await screen.findByText("Stardew Valley")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/manual-collection", { method: "GET" });
  });

  test("updates a manual row to Familia and playable without removing or re-adding it", async () => {
    const user = userEvent.setup();
    const entry = {
      appId: 413150,
      name: "Stardew Valley",
      accessType: "manual" as const,
      isPlayable: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
      getManualCollection: vi.fn().mockResolvedValue([entry]),
      addManualCollection: vi.fn(),
      removeManualCollection: vi.fn(),
      updateManualCollection: vi.fn(async (_appId: number, patch: object) => ({
        ...entry,
        ...patch,
      })),
    };

    render(<DashboardApp api={api as never} />);

    expect(await screen.findByText("Stardew Valley")).toBeInTheDocument();
    expect(screen.getByText("No disponible para jugar")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Acceso de Stardew Valley"), "family");
    await waitFor(() =>
      expect(api.updateManualCollection).toHaveBeenCalledWith(413150, { accessType: "family" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Acceso de Stardew Valley")).toHaveValue("family"),
    );

    await user.click(screen.getByLabelText("Disponible para jugar: Stardew Valley"));
    await waitFor(() =>
      expect(api.updateManualCollection).toHaveBeenLastCalledWith(413150, { isPlayable: true }),
    );
    await waitFor(() => expect(screen.getByText("Listo para jugar")).toBeInTheDocument());
    expect(api.addManualCollection).not.toHaveBeenCalled();
    expect(api.removeManualCollection).not.toHaveBeenCalled();
  });

  test("forwards controlled manual add and remove actions", async () => {
    const user = userEvent.setup();
    const onSteamChange = vi.fn();
    const onAdd = vi.fn();
    const onRemove = vi.fn();

    render(
      <ManualCollectionPanel
        collection={[
          {
            appId: 413150,
            name: "Stardew Valley",
            accessType: "manual",
            isPlayable: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        steam=""
        error={undefined}
        saving={false}
        onSteamChange={onSteamChange}
        onAdd={onAdd}
        onUpdate={vi.fn()}
        onRemove={onRemove}
      />,
    );

    fireEvent.change(screen.getByLabelText("URL de Steam o AppID"), {
      target: { value: "413150" },
    });
    expect(onSteamChange).toHaveBeenCalledWith("413150");
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onAdd).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Quitar Stardew Valley" }));
    expect(onRemove).toHaveBeenCalledWith(413150);
  });

  test("labels manual catalog games without legacy access language", async () => {
    render(<DashboardApp api={{ getLibrary: vi.fn().mockResolvedValue(library) } as never} />);

    const manualCard = await screen.findByRole("article", { name: "Hades" });
    expect(manualCard).toHaveTextContent(/Manual/);
    expect(manualCard).not.toHaveTextContent(/familia/i);
  });

  test("uses the official cover URL once and replaces a failed image with an identifiable fallback", () => {
    render(<CoverImage game={library.games[0]} />);

    const cover = screen.getByRole("img", { name: "Portada de Celeste" });
    fireEvent.error(cover);
    fireEvent.error(cover);
    fireEvent.error(cover);
    fireEvent.error(cover);
    fireEvent.error(cover);
    fireEvent.error(cover);

    const fallback = screen.getByRole("img", { name: "Portada no disponible para Celeste" });
    expect(fallback).toHaveStyle({ backgroundImage: expect.stringContaining("linear-gradient") });
    expect(within(fallback).getByText("Celeste")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Portada de Celeste" })).not.toBeInTheDocument();
  });

  test("uses the official Steam icon before showing the deterministic fallback", () => {
    const game = {
      ...library.games[0],
      coverUrl: "https://cdn.cloudflare.steamstatic.com/steam/apps/10/library_600x900.jpg",
    };
    render(<CoverImage game={game} />);

    const cover = screen.getByRole("img", { name: "Portada de Celeste" });
    fireEvent.error(cover);
    expect(cover).toHaveAttribute(
      "src",
      "https://cdn.cloudflare.steamstatic.com/steam/apps/10/icon.jpg",
    );

    fireEvent.error(cover);
    expect(screen.getByRole("img", { name: "Portada no disponible para Celeste" })).toHaveStyle({
      backgroundImage: expect.stringContaining("linear-gradient"),
    });
  });

  test("keeps a long game title separate from its always-visible cover status", async () => {
    const longTitleLibrary: DashboardLibrary = {
      ...library,
      games: [
        {
          ...library.games[0],
          name: "A title that is intentionally much longer than a narrow game card can display",
          status: "backlog",
        },
      ],
    };
    const api = {
      getLibrary: vi.fn().mockResolvedValue(longTitleLibrary),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
    };

    render(<DashboardApp api={api} />);

    const card = await screen.findByRole("article", { name: longTitleLibrary.games[0].name });
    expect(within(card).getByText("Pendiente").parentElement).toHaveClass("cover-status");
    expect(within(card).getByText(longTitleLibrary.games[0].name)).toBeInTheDocument();
  });

  test("renders a landscape cover as a full-card cropped image", () => {
    render(<CoverImage game={library.games[0]} />);

    const cover = screen.getByRole("img", { name: "Portada de Celeste" });
    Object.defineProperty(cover, "naturalWidth", { configurable: true, value: 1600 });
    Object.defineProperty(cover, "naturalHeight", { configurable: true, value: 900 });
    fireEvent.load(cover);

    const landscapeCover = screen.getByRole("img", { name: "Portada de Celeste" });
    expect(landscapeCover).toHaveClass("cover-image", "cover-landscape");
    expect(landscapeCover.parentElement).toHaveClass("cover-frame");
    expect(landscapeCover.parentElement).not.toHaveClass("cover-frame-landscape");
    expect(landscapeCover.parentElement?.querySelector(".cover-backdrop")).not.toBeInTheDocument();
    expect(
      landscapeCover.parentElement?.querySelector(".cover-landscape-foreground"),
    ).not.toBeInTheDocument();
  });

  test("keeps a portrait cover in its existing direct card treatment", () => {
    render(<CoverImage game={library.games[0]} />);

    const cover = screen.getByRole("img", { name: "Portada de Celeste" });
    Object.defineProperty(cover, "naturalWidth", { configurable: true, value: 900 });
    Object.defineProperty(cover, "naturalHeight", { configurable: true, value: 1600 });
    fireEvent.load(cover);

    const portraitCover = screen.getByRole("img", { name: "Portada de Celeste" });
    expect(portraitCover).toHaveClass("cover-image");
    expect(portraitCover).not.toHaveClass("cover-landscape");
    expect(portraitCover.parentElement).toHaveClass("cover-frame");
    expect(portraitCover.parentElement).not.toHaveClass("cover-frame-landscape");
    expect(portraitCover.parentElement?.querySelector(".cover-backdrop")).not.toBeInTheDocument();
    expect(
      portraitCover.parentElement?.querySelector(".cover-landscape-foreground"),
    ).not.toBeInTheDocument();
  });

  test("renders a Spanish dashboard with accessible localized controls and dates", async () => {
    const user = userEvent.setup();
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
    };

    render(<DashboardApp api={api} />);

    expect(screen.getByRole("status", { name: "Cargando biblioteca" })).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Tu biblioteca de Steam" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Portada de Celeste" })).toHaveAttribute(
      "src",
      "https://cdn.example/celeste.jpg",
    );
    expect(screen.getByRole("form", { name: "Filtros de la biblioteca" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sincronizar biblioteca" })).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Buscar juegos" }), "hades");

    expect(screen.queryByRole("article", { name: "Celeste" })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Hades" })).toBeInTheDocument();
  });

  test("formats last played dates in Colombian Spanish without localizing API status values", async () => {
    const user = userEvent.setup();
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
    };

    render(<DashboardApp api={api} />);
    await user.click(await screen.findByRole("button", { name: "Ver detalles de Hades" }));

    const dialog = screen.getByRole("dialog", { name: "Detalles de Hades" });
    expect(within(dialog).getByText("Última vez jugado: 26/08/2026")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Estado")).toHaveValue("playing");
    expect(within(dialog).getByRole("option", { name: "Jugando" })).toHaveValue("playing");
    expect(within(dialog).getByRole("option", { name: "Pausado" })).toHaveValue("paused");
    expect(within(dialog).getByRole("option", { name: "Completado" })).toHaveValue("completed");
    expect(within(dialog).getByRole("option", { name: "Abandonado" })).toHaveValue("dropped");
  });

  test("loads achievement progress only after intent and retains it when detail is reopened", async () => {
    const user = userEvent.setup();
    let resolveAchievements: ((value: unknown) => void) | undefined;
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
      getAchievements: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveAchievements = resolve;
          }),
      ),
    };

    render(<DashboardApp api={api as never} />);
    await user.click(await screen.findByRole("button", { name: "Ver detalles de Celeste" }));
    const dialog = screen.getByRole("dialog", { name: "Detalles de Celeste" });
    expect(api.getAchievements).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Cargar logros" }));
    expect(api.getAchievements).toHaveBeenCalledWith(10);
    expect(within(dialog).getByText("Cargando logros…")).toBeInTheDocument();
    resolveAchievements?.({
      status: "available",
      progress: {
        appId: 10,
        name: "Celeste",
        unlockedCount: 1,
        totalCount: 2,
        completionPercent: 50,
        achievements: [
          {
            apiName: "SUMMIT",
            displayName: "Summit",
            description: "Reach the summit.",
            achieved: true,
            unlockTime: "2026-09-05T00:00:00.000Z",
            iconUrl: null,
            iconGrayUrl: null,
          },
          {
            apiName: "BERRIES",
            displayName: "Berries",
            description: null,
            achieved: false,
            unlockTime: null,
            iconUrl: null,
            iconGrayUrl: null,
          },
        ],
      },
    });
    expect(await within(dialog).findByText("1 / 2 · 50%")).toBeInTheDocument();
    expect(within(dialog).getByText("Summit")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cerrar detalles" }));
    await user.click(screen.getByRole("button", { name: "Ver detalles de Celeste" }));
    expect(screen.getByText("1 / 2 · 50%")).toBeInTheDocument();
    expect(api.getAchievements).toHaveBeenCalledTimes(1);
  });

  test("keeps an active achievement request pending when another dialog request fails", async () => {
    const user = userEvent.setup();
    const rejectAchievements = new Map<number, (reason?: unknown) => void>();
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
      getAchievements: vi.fn(
        (appId: number) =>
          new Promise((_, reject) => {
            rejectAchievements.set(appId, reject);
          }),
      ),
    };

    render(<DashboardApp api={api as never} />);
    await user.click(await screen.findByRole("button", { name: "Ver detalles de Celeste" }));
    const celesteDialog = screen.getByRole("dialog", { name: "Detalles de Celeste" });
    await user.click(within(celesteDialog).getByRole("button", { name: "Cargar logros" }));

    await user.click(within(celesteDialog).getByRole("button", { name: "Cerrar detalles" }));
    await user.click(screen.getByRole("button", { name: "Ver detalles de Hades" }));
    const hadesDialog = screen.getByRole("dialog", { name: "Detalles de Hades" });
    await user.click(within(hadesDialog).getByRole("button", { name: "Cargar logros" }));

    rejectAchievements.get(10)?.(new Error("Celeste failed"));

    expect(await within(hadesDialog).findByText("Cargando logros…")).toBeInTheDocument();
    expect(within(hadesDialog).queryByText(/Celeste failed/)).not.toBeInTheDocument();
  });

  test("shows a safe unavailable achievement state", async () => {
    const user = userEvent.setup();
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
      getAchievements: vi.fn().mockResolvedValue({
        status: "unavailable",
        appId: 10,
        name: "Celeste",
        reason: "not_available",
      }),
    };

    render(<DashboardApp api={api as never} />);
    await user.click(await screen.findByRole("button", { name: "Ver detalles de Celeste" }));
    const dialog = screen.getByRole("dialog", { name: "Detalles de Celeste" });
    await user.click(within(dialog).getByRole("button", { name: "Cargar logros" }));

    expect(await within(dialog).findByText("Los logros no están disponibles.")).toBeInTheDocument();
  });

  test("opens a keyboard-accessible detail dialog, updates status, and restores focus on Escape", async () => {
    const user = userEvent.setup();
    const updatedLibrary: DashboardLibrary = {
      ...library,
      games: [library.games[0], { ...library.games[1], status: "paused" }],
      statusStats: { ...library.statusStats, playing: 0, paused: 1 },
    };
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn().mockResolvedValue({
        mark: { outcome: "updated", appId: 20, status: "paused" },
        library: updatedLibrary,
      }),
    };

    render(<DashboardApp api={api} />);
    const gameButton = await screen.findByRole("button", { name: "Ver detalles de Hades" });
    await user.click(gameButton);

    const dialog = screen.getByRole("dialog", { name: "Detalles de Hades" });
    expect(within(dialog).getByText("2h 5m jugado")).toBeInTheDocument();
    expect(within(dialog).getByText("Última vez jugado: 26/08/2026")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Estado"), "paused");

    expect(api.updateGameStatus).toHaveBeenCalledWith(20, "paused");
    expect(await within(dialog).findByText("Estado guardado.")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(gameButton).toHaveFocus();
  });

  test("keeps the current library visible after sync failure and offers a retryable live error", async () => {
    const user = userEvent.setup();
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn().mockRejectedValue(new Error("Steam is unavailable.")),
      updateGameStatus: vi.fn(),
    };

    render(<DashboardApp api={api} />);
    await screen.findByRole("article", { name: "Celeste" });
    await user.click(screen.getByRole("button", { name: "Sincronizar biblioteca" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Steam is unavailable.");
    expect(screen.getByRole("article", { name: "Celeste" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar sincronización" })).toBeInTheDocument();
  });

  test("retries an initial load failure", async () => {
    const user = userEvent.setup();
    const api = {
      getLibrary: vi
        .fn()
        .mockRejectedValueOnce(new Error("Steam is unavailable."))
        .mockResolvedValueOnce(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
    };

    render(<DashboardApp api={api} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Steam is unavailable.");
    await user.click(screen.getByRole("button", { name: "Reintentar carga de la biblioteca" }));

    expect(await screen.findByRole("article", { name: "Celeste" })).toBeInTheDocument();
    expect(api.getLibrary).toHaveBeenCalledTimes(2);
  });

  test("shows an empty filter state and resets the full grid", async () => {
    const user = userEvent.setup();
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
    };

    render(<DashboardApp api={api} />);
    await screen.findByRole("article", { name: "Celeste" });
    await user.type(screen.getByRole("searchbox", { name: "Buscar juegos" }), "missing game");

    expect(
      await screen.findByRole("heading", { name: "Ningún juego coincide con estos filtros" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restablecer" }));

    expect(screen.getByRole("article", { name: "Celeste" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Ningún juego coincide con estos filtros" }),
    ).not.toBeInTheDocument();
  });

  test("keeps the dialog status control pending until the server responds", async () => {
    const user = userEvent.setup();
    let resolveUpdate:
      | ((value: {
          mark: { outcome: "updated"; appId: number; status: "completed" };
          library: DashboardLibrary;
        }) => void)
      | undefined;
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpdate = resolve;
          }),
      ),
    };

    render(<DashboardApp api={api} />);
    await user.click(await screen.findByRole("button", { name: "Ver detalles de Hades" }));
    const dialog = screen.getByRole("dialog");
    const status = within(dialog).getByLabelText("Estado");
    await user.selectOptions(status, "completed");

    expect(status).toBeDisabled();
    expect(within(dialog).getByText("Guardando estado…")).toBeInTheDocument();
    resolveUpdate?.({ mark: { outcome: "updated", appId: 20, status: "completed" }, library });
    expect(await within(dialog).findByText("Estado guardado.")).toBeInTheDocument();
  });

  test("preserves the displayed snapshot when a status mutation fails", async () => {
    const user = userEvent.setup();
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn().mockRejectedValue(new Error("Tracker is offline.")),
    };

    render(<DashboardApp api={api} />);
    await user.click(await screen.findByRole("button", { name: "Ver detalles de Hades" }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Estado"), "completed");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Tracker is offline.");
    expect(
      within(screen.getByRole("article", { name: "Hades" })).getByText("Jugando"),
    ).toBeInTheDocument();
  });

  test("replaces the grid with the successful sync snapshot", async () => {
    const user = userEvent.setup();
    const refreshed: DashboardLibrary = {
      ...library,
      games: [library.games[1]],
      totals: { ...library.totals, totalGames: 1 },
    };
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn().mockResolvedValue(refreshed),
      updateGameStatus: vi.fn(),
    };

    render(<DashboardApp api={api} />);
    await screen.findByRole("article", { name: "Celeste" });
    await user.click(screen.getByRole("button", { name: "Sincronizar biblioteca" }));

    expect(await screen.findByRole("article", { name: "Hades" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Celeste" })).not.toBeInTheDocument();
  });

  test("uses the refreshed server status after an auto-pause update", async () => {
    const user = userEvent.setup();
    const refreshed: DashboardLibrary = {
      ...library,
      games: [library.games[0], { ...library.games[1], status: "paused" }],
      statusStats: { ...library.statusStats, playing: 0, paused: 1 },
    };
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn().mockResolvedValue({
        mark: { outcome: "updated", appId: 20, status: "playing" },
        library: refreshed,
      }),
    };

    render(<DashboardApp api={api} />);
    await user.click(await screen.findByRole("button", { name: "Ver detalles de Hades" }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Estado"), "completed");

    expect(await within(dialog).findByDisplayValue("Pausado")).toBeInTheDocument();
    expect(
      within(screen.getByRole("article", { name: "Hades" })).getByText("Pausado"),
    ).toBeInTheDocument();
  });

  test("contains keyboard focus within the dialog before Escape returns it to the opener", async () => {
    const user = userEvent.setup();
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
    };

    render(<DashboardApp api={api} />);
    const opener = await screen.findByRole("button", { name: "Ver detalles de Hades" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Cerrar detalles" });
    const status = within(dialog).getByLabelText("Estado");

    expect(close).toHaveFocus();
    await user.tab();
    expect(status).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });

  test("removes motion and transforms for reduced-motion users", async () => {
    const styles = await readFile(resolve(process.cwd(), "dashboard-ui/src/styles.css"), "utf8");

    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(styles).toMatch(/animation:\s*none !important/);
    expect(styles).toMatch(/transition:\s*none !important/);
    expect(styles).toMatch(/transform:\s*none !important/);
  });

  test("keeps all four library totals in a desktop summary grid", async () => {
    const styles = await readFile(resolve(process.cwd(), "dashboard-ui/src/styles.css"), "utf8");

    expect(styles).toMatch(
      /\.summary-grid\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/s,
    );
  });

  test("keeps the manual collection and library summary transition compact", async () => {
    const styles = await readFile(resolve(process.cwd(), "dashboard-ui/src/styles.css"), "utf8");

    expect(styles).toMatch(/\.summary-grid\s*\{[^}]*margin:\s*1\.4rem\s+0;/s);
  });

  test("gives desktop game details a resilient cover gutter and title wrapping", async () => {
    const styles = await readFile(resolve(process.cwd(), "dashboard-ui/src/styles.css"), "utf8");
    const desktopDetails = styles.match(/\.game-details\s*\{[^}]*\}/s)?.[0];
    const detailsCopy = styles.match(/\.details-copy\s*\{[^}]*\}/s)?.[0];
    const detailsHeading = styles.match(/\.details-copy h2\s*\{[^}]*\}/s)?.[0];
    const mobileDetails = styles.match(
      /@media \(max-width: 760px\)\s*\{[\s\S]*?\.game-details\s*\{[^}]*\}/s,
    )?.[0];

    expect(desktopDetails).toMatch(/column-gap:\s*1\.25rem/);
    expect(detailsCopy).toMatch(/min-width:\s*0/);
    expect(detailsHeading).toMatch(/overflow-wrap:\s*anywhere/);
    expect(detailsHeading).toMatch(/line-height:\s*1\.1/);
    expect(mobileDetails).toMatch(/column-gap:\s*0/);
  });
});

test("uses an accessible custom filter menu that applies selections through the keyboard", async () => {
  const user = userEvent.setup();
  const api = {
    getLibrary: vi.fn().mockResolvedValue(library),
    syncLibrary: vi.fn(),
    updateGameStatus: vi.fn(),
  };
  render(<DashboardApp api={api} />);
  await screen.findByRole("article", { name: "Celeste" });

  const statusFilter = screen.getByRole("combobox", { name: "Estado" });
  expect(statusFilter).toHaveAttribute("aria-expanded", "false");
  expect(
    screen.getByRole("form", { name: "Filtros de la biblioteca" }).querySelector("select"),
  ).toBeNull();

  await user.click(statusFilter);
  expect(statusFilter).toHaveAttribute("aria-expanded", "true");
  const statusMenu = screen.getByRole("listbox", { name: "Estado" });
  expect(statusFilter).toHaveAttribute("aria-controls", statusMenu.id);
  expect(statusMenu.querySelectorAll('[role="option"]')[0]).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(statusMenu.querySelectorAll('[role="option"]')[0]).toHaveAttribute("tabindex", "-1");
  await user.keyboard("{ArrowDown}");
  const activeOption = statusMenu.querySelector('[role="option"].filter-option-active');
  expect(activeOption).not.toBeNull();
  expect(statusFilter).toHaveAttribute("aria-activedescendant", activeOption?.id);
  await user.keyboard("{ArrowDown}{Enter}");

  expect(screen.queryByRole("listbox", { name: "Estado" })).not.toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Hades" })).toBeInTheDocument();
  expect(screen.queryByRole("article", { name: "Celeste" })).not.toBeInTheDocument();
});

test("closes a custom filter menu with Escape and an outside click", async () => {
  const user = userEvent.setup();
  const api = {
    getLibrary: vi.fn().mockResolvedValue(library),
    syncLibrary: vi.fn(),
    updateGameStatus: vi.fn(),
  };
  render(<DashboardApp api={api} />);
  const accessFilter = await screen.findByRole("combobox", { name: "Acceso" });

  await user.click(accessFilter);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox", { name: "Acceso" })).not.toBeInTheDocument();

  await user.click(accessFilter);
  await user.click(screen.getByRole("heading", { name: "Tu biblioteca de Steam" }));
  expect(screen.queryByRole("listbox", { name: "Acceso" })).not.toBeInTheDocument();
});

test("closes an open custom filter menu when tabbing to the next filter", async () => {
  const user = userEvent.setup();
  const api = {
    getLibrary: vi.fn().mockResolvedValue(library),
    syncLibrary: vi.fn(),
    updateGameStatus: vi.fn(),
  };
  render(<DashboardApp api={api} />);
  const statusFilter = await screen.findByRole("combobox", { name: "Estado" });
  const accessFilter = screen.getByRole("combobox", { name: "Acceso" });

  await user.click(statusFilter);
  expect(screen.getByRole("listbox", { name: "Estado" })).toBeInTheDocument();
  await user.tab();

  expect(screen.queryByRole("listbox", { name: "Estado" })).not.toBeInTheDocument();
  expect(accessFilter).toHaveFocus();
});

test("shows local play-now reasons and saves a selected game's recommendation preferences explicitly", async () => {
  const user = userEvent.setup();
  const api = {
    getLibrary: vi.fn().mockResolvedValue(library),
    syncLibrary: vi.fn(),
    updateGameStatus: vi.fn(),
    getInsights: vi.fn().mockResolvedValue({
      library: { ...library.totals, recentlyPlayedGames: 1 },
      activePlans: [{ id: "weekly-1", cadence: "weekly", itemCount: 1, completedItemCount: 0 }],
      preferences: {
        configuredGames: 1,
        highPriorityGames: 1,
        excludedGames: 0,
        soloGames: 1,
        withFriendsGames: 0,
      },
    }),
    getRecommendations: vi.fn().mockResolvedValue({
      availableMinutes: 45,
      recommendations: [
        {
          appId: 10,
          name: "Celeste",
          durationEstimateMinutes: null,
          estimatedRemainingMinutes: null,
          reasons: ["duration_unknown"],
          explanation: "Duration is unknown.",
        },
      ],
    }),
    getPreference: vi.fn().mockResolvedValue({
      appId: 10,
      priority: "normal",
      excludedFromRecommendations: false,
      playMode: "any",
    }),
    savePreference: vi.fn().mockResolvedValue({
      appId: 10,
      priority: "high",
      excludedFromRecommendations: false,
      playMode: "solo",
    }),
    getPlans: vi.fn().mockResolvedValue([]),
    createPlan: vi.fn(),
    updatePlanItemProgress: vi.fn(),
  };

  render(<DashboardApp api={api as never} />);

  expect(await screen.findByRole("heading", { name: "Qué jugar ahora" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cargar inteligencia" }));
  expect(await screen.findByText("Duración desconocida")).toBeInTheDocument();
  await user.click(screen.getByRole("combobox", { name: "Juego para preferencias" }));
  await user.click(screen.getByRole("option", { name: "Celeste" }));
  await user.click(screen.getByRole("combobox", { name: "Prioridad de recomendación" }));
  await user.click(screen.getByRole("option", { name: "Alta" }));
  await user.click(screen.getByRole("combobox", { name: "Modo de juego" }));
  await user.click(screen.getByRole("option", { name: "Solo" }));
  await user.click(screen.getByRole("button", { name: "Guardar preferencias" }));

  expect(api.savePreference).toHaveBeenCalledWith(10, {
    priority: "high",
    excludedFromRecommendations: false,
    playMode: "solo",
  });
});

test("loads the initial game's persisted preference before allowing a save", async () => {
  const user = userEvent.setup();
  const api = {
    getLibrary: vi.fn().mockResolvedValue(library),
    syncLibrary: vi.fn(),
    updateGameStatus: vi.fn(),
    getInsights: vi.fn().mockResolvedValue({
      library: { ...library.totals, recentlyPlayedGames: 1 },
      activePlans: [],
      preferences: {
        configuredGames: 1,
        highPriorityGames: 1,
        excludedGames: 1,
        soloGames: 0,
        withFriendsGames: 1,
      },
    }),
    getRecommendations: vi.fn().mockResolvedValue({ availableMinutes: 45, recommendations: [] }),
    getPreference: vi.fn().mockResolvedValue({
      appId: 10,
      priority: "high",
      excludedFromRecommendations: true,
      playMode: "with_friends",
    }),
    savePreference: vi.fn().mockResolvedValue({
      appId: 10,
      priority: "high",
      excludedFromRecommendations: true,
      playMode: "with_friends",
    }),
    getPlans: vi.fn().mockResolvedValue([]),
    createPlan: vi.fn(),
    updatePlanItemProgress: vi.fn(),
  };

  render(<DashboardApp api={api as never} />);

  expect(await screen.findByRole("heading", { name: "Qué jugar ahora" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cargar inteligencia" }));
  await waitFor(() => {
    expect(api.getPreference).toHaveBeenCalledWith(10);
    expect(screen.getByRole("combobox", { name: "Prioridad de recomendación" })).toHaveTextContent(
      "Alta",
    );
    expect(screen.getByLabelText("Excluir de recomendaciones")).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Modo de juego" })).toHaveTextContent("Con amigos");
  });

  await user.click(screen.getByRole("button", { name: "Guardar preferencias" }));

  expect(api.getPreference).toHaveBeenCalledWith(10);
  expect(api.savePreference).toHaveBeenCalledWith(10, {
    priority: "high",
    excludedFromRecommendations: true,
    playMode: "with_friends",
  });
});

test("groups play-now controls into a primary recommendation card and compact sidebar cards", async () => {
  const api = {
    getLibrary: vi.fn().mockResolvedValue(library),
    syncLibrary: vi.fn(),
    updateGameStatus: vi.fn(),
    getInsights: vi.fn(),
    getRecommendations: vi.fn(),
    getPreference: vi.fn(),
    savePreference: vi.fn(),
    getPlans: vi.fn(),
    createPlan: vi.fn(),
    updatePlanItemProgress: vi.fn(),
  };

  render(<DashboardApp api={api as never} />);

  const recommendations = await screen.findByRole("heading", { name: "Recomendaciones" });
  const preferences = screen.getByRole("heading", { name: "Preferencias" });
  const plans = screen.getByRole("heading", { name: "Plan de backlog" });

  expect(recommendations.closest("section")).toHaveClass("intelligence-recommendations-card");
  expect(
    screen.getByLabelText("Tiempo de esta sesión").closest(".recommendations-controls"),
  ).toHaveClass("recommendations-controls");
  expect(screen.getByLabelText("Tiempo total disponible en la semana/mes")).toBeInTheDocument();
  expect(preferences.closest("section")).toHaveClass("intelligence-side-card");
  expect(plans.closest("section")).toHaveClass("intelligence-side-card");
  expect(preferences.closest(".intelligence-sidebar")).toContainElement(plans);
});

test("uses accessible custom menus for every intelligence choice and closes them predictably", async () => {
  const user = userEvent.setup();
  const api = {
    getLibrary: vi.fn().mockResolvedValue(library),
    syncLibrary: vi.fn(),
    updateGameStatus: vi.fn(),
    getInsights: vi.fn().mockResolvedValue({
      library: { ...library.totals, recentlyPlayedGames: 1 },
      activePlans: [],
      preferences: {
        configuredGames: 0,
        highPriorityGames: 0,
        excludedGames: 0,
        soloGames: 0,
        withFriendsGames: 0,
      },
    }),
    getRecommendations: vi.fn().mockResolvedValue({ availableMinutes: 45, recommendations: [] }),
    getPreference: vi.fn().mockResolvedValue({
      appId: 20,
      priority: "normal",
      excludedFromRecommendations: false,
      playMode: "any",
    }),
    savePreference: vi.fn(),
    getPlans: vi.fn().mockResolvedValue([
      {
        id: "weekly-1",
        cadence: "weekly",
        availableMinutes: 45,
        targetGameCount: 1,
        items: [{ id: "item-1", appId: 10, name: "Celeste", progress: "not_started" }],
      },
    ]),
    createPlan: vi.fn(),
    updatePlanItemProgress: vi.fn(),
  };

  render(<DashboardApp api={api as never} />);
  await user.click(await screen.findByRole("button", { name: "Cargar inteligencia" }));

  const panel = screen
    .getByRole("heading", { name: "Qué jugar ahora" })
    .closest(".intelligence-panel");
  expect(panel).not.toBeNull();
  expect(panel?.querySelectorAll("select")).toHaveLength(0);
  expect(panel?.querySelectorAll('input[type="number"]')).toHaveLength(3);

  const game = screen.getByRole("combobox", { name: "Juego para preferencias" });
  expect(game).toHaveAttribute("aria-expanded", "false");
  await user.click(game);
  const gameMenu = screen.getByRole("listbox", { name: "Juego para preferencias" });
  expect(game).toHaveAttribute("aria-controls", gameMenu.id);
  await user.keyboard("{End}{Enter}");
  expect(game).toHaveFocus();
  await waitFor(() => expect(api.getPreference).toHaveBeenCalledWith(20));

  const priority = screen.getByRole("combobox", { name: "Prioridad de recomendación" });
  await user.click(priority);
  await user.keyboard("{End} ");
  expect(priority).toHaveTextContent("Alta");

  const playMode = screen.getByRole("combobox", { name: "Modo de juego" });
  await user.click(playMode);
  await user.keyboard("{ArrowDown}");
  expect(playMode).toHaveAttribute("aria-activedescendant", expect.any(String));
  await user.keyboard("{Home}{Enter}");
  expect(playMode).toHaveTextContent("Cualquiera");

  const cadence = screen.getByRole("combobox", { name: "Cadencia" });
  await user.click(cadence);
  expect(screen.getByRole("listbox", { name: "Cadencia" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox", { name: "Cadencia" })).not.toBeInTheDocument();
  await user.click(cadence);
  await user.click(screen.getByRole("heading", { name: "Plan de backlog" }));
  expect(screen.queryByRole("listbox", { name: "Cadencia" })).not.toBeInTheDocument();

  expect(screen.getByRole("combobox", { name: "Modo de juego" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Progreso" })).toBeInTheDocument();
});

test("hides intelligence number steppers without changing numeric input semantics", async () => {
  const styles = await readFile(resolve(process.cwd(), "dashboard-ui/src/styles.css"), "utf8");

  expect(styles).toMatch(
    /\.intelligence-panel input\[type="number"\]::-webkit-(?:inner|outer)-spin-button/s,
  );
  expect(styles).toMatch(/-moz-appearance:\s*textfield/);
});

test("bounds long intelligence custom menus and makes them vertically scrollable", async () => {
  const styles = await readFile(resolve(process.cwd(), "dashboard-ui/src/styles.css"), "utf8");
  const menuStyles = styles.match(/\.intelligence-select-menu\s*\{[^}]*\}/s)?.[0];

  expect(menuStyles).toMatch(/max-height:\s*min\([^;]*100vh/);
  expect(menuStyles).toMatch(/overflow-x:\s*hidden/);
  expect(menuStyles).toMatch(/overflow-y:\s*auto/);
  expect(menuStyles).toMatch(/scrollbar-color:\s*[^;]+/);
  expect(menuStyles).toMatch(/scrollbar-width:\s*thin/);
  expect(styles).toMatch(/\.intelligence-select-menu::-webkit-scrollbar\s*\{/);
  expect(styles).toMatch(/\.intelligence-select-menu::-webkit-scrollbar-thumb\s*\{/);
});

test("allows replacing recommendation minutes after clearing the field and rejects a blank submission", async () => {
  const user = userEvent.setup();
  const api = {
    getLibrary: vi.fn().mockResolvedValue(library),
    syncLibrary: vi.fn(),
    updateGameStatus: vi.fn(),
    getInsights: vi.fn(),
    getRecommendations: vi.fn().mockResolvedValue({ availableMinutes: 30, recommendations: [] }),
    getPreference: vi.fn(),
    savePreference: vi.fn(),
    getPlans: vi.fn(),
    createPlan: vi.fn(),
    updatePlanItemProgress: vi.fn(),
  };

  render(<DashboardApp api={api as never} />);

  const availableMinutes = await screen.findByLabelText("Tiempo de esta sesión");
  await user.clear(availableMinutes);
  expect(availableMinutes).toHaveValue(null);

  await user.click(screen.getByRole("button", { name: "Actualizar recomendaciones" }));
  expect(api.getRecommendations).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Ingresa minutos disponibles válidos.");

  await user.type(availableMinutes, "30");
  expect(availableMinutes).toHaveValue(30);
  await user.click(screen.getByRole("button", { name: "Actualizar recomendaciones" }));
  expect(api.getRecommendations).toHaveBeenCalledWith(30, "solo");
});

test("loads recommendations using the selected session mode", async () => {
  const user = userEvent.setup();
  const api = {
    getLibrary: vi.fn().mockResolvedValue(library),
    syncLibrary: vi.fn(),
    updateGameStatus: vi.fn(),
    getInsights: vi.fn().mockResolvedValue(undefined),
    getRecommendations: vi.fn().mockResolvedValue({
      availableMinutes: 45,
      sessionMode: "with_friends",
      recommendations: [],
    }),
    getPreference: vi.fn().mockResolvedValue({
      appId: 10,
      priority: "normal",
      excludedFromRecommendations: false,
      playMode: "any",
    }),
    savePreference: vi.fn(),
    getPlans: vi.fn().mockResolvedValue([]),
    createPlan: vi.fn(),
    updatePlanItemProgress: vi.fn(),
  };

  render(<DashboardApp api={api as never} />);
  const sessionMode = await screen.findByRole("combobox", { name: "Modo de sesión" });
  await user.click(sessionMode);
  await user.click(screen.getByRole("option", { name: "Con amigos" }));
  await user.click(screen.getByRole("button", { name: "Actualizar recomendaciones" }));

  expect(api.getRecommendations).toHaveBeenCalledWith(45, "with_friends");
});

test("allows replacing backlog target games after clearing the field and rejects a blank submission", async () => {
  const user = userEvent.setup();
  const api = {
    getLibrary: vi.fn().mockResolvedValue(library),
    syncLibrary: vi.fn(),
    updateGameStatus: vi.fn(),
    getInsights: vi.fn(),
    getRecommendations: vi.fn(),
    getPreference: vi.fn(),
    savePreference: vi.fn(),
    getPlans: vi.fn().mockResolvedValue([]),
    createPlan: vi.fn().mockResolvedValue({}),
    updatePlanItemProgress: vi.fn(),
  };

  render(<DashboardApp api={api as never} />);

  const targetGameCount = await screen.findByLabelText("Juegos objetivo");
  await user.clear(targetGameCount);
  expect(targetGameCount).toHaveValue(null);

  await user.click(screen.getByRole("button", { name: "Crear plan" }));
  expect(api.createPlan).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Ingresa una cantidad válida de juegos.");

  await user.type(targetGameCount, "2");
  expect(targetGameCount).toHaveValue(2);
  await user.click(screen.getByRole("button", { name: "Crear plan" }));
  expect(api.createPlan).toHaveBeenCalledWith({
    cadence: "weekly",
    availableMinutes: 45,
    targetGameCount: 2,
  });
});
