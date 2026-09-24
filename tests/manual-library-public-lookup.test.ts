import { describe, expect, test, vi } from "vitest";

import {
  InputError,
  SteamResponseError,
  SteamTimeoutError,
  SteamUnavailableError,
} from "../src/errors.js";
import { createPublicSteamGameLookup } from "../src/manual-library/manual-library.js";

const appId = 1245620;

function successResponse(name = "ELDEN RING"): Response {
  return new Response(JSON.stringify({ [appId]: { success: true, data: { name } } }), {
    status: 200,
  });
}

describe("public Steam game lookup", () => {
  test("resolves the public game name on the happy path", async () => {
    const fetchLike = vi.fn(async () => successResponse());
    const lookup = createPublicSteamGameLookup(fetchLike as unknown as typeof fetch);

    await expect(lookup(appId)).resolves.toEqual({ appId, name: "ELDEN RING" });
  });

  test("sends redirect:error with an abort signal", async () => {
    const fetchLike = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () => successResponse());
    const lookup = createPublicSteamGameLookup(fetchLike as unknown as typeof fetch);

    await lookup(appId);

    expect(fetchLike.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(fetchLike.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  test("aborts the request after the standard timeout and maps it to SteamTimeoutError", async () => {
    vi.useFakeTimers();
    try {
      const fetchLike = vi.fn<
        (input: string | URL | Request, init?: RequestInit) => Promise<Response>
      >(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const lookup = createPublicSteamGameLookup(fetchLike as unknown as typeof fetch);

      const pending = lookup(appId);
      const assertion = expect(pending).rejects.toBeInstanceOf(SteamTimeoutError);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
      expect(fetchLike.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("clears the timeout timer on success", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      const fetchLike = vi.fn(async () => successResponse());
      const lookup = createPublicSteamGameLookup(fetchLike as unknown as typeof fetch);

      await lookup(appId);

      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
    }
  });

  test("clears the timeout timer on failure", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      const fetchLike = vi.fn(async () => new Response("no", { status: 503 }));
      const lookup = createPublicSteamGameLookup(fetchLike as unknown as typeof fetch);

      await expect(lookup(appId)).rejects.toBeInstanceOf(SteamUnavailableError);
      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
    }
  });

  test("keeps network failures as SteamUnavailableError", async () => {
    const fetchLike = vi.fn(async () => {
      throw new Error("raw network failure");
    });
    const lookup = createPublicSteamGameLookup(fetchLike as unknown as typeof fetch);

    await expect(lookup(appId)).rejects.toBeInstanceOf(SteamUnavailableError);
  });

  test("keeps invalid JSON as SteamResponseError", async () => {
    const fetchLike = vi.fn(async () => new Response("not-json", { status: 200 }));
    const lookup = createPublicSteamGameLookup(fetchLike as unknown as typeof fetch);

    await expect(lookup(appId)).rejects.toBeInstanceOf(SteamResponseError);
  });

  test("keeps non-2xx responses as SteamUnavailableError", async () => {
    const fetchLike = vi.fn(async () => new Response("no", { status: 503 }));
    const lookup = createPublicSteamGameLookup(fetchLike as unknown as typeof fetch);

    await expect(lookup(appId)).rejects.toBeInstanceOf(SteamUnavailableError);
  });

  test("keeps a non-success Steam app payload as a safe InputError", async () => {
    const fetchLike = vi.fn(
      async () => new Response(JSON.stringify({ [appId]: { success: false } }), { status: 200 }),
    );
    const lookup = createPublicSteamGameLookup(fetchLike as unknown as typeof fetch);

    await expect(lookup(appId)).rejects.toBeInstanceOf(InputError);
  });
});
