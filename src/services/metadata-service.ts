import type { Clock } from "../cache/ttl-cache.js";
import {
  filterMetadata,
  normalizeMetadata,
  selectSteamMatch,
  type GameMetadata,
  type MetadataQuery,
} from "../domain/metadata.js";
import type { MetadataUnavailableEnvelope } from "../errors.js";
import type { IgdbGamesClient } from "../igdb/client.js";
import type { SteamService } from "./steam-service.js";

const POSITIVE_TTL = 86_400_000;
const NEGATIVE_TTL = 3_600_000;
const STALE_TTL = 604_800_000;
const CONCURRENCY = 4;
type Entry = Readonly<{ value: GameMetadata; createdAt: number; ttl: number }>;
type Dependencies = Readonly<{
  steamService: SteamService;
  igdbClient: IgdbGamesClient;
  clock: Clock;
}>;
export type MetadataService = Readonly<{
  getOwnedGameMetadata(appId: number): Promise<GameMetadata | MetadataUnavailableEnvelope>;
  queryOwnedMetadata(query: MetadataQuery): Promise<readonly GameMetadata[]>;
}>;
const unavailable = (value: unknown): value is MetadataUnavailableEnvelope =>
  typeof value === "object" &&
  value !== null &&
  "isError" in value &&
  (value as { isError: boolean }).isError;

export function createMetadataService({
  steamService,
  igdbClient,
  clock,
}: Dependencies): MetadataService {
  const cache = new Map<number, Entry>();
  async function getOwnedGameMetadata(
    appId: number,
  ): Promise<GameMetadata | MetadataUnavailableEnvelope> {
    const now = clock.now();
    const cached = cache.get(appId);
    if (cached !== undefined && now - cached.createdAt < cached.ttl)
      return { ...cached.value, cacheState: "fresh" };
    let owned;
    try {
      owned = await steamService.getGame(appId);
    } catch {
      return normalizeMetadata(undefined, appId, "Unknown game");
    }
    const upstream = await igdbClient.findGamesForSteamApp(appId);
    if (unavailable(upstream))
      return cached !== undefined &&
        cached.value.metadataStatus !== "missing" &&
        now - cached.createdAt < STALE_TTL
        ? { ...cached.value, cacheState: "stale" }
        : upstream;
    const value = normalizeMetadata(selectSteamMatch(upstream, appId), appId, owned.name);
    cache.set(appId, {
      value,
      createdAt: now,
      ttl: value.metadataStatus === "missing" ? NEGATIVE_TTL : POSITIVE_TTL,
    });
    return value;
  }
  async function queryOwnedMetadata(query: MetadataQuery): Promise<readonly GameMetadata[]> {
    const { games } = await steamService.getLibrary();
    const result: GameMetadata[] = [];
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, games.length) }, async () => {
        while (index < games.length) {
          const game = games[index++];
          if (game === undefined) return;
          const metadata = await getOwnedGameMetadata(game.appId);
          if (!unavailable(metadata)) result.push(metadata);
        }
      }),
    );
    return filterMetadata(result, query).slice(0, query.limit ?? 50);
  }
  return Object.freeze({ getOwnedGameMetadata, queryOwnedMetadata });
}
