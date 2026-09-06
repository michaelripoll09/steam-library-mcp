import type {
  DashboardGame,
  DashboardRecommendationPreference,
  DashboardSessionMode,
} from "../../../src/dashboard/contracts.js";
import { CoverImage } from "../components/game-card.js";
import { CustomSelect, type CustomSelectOption } from "../custom-select.js";
import type { IntelligenceState } from "../intelligence-state.js";

const PRIORITY_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "Alta" },
] as const satisfies readonly CustomSelectOption<"normal" | "high">[];

const PLAY_MODE_OPTIONS = [
  { value: "any", label: "Cualquiera" },
  { value: "solo", label: "Solo" },
  { value: "with_friends", label: "Con amigos" },
] as const satisfies readonly CustomSelectOption<"any" | "solo" | "with_friends">[];

const SESSION_MODE_OPTIONS = [
  { value: "solo", label: "Solo" },
  { value: "with_friends", label: "Con amigos" },
  { value: "any", label: "Cualquiera" },
] as const satisfies readonly CustomSelectOption<DashboardSessionMode>[];

export function PlayNowView({
  games,
  state,
  onOpenGame,
}: Readonly<{
  games: readonly DashboardGame[];
  state: IntelligenceState;
  onOpenGame: (game: DashboardGame, opener: HTMLButtonElement) => void;
}>) {
  const recommendationGames = new Map(games.map((game) => [game.appId, game]));
  const [hero, ...additionalRecommendations] = state.recommendations?.recommendations ?? [];

  return (
    <section className="play-now-view intelligence-panel" aria-labelledby="play-now-heading">
      <PageHeader title="Play Now" onLoad={state.loadIntelligence} />
      {state.error !== undefined && <p role="alert">{state.error}</p>}
      {state.message !== undefined && <p aria-live="polite">{state.message}</p>}
      {state.snapshot?.library !== undefined && (
        <p className="intelligence-snapshot">
          {state.snapshot.library.totalGames} juegos · {state.snapshot.activePlans.length} planes
          activos · {state.snapshot.preferences.highPriorityGames} con prioridad alta
        </p>
      )}
      <PlayNowControls
        availableMinutes={state.availableMinutes}
        sessionMode={state.sessionMode}
        onAvailableMinutesChange={state.setAvailableMinutes}
        onSessionModeChange={state.setSessionMode}
        onFind={state.refreshRecommendations}
      />
      <section className="play-now-recommendations" aria-labelledby="recommendations-heading">
        <h3 id="recommendations-heading">Recomendaciones</h3>
        <PlayNowHero
          recommendation={hero}
          game={hero === undefined ? undefined : recommendationGames.get(hero.appId)}
          onOpenGame={onOpenGame}
        />
        <RecommendationList
          recommendations={additionalRecommendations.slice(0, 3)}
          games={recommendationGames}
          onOpenGame={onOpenGame}
        />
      </section>
      <PreferencesSection games={games} state={state} />
    </section>
  );
}

function PageHeader({ title, onLoad }: Readonly<{ title: string; onLoad: () => Promise<void> }>) {
  return (
    <div className="dashboard-view-heading">
      <div>
        <p className="eyebrow">Inteligencia local</p>
        <h2 id="play-now-heading">{title}</h2>
      </div>
      <button className="intelligence-button" type="button" onClick={() => void onLoad()}>
        Cargar inteligencia
      </button>
    </div>
  );
}

function PlayNowControls({
  availableMinutes,
  sessionMode,
  onAvailableMinutesChange,
  onSessionModeChange,
  onFind,
}: Readonly<{
  availableMinutes: string;
  sessionMode: DashboardSessionMode;
  onAvailableMinutesChange: (value: string) => void;
  onSessionModeChange: (value: DashboardSessionMode) => void;
  onFind: () => Promise<void>;
}>) {
  return (
    <div className="recommendations-controls">
      <label>
        Tiempo de esta sesión
        <input
          type="number"
          min="1"
          value={availableMinutes}
          onChange={(event) => onAvailableMinutesChange(event.target.value)}
        />
      </label>
      <CustomSelect
        label="Modo de sesión"
        value={sessionMode}
        options={SESSION_MODE_OPTIONS}
        onChange={onSessionModeChange}
      />
      <button
        className="intelligence-button intelligence-button-primary"
        type="button"
        onClick={() => void onFind()}
      >
        Encontrar qué jugar
      </button>
    </div>
  );
}

