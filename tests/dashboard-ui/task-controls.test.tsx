// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { DashboardLibrary } from "../../src/dashboard/contracts.js";
import { TaskPanel } from "../../dashboard-ui/src/task-panel.js";

const library: DashboardLibrary = {
  games: [],
  totals: { totalGames: 0, playedGames: 0, unplayedGames: 0, totalPlaytimeMinutes: 0 },
  statusStats: { backlog: 0, playing: 0, completed: 0, dropped: 0, paused: 0 },
};

const task = {
  id: "task-1",
  type: "sync_library" as const,
  state: "running" as const,
  progress: { completed: 1, total: 3 },
  createdAt: "2026-08-29T00:00:00.000Z",
  startedAt: "2026-08-29T00:00:01.000Z",
  completedAt: null,
  error: null,
};

afterEach(cleanup);

describe("dashboard task controls", () => {
  test("lists active local tasks, polls them, and cancels a selected task", async () => {
    const user = userEvent.setup();
    const api = {
      getLibrary: vi.fn(async () => library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
      getTasks: vi.fn(async () => [task]),
      getTask: vi.fn(async () => task),
      cancelTask: vi.fn(async () => ({ ...task, state: "cancelled" as const })),
    };

    render(<TaskPanel api={api as never} />);

    expect(await screen.findByRole("heading", { name: "Tareas locales" })).toBeInTheDocument();
    expect(screen.getByText("Sincronizando biblioteca")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar tarea" }));

    await waitFor(() => expect(api.cancelTask).toHaveBeenCalledWith("task-1"));
    expect(await screen.findByText("Cancelada")).toBeInTheDocument();
  });

  test("keeps a cancellation result when an earlier poll resolves afterwards", async () => {
    const pendingPoll = deferred<typeof task>();
    const api = {
      getLibrary: vi.fn(async () => library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
      getTasks: vi.fn(async () => [task]),
      getTask: vi.fn(() => pendingPoll.promise),
      cancelTask: vi.fn(async () => ({ ...task, state: "cancelled" as const })),
    };

    render(<TaskPanel api={api as never} />);
    await screen.findByRole("button", { name: "Cancelar tarea" });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_050));
    });
    expect(api.getTask).toHaveBeenCalledWith("task-1");

    fireEvent.click(screen.getByRole("button", { name: "Cancelar tarea" }));
    await waitFor(() => expect(api.cancelTask).toHaveBeenCalledWith("task-1"));
    expect(await screen.findByText("Cancelada")).toBeInTheDocument();

    pendingPoll.resolve(task);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(screen.queryByText("En ejecución")).not.toBeInTheDocument();
  });

  test("keeps a cancellation result when an earlier manual task refresh resolves afterwards", async () => {
    const pendingRefresh = deferred<readonly [typeof task]>();
    const api = {
      getLibrary: vi.fn(async () => library),
      syncLibrary: vi.fn(),
      updateGameStatus: vi.fn(),
      getTasks: vi.fn().mockResolvedValueOnce([task]).mockReturnValueOnce(pendingRefresh.promise),
      getTask: vi.fn(),
      cancelTask: vi.fn(async () => ({ ...task, state: "cancelled" as const })),
    };

    render(<TaskPanel api={api as never} />);
    await screen.findByRole("button", { name: "Cancelar tarea" });

    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(api.getTasks).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar tarea" }));
    expect(await screen.findByText("Cancelada")).toBeInTheDocument();

    pendingRefresh.resolve([task]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(screen.queryByText("En ejecución")).not.toBeInTheDocument();
  });
});

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
}> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
