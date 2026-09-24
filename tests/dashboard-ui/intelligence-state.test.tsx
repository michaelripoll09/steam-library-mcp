// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  DashboardGame,
  DashboardPlan,
  DashboardRecommendations,
} from "../../src/dashboard/contracts.js";
import {
  useIntelligenceState,
  type IntelligenceApi,
} from "../../dashboard-ui/src/intelligence-state.js";

const game = (appId: number, name: string): DashboardGame => ({
  appId,
  name,
  status: "backlog",
  coverUrl: `https://cdn.example/${appId}.jpg`,
  accessType: "owned",
  isPlayable: true,
  playtimeMinutes: 0,
});

const games = [game(1, "Game One"), game(2, "Game Two")];

const recommendations = (availableMinutes: number): DashboardRecommendations => ({
  availableMinutes,
  sessionMode: "solo",
  recommendations: [
    {
      appId: availableMinutes,
      name: `Pick for ${availableMinutes}`,
      durationEstimateMinutes: null,
      estimatedRemainingMinutes: null,
      reasons: [],
      explanation: `Play ${availableMinutes}.`,
    },
  ],
});

const plan = (id: string): DashboardPlan => ({
  id,
  cadence: "weekly",
  availableMinutes: 45,
  targetGameCount: 1,
  items: [
    {
      id: `${id}:item`,
      rank: 1,
      appId: 1,
      name: "Game One",
      durationEstimateMinutes: 60,
      explanation: "Plan item.",
      progress: "not_started",
    },
  ],
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function apiFixture() {
  return {
    getInsights: vi.fn(async () => ({ library: { totalGames: 2 } })),
    getRecommendations: vi.fn(async (availableMinutes: number) =>
      recommendations(availableMinutes),
    ),
    getPreference: vi.fn(async (appId: number) => ({
      appId,
      priority: "normal" as const,
      excludedFromRecommendations: false,
      playMode: "any" as const,
    })),
    savePreference: vi.fn(async () => undefined),
    getPlans: vi.fn(async () => [plan("plan-a")]),
    createPlan: vi.fn(async () => ({ plan: plan("plan-b"), shortfall: null })),
    updatePlanItemProgress: vi.fn(async () => undefined),
  } satisfies IntelligenceApi as unknown as IntelligenceApi;
}

describe("intelligence recommendation isolation", () => {
  test("a slow request cannot overwrite a later fast request", async () => {
    const api = apiFixture();
    const first = deferred<DashboardRecommendations>();
    const second = deferred<DashboardRecommendations>();
    api.getRecommendations
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() => useIntelligenceState({ api, games }));

    act(() => {
      result.current.setAvailableMinutes("30");
    });
    let slow: Promise<void>;
    act(() => {
      slow = result.current.refreshRecommendations();
    });
    act(() => {
      result.current.setAvailableMinutes("120");
    });
    let fast: Promise<void>;
    act(() => {
      fast = result.current.refreshRecommendations();
    });

    await act(async () => {
      second.resolve(recommendations(120));
      await fast;
      first.resolve(recommendations(30));
      await slow;
    });

    expect(result.current.recommendations).toEqual(recommendations(120));
  });

  test("a stale failure cannot overwrite a newer success", async () => {
    const api = apiFixture();
    const first = deferred<DashboardRecommendations>();
    const second = deferred<DashboardRecommendations>();
    api.getRecommendations
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() => useIntelligenceState({ api, games }));

    let slow: Promise<void>;
    act(() => {
      slow = result.current.refreshRecommendations();
    });
    let fast: Promise<void>;
    act(() => {
      fast = result.current.refreshRecommendations();
    });

    await act(async () => {
      second.resolve(recommendations(45));
      await fast;
      first.reject(new Error("stale boom"));
      await slow;
    });

    expect(result.current.recommendations).toEqual(recommendations(45));
    expect(result.current.error).toBeUndefined();
  });

  test("a newer failure is shown because it is current", async () => {
    const api = apiFixture();
    const first = deferred<DashboardRecommendations>();
    const second = deferred<DashboardRecommendations>();
    api.getRecommendations
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() => useIntelligenceState({ api, games }));

    let slow: Promise<void>;
    act(() => {
      slow = result.current.refreshRecommendations();
    });
    let fast: Promise<void>;
    act(() => {
      fast = result.current.refreshRecommendations();
    });

    await act(async () => {
      first.resolve(recommendations(45));
      await slow;
      second.reject(new Error("current boom"));
      await fast;
    });

    expect(result.current.error).toBeDefined();
  });

  test("loadIntelligence cannot overwrite a later explicit recommendation refresh", async () => {
    const api = apiFixture();
    const loadRecs = deferred<DashboardRecommendations>();
    const explicitRecs = deferred<DashboardRecommendations>();
    const insights = deferred<{ library: { totalGames: number } }>();
    const plansGate = deferred<readonly DashboardPlan[]>();
    api.getRecommendations
      .mockImplementationOnce(() => loadRecs.promise)
      .mockImplementationOnce(() => explicitRecs.promise);
    api.getInsights.mockImplementationOnce(() => insights.promise);
    api.getPlans.mockImplementationOnce(() => plansGate.promise);
    const { result } = renderHook(() => useIntelligenceState({ api, games }));

    let load: Promise<void>;
    act(() => {
      load = result.current.loadIntelligence();
    });
    let explicit: Promise<void>;
    act(() => {
      explicit = result.current.refreshRecommendations();
    });

    await act(async () => {
      explicitRecs.resolve(recommendations(45));
      await explicit;
      loadRecs.resolve(recommendations(30));
      insights.resolve({ library: { totalGames: 2 } });
      plansGate.resolve([plan("plan-a")]);
      await load;
    });

    expect(result.current.recommendations).toEqual(recommendations(45));
  });
});

