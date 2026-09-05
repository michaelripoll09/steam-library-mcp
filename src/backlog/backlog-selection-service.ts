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

export type BacklogSelectionRequest = Readonly<{
  availableMinutes: number;
  targetGameCount: number;
}>;

export type BacklogSelection = Readonly<{
  appId: number;
  name: string;
  durationEstimateMinutes: number;
  estimatedRemainingMinutes: number;
  explanation: string;
}>;

export type BacklogSelectionResult = Readonly<{
  selections: readonly BacklogSelection[];
  allocatedMinutes: number;
  unallocatedMinutes: number;
  exclusions: readonly Readonly<{
    reason:
      | "not_playable"
      | "preference_excluded"
      | "completed"
      | "dropped"
      | "duration_unknown"
      | "over_budget";
    count: number;
  }>[];
}>;

type BacklogSelectionDependencies = Readonly<{
  library: Pick<SteamLibraryLookup, "getLibrary">;
  trackerRepository: Pick<TrackerRepository, "list">;
  preferenceRepository: Pick<RecommendationPreferenceRepository, "get">;
  gameDurationService: Pick<GameDurationService, "getEstimate">;
}>;

interface SteamLibraryLookup {
  getLibrary(): Promise<SteamLibrary>;
}

export type BacklogSelectionService = Readonly<{
  select(request: unknown): Promise<BacklogSelectionResult>;
}>;

type ExclusionReason = BacklogSelectionResult["exclusions"][number]["reason"];

type Candidate = Readonly<{
  game: SteamGame;
  preference: RecommendationPreference;
  status: TrackerEntry["status"] | undefined;
  durationEstimateMinutes: number;
  estimatedRemainingMinutes: number;
}>;

const exclusionReasonOrder: readonly ExclusionReason[] = [
  "not_playable",
  "preference_excluded",
  "completed",
  "dropped",
  "duration_unknown",
  "over_budget",
];

export function createBacklogSelectionService({
  library,
  trackerRepository,
  preferenceRepository,
  gameDurationService,
}: BacklogSelectionDependencies): BacklogSelectionService {
  return Object.freeze({
    async select(request: unknown): Promise<BacklogSelectionResult> {
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
        const exclusionReason = getInitialExclusionReason(
          game,
          preference,
          statusesByAppId.get(game.appId),
        );
        if (exclusionReason !== undefined) {
          incrementExclusion(exclusionCounts, exclusionReason);
          return [];
        }
        return [{ game, preference, status: statusesByAppId.get(game.appId) }];
      });
      const candidates = await Promise.all(
        eligible.map(async (candidate): Promise<Candidate | undefined> => {
          const durationEstimateMinutes = getNormallyMinutes(
            await gameDurationService.getEstimate(candidate.game),
          );
          if (durationEstimateMinutes === undefined) {
            incrementExclusion(exclusionCounts, "duration_unknown");
            return undefined;
          }
          return {
            ...candidate,
            durationEstimateMinutes,
            estimatedRemainingMinutes: Math.max(
              durationEstimateMinutes - candidate.game.playtimeMinutes,
              0,
            ),
          };
        }),
      );

      let remainingBudget = request.availableMinutes;
      const selections: BacklogSelection[] = [];
      for (const candidate of candidates.filter(isCandidate).sort(compareCandidates)) {
        if (selections.length >= request.targetGameCount) break;
        if (candidate.estimatedRemainingMinutes > remainingBudget) {
          incrementExclusion(exclusionCounts, "over_budget");
          continue;
        }
        selections.push(toSelection(candidate));
        remainingBudget -= candidate.estimatedRemainingMinutes;
      }

      return Object.freeze({
        selections: Object.freeze(selections),
        allocatedMinutes: request.availableMinutes - remainingBudget,
        unallocatedMinutes: remainingBudget,
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

function assertRequest(request: unknown): asserts request is BacklogSelectionRequest {
  const candidate = request as Partial<BacklogSelectionRequest> | null;
  if (
    typeof request !== "object" ||
    request === null ||
    !isPositiveSafeInteger(candidate?.availableMinutes) ||
    !isPositiveSafeInteger(candidate?.targetGameCount)
  ) {
    throw new InputError("Available minutes and target game count must be positive safe integers.");
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function getInitialExclusionReason(
  game: SteamGame,
  preference: RecommendationPreference,
  status: TrackerEntry["status"] | undefined,
): ExclusionReason | undefined {
  if (game.isPlayable === false) return "not_playable";
  if (preference.excludedFromRecommendations) return "preference_excluded";
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

function isCandidate(candidate: Candidate | undefined): candidate is Candidate {
  return candidate !== undefined;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  const priorityDifference = priorityRank(left.preference) - priorityRank(right.preference);
  if (priorityDifference !== 0) return priorityDifference;

  const statusDifference = statusRank(left.status) - statusRank(right.status);
  if (statusDifference !== 0) return statusDifference;

  const remainingDifference = left.estimatedRemainingMinutes - right.estimatedRemainingMinutes;
  if (remainingDifference !== 0) return remainingDifference;

  return left.game.appId - right.game.appId;
}

function priorityRank(preference: RecommendationPreference): number {
  return preference.priority === "high" ? 0 : 1;
}

function statusRank(status: TrackerEntry["status"] | undefined): number {
  return status === "playing" || status === "paused" ? 0 : 1;
}

function toSelection(candidate: Candidate): BacklogSelection {
  return Object.freeze({
    appId: candidate.game.appId,
    name: candidate.game.name,
    durationEstimateMinutes: candidate.durationEstimateMinutes,
    estimatedRemainingMinutes: candidate.estimatedRemainingMinutes,
    explanation: explanationFor(candidate),
  });
}

function explanationFor(candidate: Candidate): string {
  const explanations: string[] = [];
  if (candidate.preference.priority === "high") explanations.push("High priority.");
  if (candidate.status === "playing") explanations.push("Already in progress.");
  if (candidate.status === "paused") explanations.push("Paused and ready to resume.");
  explanations.push(`About ${candidate.estimatedRemainingMinutes} minutes remaining.`);
  return explanations.join(" ");
}

function incrementExclusion(
  exclusionCounts: Map<ExclusionReason, number>,
  reason: ExclusionReason,
): void {
  exclusionCounts.set(reason, (exclusionCounts.get(reason) ?? 0) + 1);
}
