import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { IgdbCredentials } from "../config.js";
import { IgdbTokenProvider } from "../igdb/token-provider.js";
import type { FetchLike } from "../steam/client.js";

export type ArtworkOrientation = "portrait" | "landscape";
export type ArtworkResolver = Readonly<{
  resolve(appId: number, title?: string): Promise<ResolvedArtwork | undefined>;
}>;
export type ResolvedArtwork = Readonly<{
  filePath: string;
  contentType: string;
  orientation: ArtworkOrientation;
}>;
type Dependencies = Readonly<{
  cacheDirectory: string;
  steamGridDbApiKey?: string;
  igdbCredentials?: IgdbCredentials;
  fetch?: FetchLike;
}>;
type LegacyMetadata = Readonly<{
  version: 2;
  contentType: string;
  orientation: ArtworkOrientation;
}>;
type VersionThreeMetadata = Readonly<{
  version: 3;
  contentType: string;
  orientation: ArtworkOrientation;
  source: ArtworkSource;
}>;
type Metadata = Readonly<{
  version: 4;
  contentType: string;
  orientation: ArtworkOrientation;
  source: ArtworkSource;
  identity?: IgdbIdentity;
  providerGameId?: number;
}>;
type ArtworkSource = "steam" | "steamgriddb" | "igdb" | "igdb-curated-override";
type IgdbIdentity = "steam-app" | "title" | "app-id-override";
type ArtworkCandidate = Readonly<{
  url: URL;
  orientation: ArtworkOrientation;
  source: ArtworkSource;
  identity?: IgdbIdentity;
  providerGameId?: number;
}>;
type IgdbCover = Readonly<{ name: string; url: URL; exactTitle: boolean }>;
type CuratedIgdbOverride = Readonly<{
  expectedSteamTitle: string;
  gameId: number;
  expectedIgdbName: string;
}>;

const CACHE_VERSION = 4;
const allowedSteamHosts = new Set([
  "shared.akamai.steamstatic.com",
  "cdn.cloudflare.steamstatic.com",
]);
const MAX_ARTWORK_BYTES = 10 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 128;
const allowedIgdbImageHosts = new Set(["images.igdb.com"]);
const IGDB_GAMES_URL = "https://api.igdb.com/v4/games";
const curatedIgdbOverrides = new Map<number, CuratedIgdbOverride>([
  [
    15100,
    {
      expectedSteamTitle: "Assassin's Creed™: Director's Cut Edition",
      gameId: 27827,
      expectedIgdbName: "Assassin's Creed: Director's Cut Edition",
    },
  ],
  [
    19980,
    {
      expectedSteamTitle: "Prince of Persia®",
      gameId: 2438,
      expectedIgdbName: "Prince of Persia",
    },
  ],
]);

export function createArtworkResolver({
  cacheDirectory,
  steamGridDbApiKey,
  igdbCredentials,
  fetch = globalThis.fetch,
}: Dependencies): ArtworkResolver {
  const igdbTokenProvider =
    igdbCredentials === undefined
      ? undefined
      : new IgdbTokenProvider({ credentials: igdbCredentials, fetch });

  async function resolve(appId: number, title?: string): Promise<ResolvedArtwork | undefined> {
    if (!Number.isSafeInteger(appId) || appId <= 0) return undefined;
    const cached = await readCached(cacheDirectory, appId);
    if (cached !== undefined) return cached;

    const portrait = await cacheFirst(
      fetch,
      cacheDirectory,
      appId,
      directSteamPortraitArtwork(appId),
    );
    if (portrait !== undefined) return portrait;

    const curatedOverride = await cacheFirst(
      fetch,
      cacheDirectory,
      appId,
      await curatedIgdbOverrideArtwork(fetch, igdbCredentials, igdbTokenProvider, appId, title),
    );
    if (curatedOverride !== undefined) return curatedOverride;

    const gridUrls =
      steamGridDbApiKey === undefined
        ? []
        : await steamGridArtwork(fetch, appId, steamGridDbApiKey);
    const grid = await cacheFirst(
      fetch,
      cacheDirectory,
      appId,
      gridUrls.map((url) => ({
        url,
        orientation: "portrait" as const,
        source: "steamgriddb" as const,
      })),
    );
    if (grid !== undefined) return grid;

    const igdb = await cacheFirst(
      fetch,
      cacheDirectory,
      appId,
      await igdbBoundArtwork(fetch, igdbCredentials, igdbTokenProvider, appId),
    );
    if (igdb !== undefined) return igdb;

    const titleMatch = await cacheFirst(
      fetch,
      cacheDirectory,
      appId,
      await igdbTitleArtwork(fetch, igdbCredentials, igdbTokenProvider, title),
    );
    if (titleMatch !== undefined) return titleMatch;

    return cacheFirst(
      fetch,
      cacheDirectory,
      appId,
      await publicSteamLandscapeArtwork(fetch, appId),
    );
  }
  return Object.freeze({ resolve });
}