describe("intelligence plans isolation", () => {
  test("an older plans refresh cannot overwrite a newer createPlan refetch", async () => {
    const api = apiFixture();
    const stalePlans = deferred<readonly DashboardPlan[]>();
    const freshPlans = deferred<readonly DashboardPlan[]>();
    api.getPlans
      .mockImplementationOnce(() => stalePlans.promise)
      .mockImplementationOnce(() => freshPlans.promise);
    const { result } = renderHook(() => useIntelligenceState({ api, games }));

    let stale: Promise<void>;
    act(() => {
      stale = result.current.refreshPlans();
    });
    let created: Promise<void>;
    act(() => {
      created = result.current.createPlan();
    });

    await act(async () => {
      freshPlans.resolve([plan("plan-b")]);
      await created;
      stalePlans.resolve([plan("plan-a")]);
      await stale;
    });

    expect(result.current.plans).toEqual([plan("plan-b")]);
  });

  test("stale plan failures do not replace current error state", async () => {
    const api = apiFixture();
    const stalePlans = deferred<readonly DashboardPlan[]>();
    const freshPlans = deferred<readonly DashboardPlan[]>();
    api.getPlans
      .mockImplementationOnce(() => stalePlans.promise)
      .mockImplementationOnce(() => freshPlans.promise);
    const { result } = renderHook(() => useIntelligenceState({ api, games }));

    let stale: Promise<void>;
    act(() => {
      stale = result.current.refreshPlans();
    });
    let fresh: Promise<void>;
    act(() => {
      fresh = result.current.refreshPlans();
    });

    await act(async () => {
      freshPlans.resolve([plan("plan-b")]);
      await fresh;
      stalePlans.reject(new Error("stale plans boom"));
      await stale;
    });

    expect(result.current.plans).toEqual([plan("plan-b")]);
    expect(result.current.error).toBeUndefined();
  });
});

describe("intelligence snapshot isolation", () => {
  test("only the newest loadIntelligence may set the snapshot", async () => {
    const api = apiFixture();
    const firstInsights = deferred<{ library: { totalGames: number } }>();
    const secondInsights = deferred<{ library: { totalGames: number } }>();
    api.getInsights
      .mockImplementationOnce(() => firstInsights.promise)
      .mockImplementationOnce(() => secondInsights.promise);
    const { result } = renderHook(() => useIntelligenceState({ api, games }));

    let first: Promise<void>;
    act(() => {
      first = result.current.loadIntelligence();
    });
    let second: Promise<void>;
    act(() => {
      second = result.current.loadIntelligence();
    });

    await act(async () => {
      secondInsights.resolve({ library: { totalGames: 20 } });
      firstInsights.resolve({ library: { totalGames: 2 } });
      await second;
      await first;
    });

    expect(result.current.snapshot).toEqual({ library: { totalGames: 20 } });
  });
});

describe("preference save isolation", () => {
  test("a save for game A does not overwrite game B selected mid-flight", async () => {
    const api = apiFixture();
    const saveGate = deferred<void>();
    const preferenceForB = {
      appId: 2,
      priority: "high" as const,
      excludedFromRecommendations: true,
      playMode: "solo" as const,
    };
    api.savePreference.mockImplementationOnce(() => saveGate.promise);
    api.getPreference.mockImplementation(async (appId: number) =>
      appId === 2
        ? preferenceForB
        : {
            appId,
            priority: "normal" as const,
            excludedFromRecommendations: false,
            playMode: "any" as const,
          },
    );
    const { result } = renderHook(() => useIntelligenceState({ api, games }));

    act(() => {
      result.current.selectGame(1);
    });
    act(() => {
      result.current.setPreference({
        priority: "high",
        excludedFromRecommendations: false,
        playMode: "any",
      });
    });
    let saving: Promise<void>;
    act(() => {
      saving = result.current.savePreference();
    });
    act(() => {
      result.current.selectGame(2);
    });

    await act(async () => {
      saveGate.resolve();
      await saving;
    });

    expect(result.current.selectedAppId).toBe(2);
    expect(result.current.preference).toEqual({
      priority: "high",
      excludedFromRecommendations: true,
      playMode: "solo",
    });
    expect(result.current.message).toBeUndefined();
    expect(api.savePreference).toHaveBeenCalledTimes(1);
  });
});

describe("progress draft races", () => {
  test("an older update completion cannot erase a newer draft", async () => {
    const api = apiFixture();
    const updateGate = deferred<void>();
    const refetchGate = deferred<readonly DashboardPlan[]>();
    api.updatePlanItemProgress.mockImplementationOnce(() => updateGate.promise);
    api.getPlans
      .mockImplementationOnce(async () => [plan("plan-a")])
      .mockImplementationOnce(() => refetchGate.promise);
    const { result } = renderHook(() => useIntelligenceState({ api, games }));

    await act(async () => {
      await result.current.refreshPlans();
    });
    act(() => {
      result.current.setProgressDraft("plan-a", "plan-a:item", "in_progress");
    });
    let updating: Promise<void>;
    act(() => {
      updating = result.current.updateProgress("plan-a", "plan-a:item", "in_progress");
    });
    act(() => {
      result.current.setProgressDraft("plan-a", "plan-a:item", "done");
    });

    await act(async () => {
      updateGate.resolve();
      refetchGate.resolve([plan("plan-a")]);
      await updating;
    });

    expect(result.current.progressDrafts.get('["plan-a","plan-a:item"]')).toBe("done");
  });
});
