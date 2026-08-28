export type DurationValue = Readonly<{
  minutes: number;
  hours: number;
}>;

export type GameDurationEstimate = Readonly<{
  appId: number;
  igdbGameId: number;
  igdbGameName?: string;
  source: "igdb";
  refreshedAt: string;
  hastily?: DurationValue;
  normally?: DurationValue;
  completely?: DurationValue;
}>;

export interface GameDurationRepository {
  get(appId: number): GameDurationEstimate | undefined;
  save(estimate: GameDurationEstimate): void;
}

type IgdbDurationInput = Readonly<{
  appId: number;
  igdbGameId: number;
  igdbGameName?: string;
  hastilySeconds?: number;
  normallySeconds?: number;
  completelySeconds?: number;
  refreshedAt: string;
}>;

function normalizeSeconds(seconds: number | undefined): DurationValue | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes <= 0) {
    return undefined;
  }

  return Object.freeze({ minutes, hours: minutes / 60 });
}

export function normalizeIgdbDuration(input: IgdbDurationInput): GameDurationEstimate | undefined {
  const hastily = normalizeSeconds(input.hastilySeconds);
  const normally = normalizeSeconds(input.normallySeconds);
  const completely = normalizeSeconds(input.completelySeconds);

  if (hastily === undefined && normally === undefined && completely === undefined) {
    return undefined;
  }

  return Object.freeze({
    appId: input.appId,
    igdbGameId: input.igdbGameId,
    ...(input.igdbGameName === undefined ? {} : { igdbGameName: input.igdbGameName }),
    source: "igdb",
    refreshedAt: input.refreshedAt,
    ...(hastily === undefined ? {} : { hastily }),
    ...(normally === undefined ? {} : { normally }),
    ...(completely === undefined ? {} : { completely }),
  });
}
