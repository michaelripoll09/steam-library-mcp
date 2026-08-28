import {
  DEFAULT_RECOMMENDATION_PREFERENCE,
  PLAY_MODES,
  RECOMMENDATION_PRIORITIES,
  createGameRecommendationPreference,
  type GameRecommendationPreference,
  type PlayMode,
  type RecommendationPreference,
  type RecommendationPreferenceRepository,
  type RecommendationPriority,
} from "../domain/recommendation-preferences.js";
import { InputError, TrackerInputError } from "../errors.js";

const invalidPreferenceMessage = "Recommendation preference values are invalid.";

type RecommendationPreferencesServiceDependencies = Readonly<{
  repository: RecommendationPreferenceRepository;
}>;

export type RecommendationPreferencesService = Readonly<{
  get(appId: unknown): GameRecommendationPreference;
  save(appId: unknown, preference: unknown): GameRecommendationPreference;
}>;

export function createRecommendationPreferencesService({
  repository,
}: RecommendationPreferencesServiceDependencies): RecommendationPreferencesService {
  return Object.freeze({
    get(appId: unknown): GameRecommendationPreference {
      assertAppId(appId);
      return (
        repository.get(appId) ??
        createGameRecommendationPreference({ appId, ...DEFAULT_RECOMMENDATION_PREFERENCE })
      );
    },
    save(appId: unknown, preference: unknown): GameRecommendationPreference {
      assertAppId(appId);
      assertRecommendationPreference(preference);
      const saved = createGameRecommendationPreference({ appId, ...preference });
      if (isDefaultRecommendationPreference(saved)) {
        repository.remove(appId);
      } else {
        repository.save(saved);
      }
      return saved;
    },
  });
}

function assertAppId(appId: unknown): asserts appId is number {
  if (typeof appId !== "number" || !Number.isSafeInteger(appId) || appId <= 0) {
    throw new TrackerInputError();
  }
}

function assertRecommendationPreference(
  preference: unknown,
): asserts preference is RecommendationPreference {
  const candidate = preference as Record<string, unknown> | null;
  if (
    typeof preference !== "object" ||
    preference === null ||
    !isRecommendationPriority(candidate?.priority) ||
    typeof candidate.excludedFromRecommendations !== "boolean" ||
    !isPlayMode(candidate.playMode)
  ) {
    throw new InputError(invalidPreferenceMessage);
  }
}

function isRecommendationPriority(value: unknown): value is RecommendationPriority {
  return (
    typeof value === "string" && RECOMMENDATION_PRIORITIES.includes(value as RecommendationPriority)
  );
}

function isPlayMode(value: unknown): value is PlayMode {
  return typeof value === "string" && PLAY_MODES.includes(value as PlayMode);
}

function isDefaultRecommendationPreference(preference: RecommendationPreference): boolean {
  return (
    preference.priority === DEFAULT_RECOMMENDATION_PREFERENCE.priority &&
    preference.excludedFromRecommendations ===
      DEFAULT_RECOMMENDATION_PREFERENCE.excludedFromRecommendations &&
    preference.playMode === DEFAULT_RECOMMENDATION_PREFERENCE.playMode
  );
}
