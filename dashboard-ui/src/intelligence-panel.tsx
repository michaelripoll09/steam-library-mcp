import { useRef, useState } from "react";

import type {
  DashboardGame,
  DashboardInsightSnapshot,
  DashboardPlan,
  DashboardPlanItemProgress,
  DashboardRecommendationPreference,
  DashboardRecommendations,
} from "../../src/dashboard/contracts.js";
import type { DashboardApi } from "./api.js";

const DEFAULT_PREFERENCE: Omit<DashboardRecommendationPreference, "appId"> = {
  priority: "normal",
  excludedFromRecommendations: false,
  playMode: "any",
};

export function IntelligencePanel({
  api,
  games,
}: Readonly<{ api: DashboardApi; games: readonly DashboardGame[] }>) {
  const [availableMinutes, setAvailableMinutes] = useState(45);
  const [snapshot, setSnapshot] = useState<DashboardInsightSnapshot>();
  const [recommendations, setRecommendations] = useState<DashboardRecommendations>();
  const [plans, setPlans] = useState<readonly DashboardPlan[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<number | undefined>(games[0]?.appId);
  const [preference, setPreference] =
    useState<Omit<DashboardRecommendationPreference, "appId">>(DEFAULT_PREFERENCE);
  const [isPreferenceLoading, setIsPreferenceLoading] = useState(false);
  const [preferenceLoadedFor, setPreferenceLoadedFor] = useState<number | undefined>();
  const [cadence, setCadence] = useState<"weekly" | "monthly">("weekly");
  const [targetGameCount, setTargetGameCount] = useState(3);
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
    try {
      const preferencePromise =
        selectedAppId === undefined ? Promise.resolve() : loadPreference(selectedAppId);
      const [nextSnapshot, nextRecommendations, nextPlans] = await Promise.all([
        api.getInsights(),
        api.getRecommendations(availableMinutes),
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
    try {
      setError(undefined);
      const nextRecommendations = await api.getRecommendations(availableMinutes);
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
    try {
      setError(undefined);
      const result = await api.createPlan({ cadence, availableMinutes, targetGameCount });
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
          <h2 id="intelligence-heading">Jugar ahora</h2>
        </div>
      </div>
      <button type="button" onClick={() => void load()}>
        Cargar inteligencia
      </button>
      {snapshot?.library !== undefined && (
        <p className="intelligence-snapshot">
          {snapshot.library.totalGames} juegos · {snapshot.activePlans.length} planes activos ·{" "}
          {snapshot.preferences.highPriorityGames} con prioridad alta
        </p>
      )}
      {error !== undefined && <p role="alert">{error}</p>}
      {message !== undefined && <p aria-live="polite">{message}</p>}

      <div className="intelligence-grid">
        <section aria-labelledby="recommendations-heading">
          <h3 id="recommendations-heading">Recomendaciones</h3>
          <label>
            Minutos disponibles
            <input
              type="number"
              min="1"
              value={availableMinutes}
              onChange={(event) => setAvailableMinutes(Number(event.target.value))}
            />
          </label>
          <button type="button" onClick={() => void refreshRecommendations()}>
            Actualizar recomendaciones
          </button>
          <ul>
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

        <section aria-labelledby="preferences-heading">
          <h3 id="preferences-heading">Preferencias</h3>
          <label>
            Juego para preferencias
            <select
              value={selectedAppId ?? ""}
              onChange={(event) => void selectGame(Number(event.target.value))}
            >
              {games.map((game) => (
                <option key={game.appId} value={game.appId}>
                  {game.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prioridad de recomendación
            <select
              value={preference.priority}
              onChange={(event) =>
                setPreference({ ...preference, priority: event.target.value as "normal" | "high" })
              }
            >
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
            </select>
          </label>
          <label>
            Modo de juego
            <select
              value={preference.playMode}
              onChange={(event) =>
                setPreference({
                  ...preference,
                  playMode: event.target.value as "any" | "solo" | "with_friends",
                })
              }
            >
              <option value="any">Cualquiera</option>
              <option value="solo">Solo</option>
              <option value="with_friends">Con amigos</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={preference.excludedFromRecommendations}
              onChange={(event) =>
                setPreference({ ...preference, excludedFromRecommendations: event.target.checked })
              }
            />{" "}
            Excluir de recomendaciones
          </label>
          <button
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

        <section aria-labelledby="plans-heading">
          <h3 id="plans-heading">Planes de backlog</h3>
          <label>
            Cadencia
            <select
              value={cadence}
              onChange={(event) => setCadence(event.target.value as "weekly" | "monthly")}
            >
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensual</option>
            </select>
          </label>
          <label>
            Juegos objetivo
            <input
              type="number"
              min="1"
              value={targetGameCount}
              onChange={(event) => setTargetGameCount(Number(event.target.value))}
            />
          </label>
          <button type="button" onClick={() => void createPlan()}>
            Crear plan
          </button>
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} onProgress={updateProgress} />
          ))}
        </section>
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
      <label>
        Progreso
        <select
          value={progress}
          onChange={(event) => setProgress(event.target.value as DashboardPlanItemProgress)}
        >
          <option value="not_started">Sin iniciar</option>
          <option value="in_progress">En progreso</option>
          <option value="done">Hecho</option>
          <option value="skipped">Omitido</option>
        </select>
      </label>
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
