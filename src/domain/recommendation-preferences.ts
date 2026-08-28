export const RECOMMENDATION_PRIORITIES = Object.freeze(["normal", "high"] as const);
export const PLAY_MODES = Object.freeze(["any", "solo", "with_friends"] as const);

export type RecommendationPriority = (typeof RECOMMENDATION_PRIORITIES)[number];
export type PlayMode = (typeof PLAY_MODES)[number];

export interface RecommendationPreference {
  readonly priority: RecommendationPriority;
  readonly excludedFromRecommendations: boolean;
  readonly playMode: PlayMode;
}

export interface GameRecommendationPreference extends RecommendationPreference {
  readonly appId: number;
}

export interface RecommendationPreferenceRepository {
  get(appId: number): GameRecommendationPreference | undefined;
  save(preference: GameRecommendationPreference): void;
  remove(appId: number): void;
}

export const DEFAULT_RECOMMENDATION_PREFERENCE: RecommendationPreference = Object.freeze({
  priority: "normal",
  excludedFromRecommendations: false,
  playMode: "any",
});

type GameRecommendationPreferenceInput = GameRecommendationPreference &
  Readonly<Record<string, unknown>>;

export function createGameRecommendationPreference(
  input: GameRecommendationPreferenceInput,
): GameRecommendationPreference {
  return Object.freeze({
    appId: input.appId,
    priority: input.priority,
    excludedFromRecommendations: input.excludedFromRecommendations,
    playMode: input.playMode,
  });
}
