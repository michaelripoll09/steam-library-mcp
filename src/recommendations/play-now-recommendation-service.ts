import type { GameDurationService } from "../durations/game-duration-service.js";
import type { GameDurationEstimate } from "../domain/game-duration.js";
import type { SteamGame, SteamLibrary } from "../domain/models.js";
import {
  DEFAULT_RECOMMENDATION_PREFERENCE,
  type RecommendationPreference,
  type RecommendationPreferenceRepository,
} from "../domain/recommendation-preferences.js";
import type { TrackerEntry, TrackerRepository } from "../domain/tracker.js";
import { InputError } from "../errors.js";

export type PlayNowSessionMode = "solo" | "with_friends" | "any";

export type PlayNowRecommendationRequest = Readonly<{
  availableMinutes: number;
  maxResults: number;
  sessionMode: PlayNowSessionMode;
}>;

export type PlayNowReason =
  | Readonly<{
      code: "finishable_in_session";
      estimatedRemainingMinutes: number;
      availableMinutes: number;
    }>
  | Readonly<{ code: "duration_unknown" | "priority_high" | "status_playing" | "status_paused" }>;

export type PlayNowRecommendation = Readonly<{
  appId: number;
  name: string;
  durationEstimateMinutes: number | null;
  estimatedRemainingMinutes: number | null;
  reasons: readonly PlayNowReason[];
  explanation: string;
}>;

export type PlayNowExclusion = Readonly<{
  reason:
    "not_playable" | "preference_excluded" | "play_mode_incompatible" | "completed" | "dropped";
  count: number;
}>;

export type PlayNowRecommendationResult = Readonly<{
  request: PlayNowRecommendationRequest;
  recommendations: readonly PlayNowRecommendation[];
  exclusions: readonly PlayNowExclusion[];
}>;

type PlayNowRecommendationServiceDependencies = Readonly<{
  library: Pick<SteamLibraryLookup, "getLibrary">;
  trackerRepository: Pick<TrackerRepository, "list">;
  preferenceRepository: Pick<RecommendationPreferenceRepository, "get">;
  gameDurationService: Pick<GameDurationService, "getEstimate">;
}>;

interface SteamLibraryLookup {
  getLibrary(): Promise<SteamLibrary>;
}

export type PlayNowRecommendationService = Readonly<{
  recommend(request: unknown): Promise<PlayNowRecommendationResult>;
}>;

type ExclusionReason = PlayNowExclusion["reason"];

type Candidate = Readonly<{
  game: SteamGame;
  preference: RecommendationPreference;
  status: TrackerEntry["status"] | undefined;
  durationEstimateMinutes: number | undefined;
  estimatedRemainingMinutes: number | undefined;
}>;

const exclusionReasonOrder: readonly ExclusionReason[] = [
  "not_playable",
  "preference_excluded",
  "play_mode_incompatible",
  "completed",
  "dropped",
];

export function createPlayNowRecommendationService({
  library,
  trackerRepository,
  preferenceRepository,
  gameDurationService,
}: PlayNowRecommendationServiceDependencies): PlayNowRecommendationService {
  return Object.freeze({
    async recommend(request: unknown): Promise<PlayNowRecommendationResult> {
      assertRequest(request);

      const [steamLibrary, trackerEntries] = await Promise.all([
        library.getLibrary(),
        Promise.resolve(trackerRepository.list()),
      ]);
      const statusesByAppId = new Map(trackerEntries.map((entry) => [entry.appId, entry.status]));
      const exclusionCounts = new Map<ExclusionReason, number>();
      const eligible = steamLibrary.games.flatMap((game) => {
        const preference =
          preferenceRepository.get(game.appId) ?? DEFAULT_RECOMMENDATION_PREFERENCE;
        const exclusionReason = getExclusionReason(
          game,
          preference,
          statusesByAppId.get(game.appId),
          request.sessionMode,
        );
        if (exclusionReason !== undefined) {
          exclusionCounts.set(exclusionReason, (exclusionCounts.get(exclusionReason) ?? 0) + 1);
          return [];
        }
        return [{ game, preference, status: statusesByAppId.get(game.appId) }];
      });
      const candidates = await Promise.all(
        eligible.map(async (candidate): Promise<Candidate> => {
          const durationEstimateMinutes = getNormallyMinutes(
            await gameDurationService.getEstimate(candidate.game),
          );
          return {
            ...candidate,
            durationEstimateMinutes,
            estimatedRemainingMinutes: estimateRemainingMinutes(
              candidate.game,
              durationEstimateMinutes,
            ),
          };
        }),
      );
      const recommendations = candidates
        .sort((left, right) => compareCandidates(left, right, request.availableMinutes))
        .slice(0, request.maxResults)
        .map((candidate) => toRecommendation(candidate, request.availableMinutes));

      return Object.freeze({
        request: Object.freeze({
          availableMinutes: request.availableMinutes,
          maxResults: request.maxResults,
          sessionMode: request.sessionMode,
        }),
        recommendations: Object.freeze(recommendations),
        exclusions: Object.freeze(
          exclusionReasonOrder.flatMap((reason) => {
            const count = exclusionCounts.get(reason);
            return count === undefined ? [] : [Object.freeze({ reason, count })];
          }),
        ),
      });
    },
  });
}

