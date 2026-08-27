import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FetchLike } from "../steam/client.js";

export type ArtworkResolver = Readonly<{
  resolve(appId: number): Promise<ResolvedArtwork | undefined>;
}>;
export type ResolvedArtwork = Readonly<{ filePath: string; contentType: string }>;
type Dependencies = Readonly<{
  cacheDirectory: string;
  steamGridDbApiKey?: string;
  fetch?: FetchLike;
}>;
type Metadata = Readonly<{ contentType: string }>;

const allowedSteamHosts = new Set([
  "shared.akamai.steamstatic.com",
  "cdn.cloudflare.steamstatic.com",
]);
const gridHost = "cdn.steamgriddb.com";

export function createArtworkResolver({
  cacheDirectory,
  steamGridDbApiKey,
  fetch = globalThis.fetch,
}: Dependencies): ArtworkResolver {
  async function resolve(appId: number): Promise<ResolvedArtwork | undefined> {
    if (!Number.isSafeInteger(appId) || appId <= 0) return undefined;
    const cached = await readCached(cacheDirectory, appId);
    if (cached !== undefined) return cached;
    const steamUrl = await publicSteamArtwork(fetch, appId);
    const gridUrl =
      steamUrl === undefined && steamGridDbApiKey !== undefined
        ? await steamGridArtwork(fetch, appId, steamGridDbApiKey)
        : undefined;
    const imageUrl = steamUrl ?? gridUrl;
    return imageUrl === undefined ? undefined : cacheImage(fetch, cacheDirectory, appId, imageUrl);
  }
  return Object.freeze({ resolve });
}

async function readCached(directory: string, appId: number): Promise<ResolvedArtwork | undefined> {
  const filePath = join(directory, `${appId}.img`);
  try {
    const metadata = JSON.parse(
      await readFile(join(directory, `${appId}.json`), "utf8"),
    ) as Metadata;
    await access(filePath);
    return { filePath, contentType: metadata.contentType };
  } catch {
    return undefined;
  }
}

async function publicSteamArtwork(fetch: FetchLike, appId: number): Promise<URL | undefined> {
  try {
    const response = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`,
    );
    const payload = (await response.json()) as Record<
      string,
      { success?: boolean; data?: { header_image?: unknown } }
    >;
    const value =
      payload[String(appId)]?.success === true
        ? payload[String(appId)]?.data?.header_image
        : undefined;
    return allowedUrl(value, allowedSteamHosts);
  } catch {
    return undefined;
  }
}

async function steamGridArtwork(
  fetch: FetchLike,
  appId: number,
  key: string,
): Promise<URL | undefined> {
  try {
    const response = await fetch(
      `https://www.steamgriddb.com/api/v2/grids/steam/${appId}?dimensions=600x900`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
    const payload = (await response.json()) as {
      success?: boolean;
      data?: readonly { url?: unknown }[];
    };
    return payload.success === true
      ? allowedUrl(payload.data?.[0]?.url, new Set([gridHost]))
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

async function cacheImage(
  fetch: FetchLike,
  directory: string,
  appId: number,
  url: URL,
): Promise<ResolvedArtwork | undefined> {
  try {
    const response = await fetch(url, { redirect: "error" });
    const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
    if (!response.ok || !["image/jpeg", "image/png", "image/webp"].includes(contentType))
      return undefined;
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > 10 * 1024 * 1024) return undefined;
    await mkdir(directory, { recursive: true });
    const filePath = join(directory, `${appId}.img`);
    await writeFile(filePath, body);
    await writeFile(join(directory, `${appId}.json`), JSON.stringify({ contentType }), "utf8");
    return { filePath, contentType };
  } catch {
    return undefined;
  }
}
