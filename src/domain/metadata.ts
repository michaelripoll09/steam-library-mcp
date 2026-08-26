import type { IgdbGame } from "../igdb/schemas.js";

export type MetadataStatus = "complete" | "partial" | "missing";
export type GameMetadata = Readonly<{
  appId: number;
  name: string;
  genres: readonly string[];
  tags: readonly string[];
  themes: readonly string[];
  releaseDate: string | null;
  metadataStatus: MetadataStatus;
  missingReason: "not_found" | null;
  cacheState: "live" | "fresh" | "stale" | "none";
}>;
export type MetadataQuery = Readonly<{
  genres?: readonly string[];
  tags?: readonly string[];
  themes?: readonly string[];
  releaseYearFrom?: number;
  releaseYearTo?: number;
  limit?: number;
}>;

const names = (items: readonly { name: string }[] | undefined): readonly string[] => {
  const unique = new Map<string, string>();
  for (const { name } of items ?? [])
    unique.set(
      name.trim().toLocaleLowerCase(),
      unique.get(name.trim().toLocaleLowerCase()) ?? name.trim(),
    );
  return [...unique.values()].sort((a, b) => a.localeCompare(b));
};

export function selectSteamMatch(games: readonly IgdbGame[], appId: number): IgdbGame | undefined {
  return games
    .filter((game) =>
      game.external_games.some(
        (external) =>
          external.uid === String(appId) &&
          (external.category === undefined || external.category === 1),
      ),
    )
    .sort((left, right) => left.id - right.id)[0];
}

export function normalizeMetadata(
  record: IgdbGame | undefined,
  appId: number,
  name: string,
): GameMetadata {
  if (record === undefined)
    return Object.freeze({
      appId,
      name,
      genres: [],
      tags: [],
      themes: [],
      releaseDate: null,
      metadataStatus: "missing",
      missingReason: "not_found",
      cacheState: "none",
    });
  const genres = names(record.genres);
  const tags = names(record.keywords);
  const themes = names(record.themes);
  const releaseDate =
    record.first_release_date === undefined
      ? null
      : new Date(record.first_release_date * 1000).toISOString().slice(0, 10);
  return Object.freeze({
    appId,
    name,
    genres,
    tags,
    themes,
    releaseDate,
    metadataStatus:
      genres.length && tags.length && themes.length && releaseDate !== null
        ? "complete"
        : "partial",
    missingReason: null,
    cacheState: "live",
  });
}

const includesAny = (values: readonly string[], filters: readonly string[] | undefined): boolean =>
  filters === undefined ||
  filters.length === 0 ||
  filters.some((filter) =>
    values.some((value) => value.toLocaleLowerCase() === filter.trim().toLocaleLowerCase()),
  );
export function filterMetadata(
  items: readonly GameMetadata[],
  query: MetadataQuery,
): readonly GameMetadata[] {
  return items
    .filter(
      (item) =>
        includesAny(item.genres, query.genres) &&
        includesAny(item.tags, query.tags) &&
        includesAny(item.themes, query.themes) &&
        (query.releaseYearFrom === undefined ||
          (item.releaseDate !== null &&
            Number(item.releaseDate.slice(0, 4)) >= query.releaseYearFrom)) &&
        (query.releaseYearTo === undefined ||
          (item.releaseDate !== null &&
            Number(item.releaseDate.slice(0, 4)) <= query.releaseYearTo)),
    )
    .sort((a, b) => a.appId - b.appId);
}
