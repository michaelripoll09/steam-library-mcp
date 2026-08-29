import { createReadStream } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AppError, InputError } from "../../errors.js";
import type { DashboardService } from "../dashboard-service.js";
import type { ArtworkResolver } from "../artwork-resolver.js";

export const DASHBOARD_HOST = "127.0.0.1";
export const MAX_JSON_BODY_BYTES = 16 * 1024;

const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' https://cdn.cloudflare.steamstatic.com; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  Connection: "close",
});

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
});

class UnsupportedMediaTypeError extends Error {}

export type DashboardHttpServerOptions = Readonly<{
  dashboardService: Pick<
    DashboardService,
    | "getLibrary"
    | "syncLibrary"
    | "updateStatus"
    | "getIntelligenceSnapshot"
    | "getRecommendations"
    | "getPreference"
    | "savePreference"
    | "listPlans"
    | "createPlan"
    | "updatePlanItemProgress"
  >;
  artworkResolver?: ArtworkResolver;
  staticRoot?: string;
  host?: string;
  port?: number;
  logger?: Pick<Console, "error">;
}>;

export function createDashboardHttpServer(options: DashboardHttpServerOptions): Server {
  const host = options.host ?? DASHBOARD_HOST;
  if (host !== DASHBOARD_HOST) {
    throw new InputError("Dashboard server must bind to 127.0.0.1.");
  }
  const staticRoot = options.staticRoot === undefined ? undefined : resolve(options.staticRoot);

  const server = createServer((request, response) => {
    void handleRequest(
      request,
      response,
      options.dashboardService,
      options.artworkResolver,
      staticRoot,
      options.logger,
    ).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, {
          error: { code: "INTERNAL_ERROR", message: "Internal server error." },
        });
      } else {
        response.destroy();
      }
    });
  });

  // Keep the requested port available to callers that inspect factory options,
  // while leaving listen() under the caller's control for ephemeral tests.
  void options.port;
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dashboardService: DashboardHttpServerOptions["dashboardService"],
  artworkResolver: DashboardHttpServerOptions["artworkResolver"],
  staticRoot: string | undefined,
  logger: DashboardHttpServerOptions["logger"],
): Promise<void> {
  applySecurityHeaders(response);
  if (!isAllowedHost(request, response)) return;

  const method = request.method ?? "GET";
  const requestUrl = parseRequestUrl(request.url);
  if (requestUrl === undefined) {
    sendJson(
      response,
      400,
      { error: { code: "INPUT_INVALID", message: "Invalid request URL." } },
      method,
    );
    return;
  }

  if (requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/")) {
    if (!isAllowedOrigin(request, response, method)) return;
    await handleApi(
      request,
      response,
      requestUrl.pathname,
      method,
      dashboardService,
      artworkResolver,
      logger,
    );
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    sendJson(
      response,
      405,
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      method,
      {
        Allow: "GET, HEAD",
      },
    );
    return;
  }
  await handleStatic(response, requestUrl.pathname, staticRoot, method);
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  method: string,
  dashboardService: DashboardHttpServerOptions["dashboardService"],
  artworkResolver: DashboardHttpServerOptions["artworkResolver"],
  logger: DashboardHttpServerOptions["logger"],
): Promise<void> {
  const artworkMatch = /^\/api\/artwork\/(\d+)$/.exec(pathname);
  if (artworkMatch !== null) {
    if (method !== "GET" || artworkResolver === undefined) {
      sendArtworkNotFound(response, method);
      return;
    }
    const appId = parseAppId(artworkMatch[1]);
    if (appId === undefined) {
      sendArtworkNotFound(response, method);
      return;
    }
    try {
      const library = await dashboardService.getLibrary();
      const game = library.games.find((entry) => entry.appId === appId);
      if (game === undefined) {
        sendArtworkNotFound(response, method);
        return;
      }
      const artwork = await artworkResolver.resolve(appId, game.name);
      if (artwork === undefined) {
        sendArtworkNotFound(response, method);
        return;
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", artwork.contentType);
      response.setHeader("X-Artwork-Orientation", artwork.orientation);
      const artworkStream = createReadStream(artwork.filePath);
      artworkStream.once("error", () => {
        if (!response.headersSent) {
          sendArtworkNotFound(response, method);
        } else {
          response.destroy();
        }
      });
      artworkStream.pipe(response);
    } catch (error) {
      sendError(response, error, logger, method);
    }
    return;
  }
  if (pathname === "/api/library") {
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
        method,
        {
          Allow: "GET",
        },
      );
      return;
    }
    await runService(response, method, () => dashboardService.getLibrary(), logger);
    return;
  }

  if (pathname === "/api/library/sync") {
    if (method !== "POST") {
      sendJson(
        response,
        405,
        { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
        method,
        {
          Allow: "POST",
        },
      );
      return;
    }
    await runService(response, method, () => dashboardService.syncLibrary(), logger);
    return;
  }

  if (pathname === "/api/intelligence/insights") {
    if (method !== "GET") return sendMethodNotAllowed(response, method, "GET");
    await runService(response, method, () => dashboardService.getIntelligenceSnapshot(), logger);
    return;
  }

  if (pathname === "/api/intelligence/recommendations") {
    if (method !== "GET") return sendMethodNotAllowed(response, method, "GET");
    const availableMinutes = parsePositiveQuery(request.url, "availableMinutes");
    if (availableMinutes === undefined) {
      sendJson(response, 400, {
        error: { code: "INPUT_INVALID", message: "Available minutes must be a positive integer." },
      });
      return;
    }
    await runService(
      response,
      method,
      () => dashboardService.getRecommendations(availableMinutes),
      logger,
    );
    return;
  }

  const preferenceMatch = /^\/api\/games\/([^/]+)\/preference$/.exec(pathname);
  if (preferenceMatch !== null) {
    const appId = parseAppId(preferenceMatch[1]);
    if (appId === undefined) {
      sendJson(response, 400, {
        error: { code: "INVALID_INPUT", message: "The app ID must be a positive integer." },
      });
      return;
    }
    if (method === "GET") {
      await runService(
        response,
        method,
        () => Promise.resolve(dashboardService.getPreference(appId)),
        logger,
      );
      return;
    }
    if (method !== "PUT") return sendMethodNotAllowed(response, method, "GET, PUT");
    try {
      const preference = parsePreferencePayload(await readJsonBody(request));
      sendJson(response, 200, dashboardService.savePreference(appId, preference));
    } catch (error) {
      sendError(response, error, logger, method);
    }
    return;
  }

  if (pathname === "/api/backlog-plans") {
    if (method === "GET") {
      await runService(
        response,
        method,
        () => Promise.resolve(dashboardService.listPlans()),
        logger,
      );
      return;
    }
    if (method !== "POST") return sendMethodNotAllowed(response, method, "GET, POST");
    try {
      const requestBody = parsePlanPayload(await readJsonBody(request));
      sendJson(response, 200, await dashboardService.createPlan(requestBody));
    } catch (error) {
      sendError(response, error, logger, method);
    }
    return;
  }

  const planItemMatch = /^\/api\/backlog-plans\/([^/]+)\/items\/([^/]+)$/.exec(pathname);
  if (planItemMatch !== null) {
    if (method !== "PATCH") return sendMethodNotAllowed(response, method, "PATCH");
    const planId = decodeRouteId(planItemMatch[1]);
    const itemId = decodeRouteId(planItemMatch[2]);
    if (planId === undefined || itemId === undefined) {
      sendJson(response, 400, {
        error: { code: "INPUT_INVALID", message: "Invalid plan item path." },
      });
      return;
    }
    try {
      const progress = parsePlanProgressPayload(await readJsonBody(request));
      sendJson(
        response,
        200,
        await dashboardService.updatePlanItemProgress(planId, itemId, progress),
      );
    } catch (error) {
      sendError(response, error, logger, method);
    }
    return;
  }

  const statusMatch = /^\/api\/games\/([^/]+)\/status$/.exec(pathname);
  if (statusMatch !== null) {
    if (method !== "PATCH") {
      sendJson(
        response,
        405,
        { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
        method,
        {
          Allow: "PATCH",
        },
      );
      return;
    }
    const appId = parseAppId(statusMatch[1]);
    if (appId === undefined) {
      sendJson(response, 400, {
        error: { code: "INVALID_INPUT", message: "The app ID must be a positive integer." },
      });
      return;
    }
    try {
      const payload = await readJsonBody(request);
      const status = parseStatusPayload(payload);
      const result = await dashboardService.updateStatus(appId, status);
      sendJson(response, 200, result);
    } catch (error) {
      sendError(response, error, logger);
    }
    return;
  }

  sendJson(
    response,
    404,
    { error: { code: "NOT_FOUND", message: "API route not found." } },
    method,
  );
}

function sendArtworkNotFound(response: ServerResponse, method: string): void {
  sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Artwork not found." } }, method);
}

async function runService<T>(
  response: ServerResponse,
  method: string,
  operation: () => Promise<T>,
  logger: DashboardHttpServerOptions["logger"],
): Promise<void> {
  try {
    sendJson(response, 200, await operation(), method);
  } catch (error) {
    sendError(response, error, logger, method);
  }
}

function parseRequestUrl(rawUrl: string | undefined): URL | undefined {
  if (rawUrl === undefined) return undefined;
  try {
    return new URL(rawUrl, "http://127.0.0.1");
  } catch {
    return undefined;
  }
}

function isAllowedHost(request: IncomingMessage, response: ServerResponse): boolean {
  const rawHost = request.headers.host;
  if (rawHost === undefined || rawHost.includes("@")) {
    sendJson(response, 403, { error: { code: "FORBIDDEN", message: "Local host required." } });
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${rawHost}`);
  } catch {
    sendJson(response, 403, { error: { code: "FORBIDDEN", message: "Local host required." } });
    return false;
  }
  const expectedPort = request.socket.localPort;
  const portMatches = expectedPort === undefined || parsed.port === String(expectedPort);
  const validName = parsed.hostname === DASHBOARD_HOST || parsed.hostname === "localhost";
  if (!validName || !portMatches) {
    sendJson(response, 403, { error: { code: "FORBIDDEN", message: "Local host required." } });
    return false;
  }
  return true;
}

function isAllowedOrigin(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || (method !== "POST" && method !== "PATCH" && method !== "PUT"))
    return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    sendJson(response, 403, { error: { code: "FORBIDDEN", message: "Origin is not allowed." } });
    return false;
  }
  const expectedPort =
    request.socket.localPort === undefined ? "" : String(request.socket.localPort);
  if (
    parsed.protocol !== "http:" ||
    (parsed.hostname !== DASHBOARD_HOST && parsed.hostname !== "localhost") ||
    parsed.port !== expectedPort
  ) {
    sendJson(response, 403, { error: { code: "FORBIDDEN", message: "Origin is not allowed." } });
    return false;
  }
  return true;
}

function parseAppId(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const appId = Number(value);
  return Number.isSafeInteger(appId) && appId > 0 ? appId : undefined;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"];
  if (contentType === undefined || !/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    request.resume();
    throw new UnsupportedMediaTypeError();
  }
  const declaredLength = request.headers["content-length"];
  if (
    declaredLength !== undefined &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_JSON_BODY_BYTES)
  ) {
    request.resume();
    throw new InputError("Request body is too large.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_JSON_BODY_BYTES) throw new InputError("Request body is too large.");
    chunks.push(bytes);
  }
  if (chunks.length === 0) throw new InputError("Request body must be valid JSON.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new InputError("Request body must be valid JSON.");
  }
}

function parseStatusPayload(payload: unknown): "playing" | "completed" | "dropped" {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    !("status" in payload) ||
    !["playing", "completed", "dropped"].includes(
      (payload as { status?: unknown }).status as string,
    )
  ) {
    throw new InputError("Status must be one of playing, completed, or dropped.");
  }
  return (payload as { status: "playing" | "completed" | "dropped" }).status;
}

function parsePreferencePayload(payload: unknown): {
  priority: "normal" | "high";
  excludedFromRecommendations: boolean;
  playMode: "any" | "solo" | "with_friends";
} {
  if (
    !isExactRecord(payload, ["priority", "excludedFromRecommendations", "playMode"]) ||
    !["normal", "high"].includes(payload.priority as string) ||
    typeof payload.excludedFromRecommendations !== "boolean" ||
    !["any", "solo", "with_friends"].includes(payload.playMode as string)
  ) {
    throw new InputError("Recommendation preference values are invalid.");
  }
  return payload as {
    priority: "normal" | "high";
    excludedFromRecommendations: boolean;
    playMode: "any" | "solo" | "with_friends";
  };
}

function parsePlanPayload(payload: unknown): {
  cadence: "weekly" | "monthly";
  availableMinutes: number;
  targetGameCount: number;
} {
  if (
    !isExactRecord(payload, ["cadence", "availableMinutes", "targetGameCount"]) ||
    !["weekly", "monthly"].includes(payload.cadence as string) ||
    !isPositiveSafeInteger(payload.availableMinutes) ||
    !isPositiveSafeInteger(payload.targetGameCount)
  ) {
    throw new InputError(
      "Cadence, available minutes, and target game count must be valid positive values.",
    );
  }
  return payload as {
    cadence: "weekly" | "monthly";
    availableMinutes: number;
    targetGameCount: number;
  };
}

function parsePlanProgressPayload(
  payload: unknown,
): "not_started" | "in_progress" | "done" | "skipped" {
  if (
    !isExactRecord(payload, ["progress"]) ||
    !["not_started", "in_progress", "done", "skipped"].includes(payload.progress as string)
  ) {
    throw new InputError("Plan-item progress must be not_started, in_progress, done, or skipped.");
  }
  return payload.progress as "not_started" | "in_progress" | "done" | "skipped";
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parsePositiveQuery(rawUrl: string | undefined, key: string): number | undefined {
  const url = parseRequestUrl(rawUrl);
  if (url === undefined || [...url.searchParams.keys()].some((name) => name !== key))
    return undefined;
  const values = url.searchParams.getAll(key);
  if (values.length !== 1 || !/^\d+$/.test(values[0])) return undefined;
  const value = Number(values[0]);
  return isPositiveSafeInteger(value) ? value : undefined;
}

function decodeRouteId(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 && decoded.length <= 255 && !decoded.includes("/")
      ? decoded
      : undefined;
  } catch {
    return undefined;
  }
}

function sendMethodNotAllowed(response: ServerResponse, method: string, allow: string): void {
  sendJson(
    response,
    405,
    { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
    method,
    { Allow: allow },
  );
}

async function handleStatic(
  response: ServerResponse,
  pathname: string,
  staticRoot: string | undefined,
  method: string,
): Promise<void> {
  if (staticRoot === undefined) {
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Not found." } }, method);
    return;
  }
  const root = await safeRealpath(staticRoot);
  if (root === undefined) {
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Not found." } }, method);
    return;
  }
  const decoded = decodePath(pathname);
  if (decoded === undefined) {
    sendJson(response, 400, { error: { code: "INPUT_INVALID", message: "Invalid path." } }, method);
    return;
  }
  const requested = decoded === "/" ? "/index.html" : decoded;
  const file = await safeStaticFile(root, requested);
  if (file !== undefined) {
    await sendFile(response, file, method);
    return;
  }
  if (extname(decoded) !== "") {
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Asset not found." } }, method);
    return;
  }
  const fallback = await safeStaticFile(root, "/index.html");
  if (fallback === undefined) {
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Not found." } }, method);
    return;
  }
  await sendFile(response, fallback, method);
}

function decodePath(pathname: string): string | undefined {
  try {
    const decoded = decodeURIComponent(pathname);
    return decoded.includes("\0") ? undefined : decoded;
  } catch {
    return undefined;
  }
}

async function safeRealpath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

async function safeStaticFile(root: string, requestPath: string): Promise<string | undefined> {
  const candidate = resolve(join(root, `.${requestPath}`));
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return undefined;
  try {
    await access(candidate);
    const file = await realpath(candidate);
    const realRelative = relative(root, file);
    if (realRelative.startsWith("..") || isAbsolute(realRelative)) return undefined;
    const info = await stat(file);
    return info.isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

async function sendFile(response: ServerResponse, file: string, method: string): Promise<void> {
  const info = await stat(file);
  response.statusCode = 200;
  response.setHeader(
    "Content-Type",
    MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
  );
  response.setHeader("Content-Length", info.size);
  if (method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

function sendError(
  response: ServerResponse,
  error: unknown,
  logger?: DashboardHttpServerOptions["logger"],
  method = "PATCH",
): void {
  if (error instanceof UnsupportedMediaTypeError) {
    sendJson(
      response,
      415,
      {
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Content-Type must be application/json.",
        },
      },
      method,
    );
    return;
  }
  if (error instanceof AppError) {
    const status =
      error.code === "GAME_NOT_FOUND"
        ? 409
        : error.code === "INPUT_INVALID" || error.code === "INVALID_INPUT"
          ? 400
          : error.code === "STEAM_UNAVAILABLE" ||
              error.code === "STEAM_TIMEOUT" ||
              error.code === "STEAM_RESPONSE_INVALID" ||
              error.code === "OWNERSHIP_UNAVAILABLE"
            ? 503
            : 500;
    sendJson(response, status, { error: { code: error.code, message: error.safeMessage } }, method);
    return;
  }
  logger?.error?.("Dashboard request failed", "INTERNAL_ERROR");
  sendJson(
    response,
    500,
    { error: { code: "INTERNAL_ERROR", message: "Internal server error." } },
    method,
  );
}

function applySecurityHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  method = "GET",
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(method === "HEAD" ? undefined : payload);
}

export function dashboardStaticRootFromModule(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "../dashboard-ui");
}
