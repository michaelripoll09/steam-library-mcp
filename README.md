# Steam Library MCP

Steam Library MCP is a local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for one configured Steam library, with an optional loopback-only dashboard. It reads Steam data without changing the account, while game status, preferences, backlog plans, duration cache, and manual collection entries stay in a local SQLite database.

> **Important:** Automatic Steam Families syncing is not implemented. The server queries the single STEAM_ID configured in the environment. Add other public games manually with a Steam store URL or AppID.

## Quick start

Requirements: Node.js 22 or newer.

```sh
npm install
cp .env.example .env
# edit .env with your local values
npm run build
npm start
```

npm start launches the MCP server over stdio. Configure your MCP client to launch that command from this repository. stdout is reserved for MCP protocol traffic; operational logs and diagnostics belong on stderr. Keep .env local and never put credentials in documentation, prompts, tool arguments, or logs.

### Optional dashboard

The production dashboard uses the same environment and SQLite database:

```sh
npm run build
npm run dashboard
```

Open <http://127.0.0.1:4173>.

For local development, run the stdio server and dashboard development processes separately:

```sh
npm run dev
npm run dev:dashboard
```

npm run dev rebuilds and starts the stdio server. npm run dev:dashboard starts the API at 127.0.0.1:4173 and the Vite UI at 127.0.0.1:5173; the Vite UI proxies /api requests to the API. Set DASHBOARD_PORT or DASHBOARD_UI_PORT to use different local ports.

## How it is structured

```text
MCP client ── stdio ──> Node.js MCP server ──> Steam Web API
                              │                ├─ optional IGDB metadata/durations
                              │                └─ optional SteamGridDB artwork
                              └── SQLite (.steam-library/tracker.sqlite)

Browser ── loopback HTTP ──> dashboard API ──> the same services and database
```

The server is TypeScript on Node.js, uses the MCP SDK for stdio transport, and keeps domain services (Steam library, tracker, metadata, recommendations, backlog plans, and tasks) separate from the dashboard HTTP adapter. Steam library reads are cached for five minutes per SteamID and use a 10-second upstream timeout.

## Configuration

Start from the tracked [.env.example](.env.example). Required values:

| Variable              | Required | Purpose                                                                         |
| --------------------- | -------- | ------------------------------------------------------------------------------- |
| STEAM_API_KEY         | Yes      | Steam Web API key for library requests.                                         |
| STEAM_ID              | Yes      | 64-bit SteamID of the one library to query.                                     |
| STEAMGRIDDB_API_KEY   | No       | Optional artwork fallback when public Steam artwork is unavailable.             |
| TRACKER_DATABASE_PATH | No       | SQLite path; defaults to .steam-library/tracker.sqlite.                         |
| DASHBOARD_PORT        | No       | Local dashboard API port; defaults to 4173.                                     |
| DASHBOARD_UI_PORT     | No       | Local Vite development UI port; defaults to 5173.                               |
| IGDB_CLIENT_ID        | No       | Twitch developer client ID for IGDB metadata, durations, and artwork fallbacks. |
| IGDB_CLIENT_SECRET    | No       | Twitch developer client secret paired with IGDB_CLIENT_ID.                      |

Shell-provided environment variables take precedence over values loaded from .env.

## MCP tool surface

All tools are available through the stdio MCP server.

| Area              | Tools                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steam library     | **steam_get_library**, **steam_search_library**, **steam_get_game**, **steam_get_recent_games**, **steam_get_library_stats**                               |
| Manual collection | **steam_get_manual_collection**, **steam_add_manual_collection**, **steam_remove_manual_collection**                                                       |
| Local tracker     | **gaming_get_backlog**, **gaming_get_current_game**, **gaming_mark_playing**, **gaming_mark_completed**, **gaming_mark_dropped**, **gaming_get_completed** |
| Metadata          | **steam_get_game_metadata**, **steam_query_library_metadata**                                                                                              |
| Recommendations   | **recommendation_get_game_preference**, **recommendation_set_game_preference**, **recommendation_get_play_now**                                            |
| Backlog plans     | **backlog_create_plan**, **backlog_list_active_plans**, **backlog_update_plan_item_progress**                                                              |
| Background tasks  | **task_list**, **task_get**, **task_cancel**                                                                                                               |

Manual collection accepts a positive Steam AppID or an HTTPS store.steampowered.com/app/<AppID> URL. The server looks up the public Steam app name, stores the entry locally, and merges it into library reads. It does not verify ownership or current access.

The server also exposes read-only task resources (steam-library://tasks and steam-library://tasks/{taskId}), intelligence resources, and prompts for play-now recommendations, weekly/monthly plans, and backlog review. Background task types include library sync, duration enrichment, and plan recalculation.

## Dashboard capabilities

The dashboard is a local view over the configured library and tracker. It supports:

- Library search and filters, summary totals, playtime, recent-play information, game details, and artwork.
- Explicit library refresh.
- Local status changes (playing, completed, or dropped).
- Manual collection add/remove using a Steam URL or AppID.
- Local “play now” recommendations based on available minutes, tracker status, preferences, and duration estimates.
- Per-game recommendation preferences (priority, excluded, solo/with-friends).
- Weekly or monthly backlog plans, shortfall reporting, and item progress updates.
- Local task state/progress polling and cancellation.

The API and UI bind to loopback (127.0.0.1); this is intended for local use, not public hosting.

## Limitations and data ownership

- The tracker, preferences, backlog plans, duration cache, and manual collection are local SQLite state. They never write game status back to Steam. Back up the database before upgrades or manual recovery. If a migration or storage failure occurs, stop the server and restore a known-good backup instead of deleting the database.
- Manual entries are catalog entries only: they have no Steam ownership confirmation, start with zero playtime, and are treated as not playable by recommendation logic.
- Fresh duration estimates require both IGDB credentials and successful upstream responses. Each duration request first attempts a verified Steam-to-IGDB match and time-to-beat lookup; a successful result is saved to SQLite and replaces the previous estimate. If IGDB is disabled or unavailable, an existing cached estimate is returned unchanged; if no cached estimate exists, the result is unavailable. A valid response with no verified match or time-to-beat record also produces no estimate.
- Artwork uses local cache plus public Steam artwork, with optional SteamGridDB/IGDB fallbacks. Artwork availability varies by game and provider.
- This project does not automatically import or synchronize Steam Families libraries.

## Verification

```sh
npm test -- --run
npm run typecheck
npm run lint
npm run format:check
```