async function readCached(directory: string, appId: number): Promise<ResolvedArtwork | undefined> {
  const filePath = join(directory, `${appId}.img`);
  try {
    const metadata = JSON.parse(
      await readFile(join(directory, `${appId}.json`), "utf8"),
    ) as unknown;
    if (
      !isReadableMetadata(metadata) ||
      metadata.orientation !== "portrait" ||
      !isTrustedCacheRecord(metadata)
    ) {
      return undefined;
    }
    await access(filePath);
    return { filePath, contentType: metadata.contentType, orientation: metadata.orientation };
  } catch {
    return undefined;
  }
}

function directSteamPortraitArtwork(appId: number): readonly ArtworkCandidate[] {
  return [
    {
      url: new URL(
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
      ),
      orientation: "portrait",
      source: "steam",
    },
  ];
}

async function publicSteamLandscapeArtwork(
  fetch: FetchLike,
  appId: number,
): Promise<readonly ArtworkCandidate[]> {
  const directCandidates: readonly ArtworkCandidate[] = [
    {
      url: new URL(`https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`),
      orientation: "landscape",
      source: "steam",
    },
    {
      url: new URL(
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`,
      ),
      orientation: "landscape",
      source: "steam",
    },
  ];
  try {
    const response = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`,
    );
    const payload = (await response.json()) as Record<
      string,
      { success?: boolean; data?: { header_image?: unknown } }
    >;
    const headerImage =
      payload[String(appId)]?.success === true
        ? allowedUrl(payload[String(appId)]?.data?.header_image, allowedSteamHosts)
        : undefined;
    return headerImage === undefined
      ? directCandidates
      : [{ url: headerImage, orientation: "landscape", source: "steam" }, ...directCandidates];
  } catch {
    return directCandidates;
  }
}

async function steamGridArtwork(
  fetch: FetchLike,
  appId: number,
  key: string,
): Promise<readonly URL[]> {
  try {
    const response = await fetch(
      `https://www.steamgriddb.com/api/v2/grids/steam/${appId}?dimensions=600x900`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
    const payload = (await response.json()) as {
      success?: boolean;
      data?: readonly { url?: unknown }[];
    };
    if (payload.success !== true || payload.data === undefined) return [];
    return payload.data.flatMap((entry) => {
      const url = allowedSteamGridUrl(entry.url);
      return url === undefined ? [] : [url];
    });
  } catch {
    return [];
  }
}

function allowedSteamGridUrl(value: unknown): URL | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const isLegacySteamGridAsset =
      url.hostname === "s3.amazonaws.com" &&
      /^\/steamgriddb\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/.test(url.pathname);
    const isCurrentSteamGridAsset =
      url.hostname === "cdn2.steamgriddb.com" &&
      (/^\/file\/sgdb-cdn\/grid\/[a-zA-Z0-9._-]+$/.test(url.pathname) ||
        /^\/grid\/[a-zA-Z0-9]+$/.test(url.pathname));
    return isStrictHttpsUrl(url) && (isLegacySteamGridAsset || isCurrentSteamGridAsset)
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function allowedUrl(value: unknown, hosts: ReadonlySet<string>): URL | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return isStrictHttpsUrl(url) && hosts.has(url.hostname) ? url : undefined;
  } catch {
    return undefined;
  }
}

async function igdbBoundArtwork(
  fetch: FetchLike,
  credentials: IgdbCredentials | undefined,
  tokenProvider: IgdbTokenProvider | undefined,
  appId: number,
): Promise<readonly ArtworkCandidate[]> {
  const payload = await requestIgdbGames(fetch, credentials, tokenProvider, {
    body: `fields name,cover.url,external_games.category,external_games.uid; where external_games.category = 1 & external_games.uid = "${appId}"; limit 10;`,
  });
  return parseIgdbBoundCovers(payload, appId).map((url) => ({
    url,
    orientation: "portrait" as const,
    source: "igdb" as const,
    identity: "steam-app" as const,
  }));
}

async function curatedIgdbOverrideArtwork(
  fetch: FetchLike,
  credentials: IgdbCredentials | undefined,
  tokenProvider: IgdbTokenProvider | undefined,
  appId: number,
  title: string | undefined,
): Promise<readonly ArtworkCandidate[]> {
  const override = curatedIgdbOverrides.get(appId);
  if (override === undefined || title !== override.expectedSteamTitle) return [];
  const payload = await requestIgdbGames(fetch, credentials, tokenProvider, {
    body: `fields id,name,cover.url; where id = ${override.gameId}; limit 1;`,
  });
  return parseCuratedIgdbOverrideCovers(payload, override).map((url) => ({
    url,
    orientation: "portrait" as const,
    source: "igdb-curated-override" as const,
    identity: "app-id-override" as const,
    providerGameId: override.gameId,
  }));
}

