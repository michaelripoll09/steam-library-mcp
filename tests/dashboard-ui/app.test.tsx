// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { DashboardLibrary } from "../../src/dashboard/contracts.js";
import { CoverImage, DashboardApp } from "../../dashboard-ui/src/app.js";

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
      accessType: "family_shared",
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

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls).toEqual(
      expect.arrayContaining([
        ["/api/library", { method: "GET" }],
        ["/api/tasks", { method: "GET" }],
      ]),
    );
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
  });

  test("opens a keyboard-accessible detail dialog, updates status, and restores focus on Escape", async () => {
    const user = userEvent.setup();
    const updatedLibrary: DashboardLibrary = {
      ...library,
      games: [library.games[0], { ...library.games[1], status: "completed" }],
      statusStats: { ...library.statusStats, playing: 0, completed: 1 },
    };
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn().mockResolvedValue({
        mark: { outcome: "updated", appId: 20, status: "completed" },
        library: updatedLibrary,
      }),
    };

    render(<DashboardApp api={api} />);
    const gameButton = await screen.findByRole("button", { name: "Ver detalles de Hades" });
    await user.click(gameButton);

    const dialog = screen.getByRole("dialog", { name: "Detalles de Hades" });
    expect(within(dialog).getByText("2h 5m jugado")).toBeInTheDocument();
    expect(within(dialog).getByText("Última vez jugado: 26/08/2026")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Estado"), "completed");

    expect(api.updateGameStatus).toHaveBeenCalledWith(20, "completed");
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

    expect(await within(dialog).findByDisplayValue("En pausa")).toBeInTheDocument();
    expect(
      within(screen.getByRole("article", { name: "Hades" })).getByText("En pausa"),
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

  expect(await screen.findByRole("heading", { name: "Jugar ahora" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cargar inteligencia" }));
  expect(await screen.findByText("Duración desconocida")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Juego para preferencias"), "10");
  await user.selectOptions(screen.getByLabelText("Prioridad de recomendación"), "high");
  await user.selectOptions(screen.getByLabelText("Modo de juego"), "solo");
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

  expect(await screen.findByRole("heading", { name: "Jugar ahora" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cargar inteligencia" }));
  await waitFor(() => {
    expect(api.getPreference).toHaveBeenCalledWith(10);
    expect(screen.getByLabelText("Prioridad de recomendación")).toHaveValue("high");
    expect(screen.getByLabelText("Excluir de recomendaciones")).toBeChecked();
    expect(screen.getByLabelText("Modo de juego")).toHaveValue("with_friends");
  });

  await user.click(screen.getByRole("button", { name: "Guardar preferencias" }));

  expect(api.getPreference).toHaveBeenCalledWith(10);
  expect(api.savePreference).toHaveBeenCalledWith(10, {
    priority: "high",
    excludedFromRecommendations: true,
    playMode: "with_friends",
  });
});
