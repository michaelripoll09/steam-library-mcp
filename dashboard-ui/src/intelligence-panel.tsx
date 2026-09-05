import { useRef, useState } from "react";

import type {
  DashboardGame,
  DashboardInsightSnapshot,
  DashboardPlan,
  DashboardPlanItemProgress,
  DashboardRecommendationPreference,
  DashboardRecommendations,
  DashboardSessionMode,
} from "../../src/dashboard/contracts.js";
import type { DashboardApi } from "./api.js";
import { CustomSelect, type CustomSelectOption } from "./custom-select.js";

const DEFAULT_PREFERENCE: Omit<DashboardRecommendationPreference, "appId"> = {
  priority: "normal",
  excludedFromRecommendations: false,
  playMode: "any",
};

const PRIORITY_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "Alta" },
] as const satisfies readonly CustomSelectOption<"normal" | "high">[];

const PLAY_MODE_OPTIONS = [
  { value: "any", label: "Cualquiera" },
  { value: "solo", label: "Solo" },
  { value: "with_friends", label: "Con amigos" },
] as const satisfies readonly CustomSelectOption<"any" | "solo" | "with_friends">[];

const SESSION_MODE_OPTIONS = [
  { value: "solo", label: "Solo" },
  { value: "with_friends", label: "Con amigos" },
  { value: "any", label: "Cualquiera" },
] as const satisfies readonly CustomSelectOption<DashboardSessionMode>[];

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