async function igdbTitleArtwork(
  fetch: FetchLike,
  credentials: IgdbCredentials | undefined,
  tokenProvider: IgdbTokenProvider | undefined,
  title: string | undefined,
): Promise<readonly ArtworkCandidate[]> {
  const cleanTitle = title?.trim();
  if (cleanTitle === undefined || cleanTitle === "") return [];
  const payload = await requestIgdbGames(fetch, credentials, tokenProvider, {
    body: `search ${JSON.stringify(cleanTitle)}; fields name,cover.url; limit 10;`,
  });
  return parseIgdbCovers(payload, cleanTitle).map(({ url }) => ({
    url,
    orientation: "portrait" as const,
    source: "igdb" as const,
    identity: "title" as const,
  }));
}

async function requestIgdbGames(
  fetch: FetchLike,
  credentials: IgdbCredentials | undefined,
  tokenProvider: IgdbTokenProvider | undefined,
  request: Readonly<{ body: string }>,
): Promise<unknown | undefined> {
  if (credentials === undefined || tokenProvider === undefined) return undefined;
  try {
    const accessToken = await tokenProvider.getAccessToken();
    const response = await fetch(IGDB_GAMES_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        "Client-ID": credentials.clientId,
        Authorization: `Bearer ${accessToken}`,
      },
      body: request.body,
    });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

function parseIgdbBoundCovers(payload: unknown, appId: number): readonly URL[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((value): readonly URL[] => {
    if (value === null || typeof value !== "object") return [];
    const cover = "cover" in value ? value.cover : undefined;
    const externalGames = "external_games" in value ? value.external_games : undefined;
    const url =
      cover !== null && typeof cover === "object" && "url" in cover
        ? allowedIgdbCoverUrl(cover.url)
        : undefined;
    const matchesSteamApp =
      Array.isArray(externalGames) &&
      externalGames.some(
        (external) =>
          external !== null &&
          typeof external === "object" &&
          "category" in external &&
          "uid" in external &&
          external.category === 1 &&
          external.uid === String(appId),
      );
    return url !== undefined && matchesSteamApp ? [url] : [];
  });
}

function parseCuratedIgdbOverrideCovers(
  payload: unknown,
  override: CuratedIgdbOverride,
): readonly URL[] {
  if (!Array.isArray(payload)) return [];
  const covers = payload.flatMap((value): readonly URL[] => {
    if (value === null || typeof value !== "object") return [];
    const id = "id" in value ? value.id : undefined;
    const name = "name" in value ? value.name : undefined;
    const cover = "cover" in value ? value.cover : undefined;
    const url =
      cover !== null && typeof cover === "object" && "url" in cover
        ? allowedIgdbCoverUrl(cover.url)
        : undefined;
    return id === override.gameId && name === override.expectedIgdbName && url !== undefined
      ? [url]
      : [];
  });
  return covers.length === 1 ? covers : [];
}

function parseIgdbCovers(payload: unknown, title: string): readonly IgdbCover[] {
  if (!Array.isArray(payload)) return [];
  const normalizedTitle = normalizeSpanishTitle(title);
  if (normalizedTitle === "") return [];
  const covers = payload.flatMap((value): readonly IgdbCover[] => {
    if (value === null || typeof value !== "object") return [];
    const name = "name" in value ? value.name : undefined;
    const cover = "cover" in value ? value.cover : undefined;
    const url =
      cover !== null && typeof cover === "object" && "url" in cover
        ? allowedIgdbCoverUrl(cover.url)
        : undefined;
    if (typeof name !== "string" || url === undefined) return [];
    const normalizedName = normalizeSpanishTitle(name);
    const exactTitle = normalizedName === normalizedTitle;
    return exactTitle ? [{ name, url, exactTitle }] : [];
  });
  const sortedCovers = covers.sort(
    (left, right) =>
      Number(right.exactTitle) - Number(left.exactTitle) ||
      left.name.localeCompare(right.name, "es"),
  );
  return sortedCovers.length === 1 ? sortedCovers : [];
}

function normalizeSpanishTitle(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function allowedIgdbCoverUrl(value: unknown): URL | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = value.startsWith("//") ? new URL(`https:${value}`) : new URL(value);
    const path =
      /^\/igdb\/image\/upload\/(?:t_thumb|t_cover_big|t_cover_big_2x)\/([a-zA-Z0-9_-]+\.(?:jpe?g|png|webp))$/.exec(
        url.pathname,
      );
    if (!isStrictHttpsUrl(url) || !allowedIgdbImageHosts.has(url.hostname) || path === null) {
      return undefined;
    }
    return new URL(`https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${path[1]}`);
  } catch {
    return undefined;
  }
}

function isStrictHttpsUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
  );
}

function isReadableMetadata(
  metadata: unknown,
): metadata is Metadata | VersionThreeMetadata | LegacyMetadata {
  if (metadata === null || typeof metadata !== "object") return false;
  const candidate = metadata as Readonly<{
    version?: unknown;
    contentType?: unknown;
    orientation?: unknown;
    source?: unknown;
    identity?: unknown;
    providerGameId?: unknown;
  }>;
  const isCommonShape =
    typeof candidate.contentType === "string" &&
    ["image/jpeg", "image/png", "image/webp"].includes(candidate.contentType) &&
    (candidate.orientation === "portrait" || candidate.orientation === "landscape");
  if (!isCommonShape) return false;
  if (candidate.version === CACHE_VERSION) {
    return isValidMetadataProvenance(
      candidate.source,
      candidate.identity,
      candidate.providerGameId,
    );
  }
  if (candidate.version === 3) {
    return isArtworkSource(candidate.source);
  }
  return candidate.version === 2 && candidate.orientation === "portrait";
}

function isArtworkSource(value: unknown): value is ArtworkSource {
  return (
    value === "steam" ||
    value === "steamgriddb" ||
    value === "igdb" ||
    value === "igdb-curated-override"
  );
}

function isValidMetadataProvenance(
  source: unknown,
  identity: unknown,
  providerGameId: unknown,
): boolean {
  if (!isArtworkSource(source)) return false;
  if (source === "igdb-curated-override") {
    return identity === "app-id-override" && isSafeProviderGameId(providerGameId);
  }
  if (source === "igdb") return identity === "steam-app" || identity === "title";
  return identity === undefined && providerGameId === undefined;
}

function isSafeProviderGameId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isTrustedCacheRecord(metadata: Metadata | VersionThreeMetadata | LegacyMetadata): boolean {
  return (
    (metadata.version !== 3 || metadata.source !== "igdb") &&
    (metadata.version !== CACHE_VERSION ||
      metadata.source !== "igdb" ||
      metadata.identity === "steam-app")
  );
}

async function cacheFirst(
  fetch: FetchLike,
  directory: string,
  appId: number,
  candidates: readonly ArtworkCandidate[],
): Promise<ResolvedArtwork | undefined> {
  for (const candidate of candidates) {
    const resolved = await cacheImage(fetch, directory, appId, candidate);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

async function cacheImage(
  fetch: FetchLike,
  directory: string,
  appId: number,
  candidate: ArtworkCandidate,
): Promise<ResolvedArtwork | undefined> {
  try {
    const response = await fetch(candidate.url, { redirect: "error" });
    const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
    if (!response.ok || !["image/jpeg", "image/png", "image/webp"].includes(contentType))
      return undefined;
    const body = await readImageBody(response);
    if (body === undefined) return undefined;
    await mkdir(directory, { recursive: true });
    await evictCacheEntries(directory);
    const filePath = join(directory, `${appId}.img`);
    await writeFile(filePath, body);
    await writeFile(
      join(directory, `${appId}.json`),
      JSON.stringify({
        version: CACHE_VERSION,
        contentType,
        orientation: candidate.orientation,
        source: candidate.source,
        ...(candidate.identity === undefined ? {} : { identity: candidate.identity }),
        ...(candidate.providerGameId === undefined
          ? {}
          : { providerGameId: candidate.providerGameId }),
      }),
      "utf8",
    );
    return { filePath, contentType, orientation: candidate.orientation };
  } catch {
    return undefined;
  }
}

async function readImageBody(response: Response): Promise<Uint8Array | undefined> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_ARTWORK_BYTES)
  ) {
    return undefined;
  }
  if (response.body === null) return undefined;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ARTWORK_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) return undefined;
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function evictCacheEntries(directory: string): Promise<void> {
  const appIds = (await readdir(directory))
    .map((entry) => /^(\d+)\.img$/.exec(entry)?.[1])
    .filter((appId): appId is string => appId !== undefined)
    .map(Number)
    .filter((appId) => Number.isSafeInteger(appId) && appId > 0)
    .sort((left, right) => left - right);
  const overflow = appIds.length - MAX_CACHE_ENTRIES + 1;
  for (const appId of appIds.slice(0, Math.max(overflow, 0))) {
    await Promise.all([
      rm(join(directory, `${appId}.img`), { force: true }),
      rm(join(directory, `${appId}.json`), { force: true }),
    ]);
  }
}
