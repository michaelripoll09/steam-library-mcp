import type { LocalTask } from "../../../src/tasks/task-runner.js";
import type { TaskState } from "../task-state.js";

export function TasksView({ state }: Readonly<{ state: TaskState }>) {
  return (
    <section className="tasks-view" aria-labelledby="tasks-heading">
      <div className="dashboard-view-heading">
        <div>
          <p className="eyebrow">Procesos locales</p>
          <h2 id="tasks-heading">Tareas locales</h2>
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
            state.error === undefined && <p>No hay tareas locales.</p>
          ) : (
            <ul className="task-list" aria-live="polite">
              {state.tasks.map((task) => (
                <li className="task-activity-row" key={task.id}>
                  <div>
                    <strong>{formatTaskType(task.type)}</strong>
                    <span>{formatTaskState(task.state)}</span>
                  </div>
                  <span>{formatTaskProgress(task)}</span>
                  {isActiveTask(task) && (
                    <button
                      type="button"
                      onClick={() => void state.cancel(task.id)}
                      disabled={state.cancellingTaskId === task.id}
                    >
                      {state.cancellingTaskId === task.id ? "Cancelando…" : "Cancelar tarea"}
                    </button>
                  )}
                  {task.error !== null && <span role="alert">{task.error.message}</span>}
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
