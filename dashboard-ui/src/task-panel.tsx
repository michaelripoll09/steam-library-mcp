import type { TaskApi } from "./task-state.js";
import { useTaskState } from "./task-state.js";
import { TasksView } from "./views/tasks-view.js";

export function TaskPanel({ api }: Readonly<{ api: TaskApi }>) {
  const state = useTaskState(api);
  return <TasksView state={state} />;
}
