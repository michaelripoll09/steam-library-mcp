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
type Metadata = Readonly<{
  version: 3;
  contentType: string;
  orientation: ArtworkOrientation;
  source: ArtworkSource;
}>;
type ArtworkSource = "steam" | "steamgriddb" | "igdb";
type ArtworkCandidate = Readonly<{
  url: URL;
  orientation: ArtworkOrientation;
  source: ArtworkSource;
}>;
type IgdbCover = Readonly<{ name: string; url: URL; exactTitle: boolean }>;

const CACHE_VERSION = 3;
const allowedSteamHosts = new Set([
  "shared.akamai.steamstatic.com",
  "cdn.cloudflare.steamstatic.com",
]);
const MAX_ARTWORK_BYTES = 10 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 128;
const allowedIgdbImageHosts = new Set(["images.igdb.com"]);
const IGDB_GAMES_URL = "https://api.igdb.com/v4/games";

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
      await igdbArtwork(fetch, igdbCredentials, igdbTokenProvider, title),
    );
    if (igdb !== undefined) return igdb;

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
    if (!isReadableMetadata(metadata) || metadata.orientation !== "portrait") return undefined;
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

async function igdbArtwork(
  fetch: FetchLike,
  credentials: IgdbCredentials | undefined,
  tokenProvider: IgdbTokenProvider | undefined,
  title: string | undefined,
): Promise<readonly ArtworkCandidate[]> {
  const cleanTitle = title?.trim();
  if (
    credentials === undefined ||
    tokenProvider === undefined ||
    cleanTitle === undefined ||
    cleanTitle === ""
  ) {
    return [];
  }
  try {
    const accessToken = await tokenProvider.getAccessToken();
    const response = await fetch(IGDB_GAMES_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        "Client-ID": credentials.clientId,
        Authorization: `Bearer ${accessToken}`,
      },
      body: `search ${JSON.stringify(cleanTitle)}; fields name,cover.url; limit 10;`,
    });
    if (!response.ok) return [];
    return parseIgdbCovers(await response.json(), cleanTitle).map(({ url }) => ({
      url,
      orientation: "portrait" as const,
      source: "igdb" as const,
    }));
  } catch {
    return [];
  }
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
    return exactTitle || normalizedName.includes(normalizedTitle)
      ? [{ name, url, exactTitle }]
      : [];
  });
  return covers.sort(
    (left, right) =>
      Number(right.exactTitle) - Number(left.exactTitle) ||
      left.name.localeCompare(right.name, "es"),
  );
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

function isReadableMetadata(metadata: unknown): metadata is Metadata | LegacyMetadata {
  if (metadata === null || typeof metadata !== "object") return false;
  const candidate = metadata as Readonly<{
    version?: unknown;
    contentType?: unknown;
    orientation?: unknown;
    source?: unknown;
  }>;
  const isCommonShape =
    typeof candidate.contentType === "string" &&
    ["image/jpeg", "image/png", "image/webp"].includes(candidate.contentType) &&
    (candidate.orientation === "portrait" || candidate.orientation === "landscape");
  if (!isCommonShape) return false;
  if (candidate.version === CACHE_VERSION) {
    return (
      candidate.source === "steam" ||
      candidate.source === "steamgriddb" ||
      candidate.source === "igdb"
    );
  }
  return candidate.version === 2 && candidate.orientation === "portrait";
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
