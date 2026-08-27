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

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  test("uses the official cover URL once and replaces a failed image with a deterministic fallback", () => {
    render(<CoverImage game={library.games[0]} />);

    fireEvent.error(screen.getByRole("img", { name: "Portada de Celeste" }));

    const fallback = screen.getByRole("img", { name: "Portada no disponible para Celeste" });
    expect(fallback).toHaveStyle({ backgroundImage: expect.stringContaining("linear-gradient") });
    expect(screen.queryByRole("img", { name: "Portada de Celeste" })).not.toBeInTheDocument();
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
