import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FetchLike } from "../steam/client.js";

export type ArtworkOrientation = "portrait" | "landscape";
export type ArtworkResolver = Readonly<{
  resolve(appId: number): Promise<ResolvedArtwork | undefined>;
}>;
export type ResolvedArtwork = Readonly<{
  filePath: string;
  contentType: string;
  orientation: ArtworkOrientation;
}>;
type Dependencies = Readonly<{
  cacheDirectory: string;
  steamGridDbApiKey?: string;
  fetch?: FetchLike;
}>;
type Metadata = Readonly<{
  version: 2;
  contentType: string;
  orientation: ArtworkOrientation;
}>;
type ArtworkCandidate = Readonly<{ url: URL; orientation: ArtworkOrientation }>;

const CACHE_VERSION = 2;
const allowedSteamHosts = new Set([
  "shared.akamai.steamstatic.com",
  "cdn.cloudflare.steamstatic.com",
]);
const MAX_ARTWORK_BYTES = 10 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 128;

export function createArtworkResolver({
  cacheDirectory,
  steamGridDbApiKey,
  fetch = globalThis.fetch,
}: Dependencies): ArtworkResolver {
  async function resolve(appId: number): Promise<ResolvedArtwork | undefined> {
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
      gridUrls.map((url) => ({ url, orientation: "portrait" as const })),
    );
    if (grid !== undefined) return grid;

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
    ) as Metadata;
    if (
      metadata.version !== CACHE_VERSION ||
      !["image/jpeg", "image/png", "image/webp"].includes(metadata.contentType) ||
      !["portrait", "landscape"].includes(metadata.orientation)
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
    },
    {
      url: new URL(
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`,
      ),
      orientation: "landscape",
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
      : [{ url: headerImage, orientation: "landscape" }, ...directCandidates];
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
      url.hostname === "s3.amazonaws.com" && /^\/steamgriddb\/.+/.test(url.pathname);
    const isCurrentSteamGridAsset =
      url.hostname === "cdn2.steamgriddb.com" && /^\/file\/sgdb-cdn\/grid\/.+/.test(url.pathname);
    return url.protocol === "https:" && (isLegacySteamGridAsset || isCurrentSteamGridAsset)
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
    return url.protocol === "https:" && hosts.has(url.hostname) ? url : undefined;
  } catch {
    return undefined;
  }
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
      JSON.stringify({ version: CACHE_VERSION, contentType, orientation: candidate.orientation }),
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
