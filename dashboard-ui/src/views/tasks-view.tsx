import { ProgressBar } from "../components/progress-bar.js";
import { presentationError } from "../presentation.js";
import type { LocalTask } from "../../../src/tasks/task-runner.js";
import type { TaskState } from "../task-state.js";

export function TasksView({ state }: Readonly<{ state: TaskState }>) {
  return (
    <section className="tasks-view" aria-labelledby="tasks-heading">
      <div className="dashboard-view-heading">
        <div>
          <h2 id="tasks-heading">Tareas locales</h2>
          <p className="subtitle">Sincronizaciones y procesos en segundo plano.</p>
        </div>
        <button className="text-button" type="button" onClick={() => void state.refresh()}>
          Actualizar
        </button>
      </div>
      {!state.hasLoaded ? (
        <p role="status">Cargando tareas locales…</p>
      ) : (
        <>
          {state.error !== undefined && <p role="alert">{state.error}</p>}
          {state.tasks.length === 0 ? (
            state.error === undefined && (
              <section className="utility-empty">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M8 5H5v16h14V5h-3M9 3h6v4H9zM8 12h8M8 16h5" />
                </svg>
                <h3>No hay tareas activas</h3>
                <p>No hay tareas locales.</p>
                <p>Las sincronizaciones y procesos en segundo plano aparecerán aquí.</p>
              </section>
            )
          ) : (
            <ul className="task-list" aria-live="polite">
              {state.tasks.map((task) => (
                <li className="task-activity-row" key={task.id}>
                  <div>
                    <strong>{formatTaskType(task.type)}</strong>
                    <span>{formatTaskState(task.state)}</span>
                  </div>
                  <span>{formatTaskProgress(task)}</span>
                  {task.progress.total !== null && (
                    <ProgressBar
                      value={task.progress.completed}
                      max={task.progress.total}
                      label="Progreso de la tarea"
                    />
                  )}
                  {isActiveTask(task) && (
                    <button
                      type="button"
                      onClick={() => void state.cancel(task.id)}
                      disabled={state.cancellingTaskId === task.id}
                    >
                      {state.cancellingTaskId === task.id ? "Cancelando…" : "Cancelar tarea"}
                    </button>
                  )}
                  {task.error !== null && (
                    <span role="alert">{presentationError(task.error.message)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
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