function assertRequest(request: unknown): asserts request is PlayNowRecommendationRequest {
  const candidate = request as Partial<PlayNowRecommendationRequest> | null;
  if (
    typeof request !== "object" ||
    request === null ||
    !isPositiveSafeInteger(candidate?.availableMinutes) ||
    !isPositiveSafeInteger(candidate?.maxResults) ||
    !isPlayNowSessionMode(candidate?.sessionMode)
  ) {
    throw new InputError(
      "Available minutes and max results must be positive safe integers and session mode must be valid.",
    );
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPlayNowSessionMode(value: unknown): value is PlayNowSessionMode {
  return value === "solo" || value === "with_friends" || value === "any";
}

function getExclusionReason(
  game: SteamGame,
  preference: RecommendationPreference,
  status: TrackerEntry["status"] | undefined,
  sessionMode: PlayNowSessionMode,
): ExclusionReason | undefined {
  if (game.isPlayable === false) return "not_playable";
  if (preference.excludedFromRecommendations) return "preference_excluded";
  if (!isPlayModeCompatible(preference, sessionMode)) return "play_mode_incompatible";
  if (status === "completed") return "completed";
  if (status === "dropped") return "dropped";
  return undefined;
}

function isPlayModeCompatible(
  preference: RecommendationPreference,
  sessionMode: PlayNowSessionMode,
): boolean {
  if (sessionMode === "any" || preference.playMode === "any") return true;
  return preference.playMode === sessionMode;
}

function getNormallyMinutes(
  estimate: Awaited<ReturnType<GameDurationService["getEstimate"]>>,
): number | undefined {
  return isDurationEstimate(estimate) ? estimate.normally?.minutes : undefined;
}

function isDurationEstimate(
  estimate: Awaited<ReturnType<GameDurationService["getEstimate"]>>,
): estimate is GameDurationEstimate {
  return !("isError" in estimate);
}

function estimateRemainingMinutes(
  game: SteamGame,
  durationEstimateMinutes: number | undefined,
): number | undefined {
  if (durationEstimateMinutes === undefined) return undefined;
  return Math.max(durationEstimateMinutes - game.playtimeMinutes, 0);
}

function compareCandidates(left: Candidate, right: Candidate, availableMinutes: number): number {
  const statusDifference = statusRank(left.status) - statusRank(right.status);
  if (statusDifference !== 0) return statusDifference;

  const priorityDifference = priorityRank(left.preference) - priorityRank(right.preference);
  if (priorityDifference !== 0) return priorityDifference;

  const finishableDifference =
    finishableRank(left, availableMinutes) - finishableRank(right, availableMinutes);
  if (finishableDifference !== 0) return finishableDifference;

  const lastPlayedDifference = (right.game.lastPlayedAt ?? "").localeCompare(
    left.game.lastPlayedAt ?? "",
  );
  if (lastPlayedDifference !== 0) return lastPlayedDifference;

  return left.game.appId - right.game.appId;
}

function statusRank(status: TrackerEntry["status"] | undefined): number {
  if (status === "playing") return 0;
  if (status === "paused") return 1;
  return 2;
}

function priorityRank(preference: RecommendationPreference): number {
  return preference.priority === "high" ? 0 : 1;
}

function finishableRank(candidate: Candidate, availableMinutes: number): number {
  return candidate.estimatedRemainingMinutes !== undefined &&
    candidate.estimatedRemainingMinutes <= availableMinutes
    ? 0
    : 1;
}

function toRecommendation(candidate: Candidate, availableMinutes: number): PlayNowRecommendation {
  const reasons: PlayNowReason[] = [];
  if (candidate.status === "playing") reasons.push(Object.freeze({ code: "status_playing" }));
  if (candidate.status === "paused") reasons.push(Object.freeze({ code: "status_paused" }));
  if (candidate.preference.priority === "high")
    reasons.push(Object.freeze({ code: "priority_high" }));
  if (
    candidate.estimatedRemainingMinutes !== undefined &&
    candidate.estimatedRemainingMinutes <= availableMinutes
  ) {
    reasons.push(
      Object.freeze({
        code: "finishable_in_session",
        estimatedRemainingMinutes: candidate.estimatedRemainingMinutes,
        availableMinutes,
      }),
    );
  }
  if (candidate.estimatedRemainingMinutes === undefined)
    reasons.push(Object.freeze({ code: "duration_unknown" }));

  return Object.freeze({
    appId: candidate.game.appId,
    name: candidate.game.name,
    durationEstimateMinutes: candidate.durationEstimateMinutes ?? null,
    estimatedRemainingMinutes: candidate.estimatedRemainingMinutes ?? null,
    reasons: Object.freeze(reasons),
    explanation: explanationFor(candidate, availableMinutes),
  });
}

function explanationFor(candidate: Candidate, availableMinutes: number): string {
  const explanations: string[] = [];
  if (candidate.status === "playing") explanations.push("Already in progress.");
  if (candidate.status === "paused") explanations.push("Paused and ready to resume.");
  if (candidate.preference.priority === "high") explanations.push("High priority.");
  if (candidate.estimatedRemainingMinutes === undefined) {
    explanations.push("Duration is unknown.");
  } else if (candidate.estimatedRemainingMinutes <= availableMinutes) {
    explanations.push(
      `Can be finished in your ${availableMinutes} minutes (about ${candidate.estimatedRemainingMinutes} minutes remaining).`,
    );
  } else {
    explanations.push(`About ${candidate.estimatedRemainingMinutes} minutes remaining.`);
  }
  return explanations.join(" ");
}
