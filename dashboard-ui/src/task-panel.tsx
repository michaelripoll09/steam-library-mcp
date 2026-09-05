import { useEffect, useRef, useState } from "react";

import type { LocalTask } from "../../src/tasks/task-runner.js";
import type { DashboardApi } from "./api.js";

export function TaskPanel({
  api,
}: Readonly<{
  api: DashboardApi & Required<Pick<DashboardApi, "getTasks" | "getTask" | "cancelTask">>;
}>) {
  const [tasks, setTasks] = useState<readonly LocalTask[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [cancellingTaskId, setCancellingTaskId] = useState<string | undefined>();
  const tasksRef = useRef(tasks);
  const taskRequestVersions = useRef(new Map<string, number>());
  const taskListRequestGeneration = useRef(0);
  const cancellingTaskIds = useRef(new Set<string>());
  tasksRef.current = tasks;

  const nextTaskRequestVersion = (id: string): number => {
    const version = (taskRequestVersions.current.get(id) ?? 0) + 1;
    taskRequestVersions.current.set(id, version);
    return version;
  };

  const applyTaskIfCurrent = (task: LocalTask, version: number) => {
    setTasks((current) => {
      if (taskRequestVersions.current.get(task.id) !== version) return current;
      return current.map((entry) => (entry.id === task.id ? task : entry));
    });
  };

  const loadTasks = async () => {
    const generation = taskListRequestGeneration.current + 1;
    taskListRequestGeneration.current = generation;
    const taskVersions = new Map(
      tasksRef.current.map((task) => [task.id, nextTaskRequestVersion(task.id)]),
    );
    try {
      const result = await api.getTasks();
      if (taskListRequestGeneration.current !== generation) return;
      if (Array.isArray(result)) {
        setTasks((current) =>
          reconcileTaskList(current, result, taskVersions, taskRequestVersions.current),
        );
      }
      setError(undefined);
    } catch (loadError) {
      if (taskListRequestGeneration.current === generation) setError(errorMessage(loadError));
    }
  };

  useEffect(() => {
    void loadTasks();
  }, [api]);

  useEffect(() => {
    if (!tasks.some(isActiveTask)) return;
    const poll = async () => {
      const activeTaskIds = tasksRef.current
        .filter((task) => isActiveTask(task) && !cancellingTaskIds.current.has(task.id))
        .map((task) => task.id);
      if (activeTaskIds.length === 0) return;
      try {
        const updates = await Promise.all(
          activeTaskIds.map((id) => {
            const version = nextTaskRequestVersion(id);
            return api.getTask(id).then((task) => ({ task, version }));
          }),
        );
        for (const update of updates) applyTaskIfCurrent(update.task, update.version);
        setError(undefined);
      } catch (pollError) {
        setError(errorMessage(pollError));
      }
    };
    const interval = window.setInterval(() => void poll(), 2_000);
    return () => window.clearInterval(interval);
  }, [api, tasks]);

  const cancelTask = async (id: string) => {
    setCancellingTaskId(id);
    cancellingTaskIds.current.add(id);
    nextTaskRequestVersion(id);
    try {
      const task = await api.cancelTask(id);
      applyTaskIfCurrent(task, nextTaskRequestVersion(id));
      setError(undefined);
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    } finally {
      cancellingTaskIds.current.delete(id);
      setCancellingTaskId(undefined);
    }
  };

  return (
    <section className="intelligence-panel" aria-labelledby="tasks-heading">
      <div className="library-panel-heading">
        <div>
          <p className="eyebrow">Procesos locales</p>
          <h2 id="tasks-heading">Tareas locales</h2>
        </div>
        <button className="text-button" type="button" onClick={() => void loadTasks()}>
          Actualizar
        </button>
      </div>
      {error !== undefined && <p role="alert">{error}</p>}
      {tasks.length === 0 ? (
        <p>No hay tareas locales.</p>
      ) : (
        <ul className="task-list" aria-live="polite">
          {tasks.map((task) => (
            <li key={task.id}>
              <strong>{formatTaskType(task.type)}</strong>
              <span>{formatTaskState(task.state)}</span>
              <span>{formatTaskProgress(task)}</span>
              {isActiveTask(task) && (
                <button
                  type="button"
                  onClick={() => void cancelTask(task.id)}
                  disabled={cancellingTaskId === task.id}
                >
                  {cancellingTaskId === task.id ? "Cancelando…" : "Cancelar tarea"}
                </button>
              )}
              {task.error !== null && <span role="alert">{task.error.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function reconcileTaskList(
  current: readonly LocalTask[],
  incoming: readonly LocalTask[],
  taskVersions: ReadonlyMap<string, number>,
  currentVersions: ReadonlyMap<string, number>,
): readonly LocalTask[] {
  const currentById = new Map(current.map((task) => [task.id, task]));
  const tasks = incoming.map((task) => {
    const requestVersion = taskVersions.get(task.id);
    return requestVersion !== undefined && currentVersions.get(task.id) !== requestVersion
      ? (currentById.get(task.id) ?? task)
      : task;
  });
  const knownTaskIds = new Set(tasks.map((task) => task.id));
  for (const task of current) {
    const requestVersion = taskVersions.get(task.id);
    if (
      requestVersion !== undefined &&
      currentVersions.get(task.id) !== requestVersion &&
      !knownTaskIds.has(task.id)
    ) {
      tasks.push(task);
    }
  }
  return tasks;
}

function isActiveTask(task: LocalTask): boolean {
  return task.state === "queued" || task.state === "running";
}

function formatTaskType(type: LocalTask["type"]): string {
  return (
    {
      sync_library: "Sincronizando biblioteca",
      enrich_durations: "Actualizando duraciones",
      recalculate_plan: "Recalculando plan",
    }[type] ?? type
  );
}

function formatTaskState(state: LocalTask["state"]): string {
  return (
    {
      queued: "En cola",
      running: "En ejecución",
      completed: "Completada",
      failed: "Fallida",
      cancelled: "Cancelada",
    }[state] ?? state
  );
}

function formatTaskProgress(task: LocalTask): string {
  return task.progress.total === null
    ? `${task.progress.completed} completadas`
    : `${task.progress.completed} de ${task.progress.total}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "Algo salió mal. Inténtalo de nuevo.";
}
