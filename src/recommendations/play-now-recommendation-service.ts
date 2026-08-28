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

export type PlayNowRecommendationRequest = Readonly<{
  availableMinutes: number;
  maxResults: number;
}>;

export type PlayNowReason =
  | Readonly<{
      code: "duration_within_budget" | "duration_over_budget";
      durationMinutes: number;
      availableMinutes: number;
    }>
  | Readonly<{ code: "duration_unknown" | "priority_high" | "status_ongoing" }>;

export type PlayNowRecommendation = Readonly<{
  appId: number;
  name: string;
  durationEstimateMinutes: number | null;
  reasons: readonly PlayNowReason[];
  explanation: string;
}>;

export type PlayNowExclusion = Readonly<{
  reason: "not_playable" | "preference_excluded" | "with_friends_only" | "completed" | "dropped";
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
}>;

const exclusionReasonOrder: readonly ExclusionReason[] = [
  "not_playable",
  "preference_excluded",
  "with_friends_only",
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
        );
        if (exclusionReason !== undefined) {
          exclusionCounts.set(exclusionReason, (exclusionCounts.get(exclusionReason) ?? 0) + 1);
          return [];
        }
        return [{ game, preference, status: statusesByAppId.get(game.appId) }];
      });
      const candidates = await Promise.all(
        eligible.map(async (candidate): Promise<Candidate> => {
          const estimate = await gameDurationService.getEstimate(candidate.game);
          return {
            ...candidate,
            durationEstimateMinutes: getNormallyMinutes(estimate),
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
    !isPositiveSafeInteger(candidate?.maxResults)
  ) {
    throw new InputError("Available minutes and max results must be positive safe integers.");
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function getExclusionReason(
  game: SteamGame,
  preference: RecommendationPreference,
  status: TrackerEntry["status"] | undefined,
): ExclusionReason | undefined {
  if (game.isPlayable === false) return "not_playable";
  if (preference.excludedFromRecommendations) return "preference_excluded";
  if (preference.playMode === "with_friends") return "with_friends_only";
  if (status === "completed") return "completed";
  if (status === "dropped") return "dropped";
  return undefined;
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

function compareCandidates(left: Candidate, right: Candidate, availableMinutes: number): number {
  const durationFitDifference =
    durationFitRank(left, availableMinutes) - durationFitRank(right, availableMinutes);
  if (durationFitDifference !== 0) return durationFitDifference;

  const priorityDifference = priorityRank(left.preference) - priorityRank(right.preference);
  if (priorityDifference !== 0) return priorityDifference;

  const statusDifference = ongoingStatusRank(left.status) - ongoingStatusRank(right.status);
  if (statusDifference !== 0) return statusDifference;

  return left.game.appId - right.game.appId;
}

function durationFitRank(candidate: Candidate, availableMinutes: number): number {
  if (candidate.durationEstimateMinutes === undefined) return 2;
  return candidate.durationEstimateMinutes <= availableMinutes ? 0 : 1;
}

function priorityRank(preference: RecommendationPreference): number {
  return preference.priority === "high" ? 0 : 1;
}

function ongoingStatusRank(status: TrackerEntry["status"] | undefined): number {
  return status === "playing" || status === "paused" ? 0 : 1;
}

function toRecommendation(candidate: Candidate, availableMinutes: number): PlayNowRecommendation {
  const durationReason = toDurationReason(candidate.durationEstimateMinutes, availableMinutes);
  const reasons: PlayNowReason[] = [durationReason];
  if (candidate.preference.priority === "high")
    reasons.push(Object.freeze({ code: "priority_high" }));
  if (ongoingStatusRank(candidate.status) === 0)
    reasons.push(Object.freeze({ code: "status_ongoing" }));

  return Object.freeze({
    appId: candidate.game.appId,
    name: candidate.game.name,
    durationEstimateMinutes: candidate.durationEstimateMinutes ?? null,
    reasons: Object.freeze(reasons),
    explanation: explanationFor(candidate, availableMinutes),
  });
}

function toDurationReason(
  durationMinutes: number | undefined,
  availableMinutes: number,
): PlayNowReason {
  if (durationMinutes === undefined) return Object.freeze({ code: "duration_unknown" });
  return Object.freeze({
    code: durationMinutes <= availableMinutes ? "duration_within_budget" : "duration_over_budget",
    durationMinutes,
    availableMinutes,
  });
}

function explanationFor(candidate: Candidate, availableMinutes: number): string {
  const duration = candidate.durationEstimateMinutes;
  let explanation =
    duration === undefined
      ? `Duration is unknown, so this is a lower-confidence fit for your ${availableMinutes} minutes.`
      : duration <= availableMinutes
        ? `Fits your ${availableMinutes} minutes (about ${duration} minutes).`
        : `Needs about ${duration} minutes, which exceeds your ${availableMinutes} minutes.`;
  if (candidate.preference.priority === "high") explanation += " High priority.";
  if (ongoingStatusRank(candidate.status) === 0) explanation += " Already in progress.";
  return explanation;
}