export function IntelligencePanel({
  api,
  games,
}: Readonly<{ api: DashboardApi; games: readonly DashboardGame[] }>) {
  const [availableMinutes, setAvailableMinutes] = useState("45");
  const [planAvailableMinutes, setPlanAvailableMinutes] = useState("45");
  const [sessionMode, setSessionMode] = useState<DashboardSessionMode>("solo");
  const [snapshot, setSnapshot] = useState<DashboardInsightSnapshot>();
  const [recommendations, setRecommendations] = useState<DashboardRecommendations>();
  const [plans, setPlans] = useState<readonly DashboardPlan[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<number | undefined>(games[0]?.appId);
  const [preference, setPreference] =
    useState<Omit<DashboardRecommendationPreference, "appId">>(DEFAULT_PREFERENCE);
  const [isPreferenceLoading, setIsPreferenceLoading] = useState(false);
  const [preferenceLoadedFor, setPreferenceLoadedFor] = useState<number | undefined>();
  const [cadence, setCadence] = useState<"weekly" | "monthly">("weekly");
  const [targetGameCount, setTargetGameCount] = useState("3");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const preferenceRequestRef = useRef(0);

  const loadPreference = async (appId: number): Promise<void> => {
    const requestId = ++preferenceRequestRef.current;
    setIsPreferenceLoading(true);
    setPreferenceLoadedFor(undefined);
    try {
      const nextPreference = await api.getPreference(appId);
      if (requestId !== preferenceRequestRef.current) return;
      setPreference({
        priority: nextPreference.priority,
        excludedFromRecommendations: nextPreference.excludedFromRecommendations,
        playMode: nextPreference.playMode,
      });
      setPreferenceLoadedFor(appId);
    } catch (cause) {
      if (requestId === preferenceRequestRef.current) setError(errorMessage(cause));
    } finally {
      if (requestId === preferenceRequestRef.current) setIsPreferenceLoading(false);
    }
  };

  const load = async () => {
    const validAvailableMinutes = positiveSafeInteger(availableMinutes);
    if (validAvailableMinutes === undefined) {
      setError("Ingresa minutos disponibles válidos.");
      return;
    }

    try {
      const preferencePromise =
        selectedAppId === undefined ? Promise.resolve() : loadPreference(selectedAppId);
      const [nextSnapshot, nextRecommendations, nextPlans] = await Promise.all([
        api.getInsights(),
        api.getRecommendations(validAvailableMinutes, sessionMode),
        api.getPlans(),
      ]);
      await preferencePromise;
      setSnapshot(nextSnapshot?.library === undefined ? undefined : nextSnapshot);
      setRecommendations(
        Array.isArray(nextRecommendations?.recommendations) ? nextRecommendations : undefined,
      );
      setPlans(Array.isArray(nextPlans) ? nextPlans : []);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const selectGame = (appId: number) => {
    setSelectedAppId(appId);
    void loadPreference(appId);
  };

  const refreshRecommendations = async () => {
    const validAvailableMinutes = positiveSafeInteger(availableMinutes);
    if (validAvailableMinutes === undefined) {
      setError("Ingresa minutos disponibles válidos.");
      return;
    }

    try {
      setError(undefined);
      const nextRecommendations = await api.getRecommendations(validAvailableMinutes, sessionMode);
      setRecommendations(
        Array.isArray(nextRecommendations?.recommendations) ? nextRecommendations : undefined,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const savePreference = async () => {
    if (selectedAppId === undefined) return;
    try {
      setError(undefined);
      await api.savePreference(selectedAppId, preference);
      setMessage("Preferencias guardadas.");
      await refreshRecommendations();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const createPlan = async () => {
    const validPlanAvailableMinutes = positiveSafeInteger(planAvailableMinutes);
    if (validPlanAvailableMinutes === undefined) {
      setError("Ingresa minutos disponibles válidos.");
      return;
    }
    const validTargetGameCount = positiveSafeInteger(targetGameCount);
    if (validTargetGameCount === undefined) {
      setError("Ingresa una cantidad válida de juegos.");
      return;
    }

    try {
      setError(undefined);
      const result = await api.createPlan({
        cadence,
        availableMinutes: validPlanAvailableMinutes,
        targetGameCount: validTargetGameCount,
      });
      setPlans(await api.getPlans());
      setMessage(result.shortfall?.message ?? "Plan creado.");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const updateProgress = async (
    planId: string,
    itemId: string,
    progress: DashboardPlanItemProgress,
  ) => {
    try {
      setError(undefined);
      await api.updatePlanItemProgress(planId, itemId, progress);
      setPlans(await api.getPlans());
      setMessage("Progreso actualizado.");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <section className="intelligence-panel" aria-labelledby="intelligence-heading">
      <div className="library-panel-heading">
        <div>
          <p className="eyebrow">Inteligencia local</p>
          <h2 id="intelligence-heading">Qué jugar ahora</h2>
        </div>
        <button className="intelligence-button" type="button" onClick={() => void load()}>
          Cargar inteligencia
        </button>
      </div>
      {snapshot?.library !== undefined && (
        <p className="intelligence-snapshot">
          {snapshot.library.totalGames} juegos · {snapshot.activePlans.length} planes activos ·{" "}
          {snapshot.preferences.highPriorityGames} con prioridad alta
        </p>
      )}
      {error !== undefined && <p role="alert">{error}</p>}
      {message !== undefined && <p aria-live="polite">{message}</p>}

      <div className="intelligence-grid">
        <section
          className="intelligence-recommendations-card"
          aria-labelledby="recommendations-heading"
        >
          <h3 id="recommendations-heading">Recomendaciones</h3>
          <div className="recommendations-controls">
            <label>
              Tiempo de esta sesión
              <input
                type="number"
                min="1"
                value={availableMinutes}
                onChange={(event) => setAvailableMinutes(event.target.value)}
              />
            </label>
            <CustomSelect
              label="Modo de sesión"
              value={sessionMode}
              options={SESSION_MODE_OPTIONS}
              onChange={setSessionMode}
            />
            <button
              className="intelligence-button intelligence-button-primary"
              type="button"
              onClick={() => void refreshRecommendations()}
            >
              Actualizar recomendaciones
            </button>
          </div>
          <ul className="recommendation-list">
            {recommendations?.recommendations?.map((recommendation) => (
              <li key={recommendation.appId}>
                <strong>{recommendation.name}</strong>
                <span>
                  {recommendation.durationEstimateMinutes === null
                    ? "Duración desconocida"
                    : `~${recommendation.durationEstimateMinutes} min`}
                </span>
                <p>{recommendation.explanation}</p>
                <small>{recommendation.reasons.join(", ")}</small>
              </li>
            ))}
          </ul>
        </section>

        <div className="intelligence-sidebar">
          <section className="intelligence-side-card" aria-labelledby="preferences-heading">
            <h3 id="preferences-heading">Preferencias</h3>
            <CustomSelect
              label="Juego para preferencias"
              value={selectedAppId?.toString() ?? ""}
              options={games.map((game) => ({ value: game.appId.toString(), label: game.name }))}
              onChange={(appId) => void selectGame(Number(appId))}
            />
            <CustomSelect
              label="Prioridad de recomendación"
              value={preference.priority}
              options={PRIORITY_OPTIONS}
              onChange={(priority) => setPreference({ ...preference, priority })}
            />
            <CustomSelect
              label="Modo de juego"
              value={preference.playMode}
              options={PLAY_MODE_OPTIONS}
              onChange={(playMode) => setPreference({ ...preference, playMode })}
            />
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={preference.excludedFromRecommendations}
                onChange={(event) =>
                  setPreference({
                    ...preference,
                    excludedFromRecommendations: event.target.checked,
                  })
                }
              />
              Excluir de recomendaciones
            </label>
            <button
              className="intelligence-button intelligence-button-primary"
              type="button"
              onClick={() => void savePreference()}
              disabled={
                selectedAppId === undefined ||
                isPreferenceLoading ||
                preferenceLoadedFor !== selectedAppId
              }
              aria-busy={isPreferenceLoading}
            >
              Guardar preferencias
            </button>
          </section>

          <section className="intelligence-side-card" aria-labelledby="plans-heading">
            <h3 id="plans-heading">Plan de backlog</h3>
            <CustomSelect
              label="Cadencia"
              value={cadence}
              options={CADENCE_OPTIONS}
              onChange={setCadence}
            />
            <label>
              Tiempo total disponible en la semana/mes
              <input
                type="number"
                min="1"
                value={planAvailableMinutes}
                onChange={(event) => setPlanAvailableMinutes(event.target.value)}
              />
            </label>
            <label>
              Juegos objetivo
              <input
                type="number"
                min="1"
                value={targetGameCount}
                onChange={(event) => setTargetGameCount(event.target.value)}
              />
            </label>
            <button className="intelligence-button" type="button" onClick={() => void createPlan()}>
              Crear plan
            </button>
            {plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} onProgress={updateProgress} />
            ))}
          </section>
        </div>
      </div>
    </section>
  );
}

function PlanCard({
  plan,
  onProgress,
}: Readonly<{
  plan: DashboardPlan;
  onProgress: (
    planId: string,
    itemId: string,
    progress: DashboardPlanItemProgress,
  ) => Promise<void>;
}>) {
  return (
    <article className="backlog-plan">
      <h4>Plan {plan.cadence}</h4>
      <ul>
        {plan.items.map((item) => (
          <PlanItem
            key={item.id}
            item={item}
            onProgress={(progress) => onProgress(plan.id, item.id, progress)}
          />
        ))}
      </ul>
    </article>
  );
}

function PlanItem({
  item,
  onProgress,
}: Readonly<{
  item: DashboardPlan["items"][number];
  onProgress: (progress: DashboardPlanItemProgress) => Promise<void>;
}>) {
  const [progress, setProgress] = useState<DashboardPlanItemProgress>(item.progress);
  return (
    <li>
      <strong>{item.name}</strong>
      <CustomSelect
        label="Progreso"
        value={progress}
        options={PROGRESS_OPTIONS}
        onChange={setProgress}
      />
      <button type="button" onClick={() => void onProgress(progress)}>
        Actualizar progreso
      </button>
    </li>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "No se pudo completar la operación.";
}

function positiveSafeInteger(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsedValue = Number(value);
  return Number.isSafeInteger(parsedValue) && parsedValue > 0 ? parsedValue : undefined;
}