function PlayNowHero({
  recommendation,
  game,
  onOpenGame,
}: Readonly<{
  recommendation:
    | {
        name: string;
        durationEstimateMinutes: number | null;
        explanation: string;
        reasons: readonly string[];
      }
    | undefined;
  game: DashboardGame | undefined;
  onOpenGame: (game: DashboardGame, opener: HTMLButtonElement) => void;
}>) {
  if (recommendation === undefined) {
    return <p className="play-now-empty">Elegí una duración y encontrá tu próxima partida.</p>;
  }
  return (
    <article className="play-now-hero">
      {game !== undefined && <CoverImage game={game} />}
      <div>
        <p className="eyebrow">Tu primera opción</p>
        <h4>{recommendation.name}</h4>
        <span>
          {recommendation.durationEstimateMinutes === null
            ? "Duración desconocida"
            : `~${recommendation.durationEstimateMinutes} min`}
        </span>
        <p>{recommendation.explanation}</p>
        <small>{recommendation.reasons.join(", ")}</small>
        {game !== undefined && (
          <button type="button" onClick={(event) => onOpenGame(game, event.currentTarget)}>
            Ver detalles
          </button>
        )}
      </div>
    </article>
  );
}

function RecommendationList({
  recommendations,
  games,
  onOpenGame,
}: Readonly<{
  recommendations: readonly {
    appId: number;
    name: string;
    durationEstimateMinutes: number | null;
    explanation: string;
    reasons: readonly string[];
  }[];
  games: ReadonlyMap<number, DashboardGame>;
  onOpenGame: (game: DashboardGame, opener: HTMLButtonElement) => void;
}>) {
  if (recommendations.length === 0) return null;
  return (
    <ul className="recommendation-list">
      {recommendations.map((recommendation) => {
        const game = games.get(recommendation.appId);
        return (
          <li key={recommendation.appId} className="play-now-card">
            {game !== undefined && <CoverImage game={game} />}
            <div>
              <strong>{recommendation.name}</strong>
              <span>
                {recommendation.durationEstimateMinutes === null
                  ? "Duración desconocida"
                  : `~${recommendation.durationEstimateMinutes} min`}
              </span>
              <p>{recommendation.explanation}</p>
              <small>{recommendation.reasons.join(", ")}</small>
              {game !== undefined && (
                <button type="button" onClick={(event) => onOpenGame(game, event.currentTarget)}>
                  Ver detalles
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function PreferencesSection({
  games,
  state,
}: Readonly<{
  games: readonly DashboardGame[];
  state: IntelligenceState;
}>) {
  const updatePreference = (patch: Partial<Omit<DashboardRecommendationPreference, "appId">>) =>
    state.setPreference({ ...state.preference, ...patch });

  return (
    <section
      className="intelligence-side-card preferences-section"
      aria-labelledby="preferences-heading"
    >
      <h3 id="preferences-heading">Preferencias</h3>
      <CustomSelect
        label="Juego para preferencias"
        value={state.selectedAppId?.toString() ?? ""}
        options={games.map((game) => ({ value: game.appId.toString(), label: game.name }))}
        onChange={(appId) => state.selectGame(Number(appId))}
      />
      <CustomSelect
        label="Prioridad de recomendación"
        value={state.preference.priority}
        options={PRIORITY_OPTIONS}
        onChange={(priority) => updatePreference({ priority })}
      />
      <CustomSelect
        label="Modo de juego"
        value={state.preference.playMode}
        options={PLAY_MODE_OPTIONS}
        onChange={(playMode) => updatePreference({ playMode })}
      />
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={state.preference.excludedFromRecommendations}
          onChange={(event) =>
            updatePreference({ excludedFromRecommendations: event.target.checked })
          }
        />
        Excluir de recomendaciones
      </label>
      <button
        className="intelligence-button intelligence-button-primary"
        type="button"
        onClick={() => void state.savePreference()}
        disabled={
          state.selectedAppId === undefined ||
          state.isPreferenceLoading ||
          state.preferenceLoadedFor !== state.selectedAppId
        }
        aria-busy={state.isPreferenceLoading}
      >
        Guardar preferencias
      </button>
    </section>
  );
}
