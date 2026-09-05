import type { Cache } from "../cache/ttl-cache.js";
import type { AppConfig } from "../config.js";
import type { GameAchievementProgress, SteamAchievement } from "../domain/achievements.js";
import { InputError } from "../errors.js";
import type { SteamApiClient } from "../steam/client.js";
import type { SteamService } from "./steam-service.js";

export type AchievementAvailabilityReason = "not_playable" | "not_available";

export type AchievementResult =
  | Readonly<{ status: "available"; progress: GameAchievementProgress }>
  | Readonly<{
      status: "unavailable";
      appId: number;
      name: string;
      reason: AchievementAvailabilityReason;
    }>;

export type AchievementService = Readonly<{
  getGameAchievements(appId: unknown): Promise<AchievementResult>;
}>;

type AchievementServiceDependencies = Readonly<{
  config: Pick<AppConfig, "steamId">;
  steamService: Pick<SteamService, "getGame">;
  steamClient: Pick<SteamApiClient, "getPlayerAchievements" | "getAchievementSchema">;
  cache: Cache<AchievementResult>;
}>;

const achievementCacheTtlMs = 5 * 60 * 1000;

export function createAchievementService({
  config,
  steamService,
  steamClient,
  cache,
}: AchievementServiceDependencies): AchievementService {
  return Object.freeze({
    async getGameAchievements(appId: unknown): Promise<AchievementResult> {
      const normalizedAppId = assertAppId(appId);
      const game = await steamService.getGame(normalizedAppId);
      if (game.isPlayable === false) {
        return unavailable(game.appId, game.name, "not_playable");
      }

      const cacheKey = `achievements:${config.steamId}:${normalizedAppId}`;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) return cached;

      const playerResponse = await steamClient.getPlayerAchievements(
        config.steamId,
        normalizedAppId,
      );
      const playerStats = playerResponse.playerstats;
      if (!playerStats.success || playerStats.achievements.length === 0) {
        const result = unavailable(game.appId, game.name, "not_available");
        cache.set(cacheKey, result, achievementCacheTtlMs);
        return result;
      }

      const schemaResponse = await steamClient.getAchievementSchema(normalizedAppId);
      const schemaAchievements = schemaResponse.game.availableGameStats.achievements;
      if (schemaAchievements.length === 0) {
        const result = unavailable(game.appId, game.name, "not_available");
        cache.set(cacheKey, result, achievementCacheTtlMs);
        return result;
      }

      const playerProgressByApiName = new Map(
        playerStats.achievements.map((achievement) => [achievement.apiname, achievement]),
      );
      const achievements = schemaAchievements.map((achievement): SteamAchievement => {
        const playerProgress = playerProgressByApiName.get(achievement.name);
        const achieved = playerProgress?.achieved === 1;
        const unlocktime = playerProgress?.unlocktime ?? 0;
        const unlockTime =
          achieved && unlocktime > 0 ? new Date(unlocktime * 1000).toISOString() : null;
        return Object.freeze({
          apiName: achievement.name,
          displayName: achievement.displayName ?? achievement.name,
          description: achievement.description ?? null,
          achieved,
          unlockTime,
          iconUrl: achievement.icon ?? null,
          iconGrayUrl: achievement.icongray ?? null,
        });
      });
      const unlockedCount = achievements.filter((achievement) => achievement.achieved).length;
      const totalCount = achievements.length;
      const completionPercent =
        totalCount === 0 ? 0 : Math.round((unlockedCount / totalCount) * 10000) / 100;
      const result: AchievementResult = Object.freeze({
        status: "available" as const,
        progress: Object.freeze({
          appId: game.appId,
          name: game.name,
          unlockedCount,
          totalCount,
          completionPercent,
          achievements: Object.freeze(achievements),
        }),
      });
      cache.set(cacheKey, result, achievementCacheTtlMs);
      return result;
    },
  });
}

function assertAppId(appId: unknown): number {
  if (typeof appId !== "number" || !Number.isSafeInteger(appId) || appId <= 0) {
    throw new InputError("The app ID must be a positive integer.");
  }
  return appId;
}

function unavailable(
  appId: number,
  name: string,
  reason: AchievementAvailabilityReason,
): AchievementResult {
  return Object.freeze({ status: "unavailable", appId, name, reason });
}
