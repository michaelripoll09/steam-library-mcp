// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    },
  ],
  totals: { totalGames: 2, playedGames: 1, unplayedGames: 1, totalPlaytimeMinutes: 125 },
  statusStats: { backlog: 1, playing: 1, completed: 0, dropped: 0, paused: 0 },
};

afterEach(cleanup);

describe("DashboardApp", () => {
  test("uses the official cover URL once and replaces a failed image with a deterministic fallback", () => {
    render(<CoverImage game={library.games[0]} />);

    fireEvent.error(screen.getByRole("img", { name: "Cover art for Celeste" }));

    const fallback = screen.getByRole("img", { name: "Cover art unavailable for Celeste" });
    expect(fallback).toHaveStyle({ backgroundImage: expect.stringContaining("linear-gradient") });
    expect(screen.queryByRole("img", { name: "Cover art for Celeste" })).not.toBeInTheDocument();
  });

  test("loads a cinematic game grid and filters it from the semantic toolbar", async () => {
    const user = userEvent.setup();
    const api = {
      getLibrary: vi.fn().mockResolvedValue(library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
    };

    render(<DashboardApp api={api} />);

    expect(screen.getByRole("status", { name: "Loading library" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Your Steam library" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Cover art for Celeste" })).toHaveAttribute(
      "src",
      "https://cdn.example/celeste.jpg",
    );

    await user.type(screen.getByRole("searchbox", { name: "Search games" }), "hades");

    expect(screen.queryByRole("article", { name: "Celeste" })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Hades" })).toBeInTheDocument();
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
    const gameButton = await screen.findByRole("button", { name: "View Hades details" });
    await user.click(gameButton);

    const dialog = screen.getByRole("dialog", { name: "Hades details" });
    expect(within(dialog).getByText("2h 5m played")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Status"), "completed");

    expect(api.updateGameStatus).toHaveBeenCalledWith(20, "completed");
    expect(await within(dialog).findByText("Status saved.")).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Sync library" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Steam is unavailable.");
    expect(screen.getByRole("article", { name: "Celeste" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry sync" })).toBeInTheDocument();
  });
});
