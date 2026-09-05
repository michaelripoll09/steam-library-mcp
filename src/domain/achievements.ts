export type SteamAchievement = Readonly<{
  apiName: string;
  displayName: string;
  description: string | null;
  achieved: boolean;
  unlockTime: string | null;
  iconUrl: string | null;
  iconGrayUrl: string | null;
}>;

export type GameAchievementProgress = Readonly<{
  appId: number;
  name: string;
  unlockedCount: number;
  totalCount: number;
  completionPercent: number;
  achievements: readonly SteamAchievement[];
}>;
