import type { DashboardPlan, DashboardPlanItemProgress } from "../../../src/dashboard/contracts.js";
import { CustomSelect, type CustomSelectOption } from "../custom-select.js";
import { progressDraftKey, type IntelligenceState } from "../intelligence-state.js";
import { ProgressBar } from "../components/progress-bar.js";

const CADENCE_OPTIONS = [
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensual" },
] as const satisfies readonly CustomSelectOption<"weekly" | "monthly">[];

const PROGRESS_OPTIONS = [
  { value: "not_started", label: "Sin iniciar" },
  { value: "in_progress", label: "En progreso" },
  { value: "done", label: "Hecho" },
  { value: "skipped", label: "Omitido" },
] as const satisfies readonly CustomSelectOption<DashboardPlanItemProgress>[];

export function BacklogView({ state }: Readonly<{ state: IntelligenceState }>) {
  return (
    <section className="backlog-view intelligence-panel" aria-labelledby="backlog-view-heading">
      <div className="dashboard-view-heading">
        <div>
          <p className="eyebrow">Planificación</p>
          <h2 id="backlog-view-heading">Backlog</h2>
        </div>
      </div>
      {state.error !== undefined && <p role="alert">{state.error}</p>}
      {state.message !== undefined && <p aria-live="polite">{state.message}</p>}
      <section className="intelligence-side-card backlog-planner" aria-labelledby="plans-heading">
        <h3 id="plans-heading">Plan de backlog</h3>
        <CustomSelect
          label="Cadencia"
          value={state.cadence}
          options={CADENCE_OPTIONS}
          onChange={state.setCadence}
        />
        <label>
          Tiempo total disponible en la semana/mes
          <input
            type="number"
            min="1"
            value={state.planAvailableMinutes}
            onChange={(event) => state.setPlanAvailableMinutes(event.target.value)}
          />
        </label>
        <label>
          Juegos objetivo
          <input
            type="number"
            min="1"
            value={state.targetGameCount}
            onChange={(event) => state.setTargetGameCount(event.target.value)}
          />
        </label>
        <button
          className="intelligence-button"
          type="button"
          onClick={() => void state.createPlan()}
        >
          Crear plan
        </button>
      </section>
      <div className="backlog-plan-list">
        {state.plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            progressDrafts={state.progressDrafts}
            onProgressDraft={state.setProgressDraft}
            onProgress={state.updateProgress}
          />
        ))}
      </div>
    </section>
  );
}

function PlanCard({
  plan,
  progressDrafts,
  onProgressDraft,
  onProgress,
}: Readonly<{
  plan: DashboardPlan;
  progressDrafts: ReadonlyMap<string, DashboardPlanItemProgress>;
  onProgressDraft: (planId: string, itemId: string, progress: DashboardPlanItemProgress) => void;
  onProgress: (
    planId: string,
    itemId: string,
    progress: DashboardPlanItemProgress,
  ) => Promise<void>;
}>) {
  const completed = plan.items.filter((item) => item.progress === "done").length;
  return (
    <article className="backlog-plan">
      <div>
        <h3>Plan {plan.cadence === "weekly" ? "semanal" : "mensual"}</h3>
        <p>
          {plan.availableMinutes} min disponibles · {plan.targetGameCount} juegos objetivo
        </p>
      </div>
      <ProgressBar value={completed} max={plan.items.length} label="Progreso del plan" />
      <ul>
        {plan.items.map((item) => (
          <PlanItem
            key={item.id}
            item={item}
            progress={progressDrafts.get(progressDraftKey(plan.id, item.id)) ?? item.progress}
            onProgressDraft={(progress) => onProgressDraft(plan.id, item.id, progress)}
            onProgress={(progress) => onProgress(plan.id, item.id, progress)}
          />
        ))}
      </ul>
    </article>
  );
}

function PlanItem({
  item,
  progress,
  onProgressDraft,
  onProgress,
}: Readonly<{
  item: DashboardPlan["items"][number];
  progress: DashboardPlanItemProgress;
  onProgressDraft: (progress: DashboardPlanItemProgress) => void;
  onProgress: (progress: DashboardPlanItemProgress) => Promise<void>;
}>) {
  return (
    <li>
      <strong>{item.name}</strong>
      <p>{item.explanation}</p>
      <CustomSelect
        label="Progreso"
        value={progress}
        options={PROGRESS_OPTIONS}
        onChange={onProgressDraft}
      />
      <button type="button" onClick={() => void onProgress(progress)}>
        Actualizar progreso
      </button>
    </li>
  );
}
