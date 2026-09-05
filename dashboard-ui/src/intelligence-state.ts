import { useEffect, useRef, useState } from "react";

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

export type IntelligenceApi = Pick<
  DashboardApi,
  | "getInsights"
  | "getRecommendations"
  | "getPreference"
  | "savePreference"
  | "getPlans"
  | "createPlan"
  | "updatePlanItemProgress"
>;

export type IntelligenceState = Readonly<{
  availableMinutes: string;
  sessionMode: DashboardSessionMode;
  recommendations: DashboardRecommendations | undefined;
  selectedAppId: number | undefined;
  preference: Omit<DashboardRecommendationPreference, "appId">;
  planAvailableMinutes: string;
  cadence: "weekly" | "monthly";
  targetGameCount: string;
  plans: readonly DashboardPlan[];
  progressDrafts: ReadonlyMap<string, DashboardPlanItemProgress>;
  message: string | undefined;
  error: string | undefined;
  snapshot: DashboardInsightSnapshot | undefined;
  isPreferenceLoading: boolean;
  preferenceLoadedFor: number | undefined;
  setAvailableMinutes: (value: string) => void;
  setSessionMode: (value: DashboardSessionMode) => void;
  setPreference: (value: Omit<DashboardRecommendationPreference, "appId">) => void;
  setPlanAvailableMinutes: (value: string) => void;
  setCadence: (value: "weekly" | "monthly") => void;
  setTargetGameCount: (value: string) => void;
  setProgressDraft: (planId: string, itemId: string, progress: DashboardPlanItemProgress) => void;
  selectGame: (appId: number) => void;
  loadIntelligence: () => Promise<void>;
  refreshPlans: () => Promise<void>;
  refreshRecommendations: () => Promise<void>;
  createPlan: () => Promise<void>;
  updateProgress: (
    planId: string,
    itemId: string,
    progress: DashboardPlanItemProgress,
  ) => Promise<void>;
  savePreference: () => Promise<void>;
}>;

const DEFAULT_PREFERENCE: Omit<DashboardRecommendationPreference, "appId"> = {
  priority: "normal",
  excludedFromRecommendations: false,
  playMode: "any",
};

export function useIntelligenceState({
  api,
  games,
}: Readonly<{
  api: IntelligenceApi;
  games: readonly DashboardGame[];
}>): IntelligenceState {
  const [availableMinutes, setAvailableMinutes] = useState("45");
  const [planAvailableMinutes, setPlanAvailableMinutes] = useState("45");
  const [sessionMode, setSessionMode] = useState<DashboardSessionMode>("solo");
  const [snapshot, setSnapshot] = useState<DashboardInsightSnapshot>();
  const [recommendations, setRecommendations] = useState<DashboardRecommendations>();
  const [plans, setPlans] = useState<readonly DashboardPlan[]>([]);
  const [progressDrafts, setProgressDrafts] = useState<
    ReadonlyMap<string, DashboardPlanItemProgress>
  >(() => new Map());
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

  useEffect(() => {
    setSelectedAppId((current) => current ?? games[0]?.appId);
  }, [games]);

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

  const refreshPlans = async () => {
    try {
      setError(undefined);
      const nextPlans = await api.getPlans();
      setPlans(Array.isArray(nextPlans) ? nextPlans : []);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const selectGame = (appId: number) => {
    setSelectedAppId(appId);
    void loadPreference(appId);
  };

  const loadIntelligence = async () => {
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
      setProgressDrafts((current) => {
        const key = progressDraftKey(planId, itemId);
        if (!current.has(key)) return current;
        const next = new Map(current);
        next.delete(key);
        return next;
      });
      setPlans(await api.getPlans());
      setMessage("Progreso actualizado.");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const setProgressDraft = (
    planId: string,
    itemId: string,
    progress: DashboardPlanItemProgress,
  ) => {
    setProgressDrafts((current) => {
      const key = progressDraftKey(planId, itemId);
      if (current.get(key) === progress) return current;
      return new Map(current).set(key, progress);
    });
  };

  return {
    availableMinutes,
    sessionMode,
    recommendations,
    selectedAppId,
    preference,
    planAvailableMinutes,
    cadence,
    targetGameCount,
    plans,
    progressDrafts,
    message,
    error,
    snapshot,
    isPreferenceLoading,
    preferenceLoadedFor,
    setAvailableMinutes,
    setSessionMode,
    setPreference,
    setPlanAvailableMinutes,
    setCadence,
    setTargetGameCount,
    setProgressDraft,
    selectGame,
    loadIntelligence,
    refreshPlans,
    refreshRecommendations,
    createPlan,
    updateProgress,
    savePreference,
  };
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

export function progressDraftKey(planId: string, itemId: string): string {
  return JSON.stringify([planId, itemId]);
}
