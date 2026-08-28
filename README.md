# Steam Library MCP

Steam Library MCP provides a local stdio MCP server for a configured Steam library, plus an optional local dashboard. Steam reads are non-destructive; game-progress status is stored locally in SQLite and never written back to Steam.

## Choose a quick path

### MCP client (stdio)

1. Install **Node.js 22+**.
2. Install dependencies and create a local configuration file:

   ```sh
   npm install
   cp .env.example .env
   ```

3. Replace the placeholders in `.env` with your own values. Keep that file local.
4. Build and start the stdio server:

   ```sh
   npm run build
   npm start
   ```

The server speaks MCP over stdio, so stdout is reserved for protocol traffic. Configure your MCP client to launch the local `npm start` process from this repository and provide the same environment variables described below.

### Dashboard (optional)

The dashboard uses the same local configuration and tracker database as the MCP server:

```sh
npm run build
npm run dashboard
```

Open <http://127.0.0.1:4173>.

For development, use separate processes:

```sh
npm run dev
npm run dev:dashboard
```

`npm run dev` is the stdio server path only. `npm run dev:dashboard` starts the dashboard API at `127.0.0.1:4173` and the Vite UI at `127.0.0.1:5173`.

Shell-provided environment variables take precedence over `.env`, so an MCP client or local process can supply configuration through its own environment.

## Configuration

Start from the tracked [`.env.example`](.env.example) file. Do not copy real credentials into documentation, prompts, tool arguments, or logs.

| Variable                | Required     | Purpose                                                                             |
| ----------------------- | ------------ | ----------------------------------------------------------------------------------- |
| `STEAM_API_KEY`         | Yes          | Steam Web API credential used for library requests.                                 |
| `STEAM_ID`              | Yes          | 64-bit SteamID of the single library to query.                                      |
| `STEAM_WEBAPI_TOKEN`    | For Families | Temporary Steam web-session credential for family-library syncing.                  |
| `STEAMGRIDDB_API_KEY`   | No           | Optional SteamGridDB key for portrait artwork when public Steam art is unavailable. |
| `TRACKER_DATABASE_PATH` | No           | Local SQLite location; defaults to `.steam-library/tracker.sqlite`.                 |
| `DASHBOARD_PORT`        | No           | Local dashboard API port; defaults to `4173`.                                       |
| `IGDB_CLIENT_ID`        | Optional     | Twitch developer client ID for IGDB metadata and last-resort dashboard covers.      |
| `IGDB_CLIENT_SECRET`    | Optional     | Twitch developer client secret for IGDB metadata and last-resort dashboard covers.  |

If `STEAM_WEBAPI_TOKEN` is absent or expires, Steam Families synchronization is skipped and the owned library continues to work. If the optional IGDB credentials are not set, metadata tools remain discoverable and return a safe `METADATA_UNAVAILABLE` result, while dashboard artwork simply skips the IGDB fallback. IGDB uses free Twitch developer credentials; no dashboard client receives them.

## Dashboard flows

The dashboard is a local view over the configured library and tracker:

- Load and synchronize the library, including Steam Families when its optional token is available.
- Filter the library and open a game's details.
- Update local status such as playing, completed, or dropped.
- Keep those status updates in the local tracker database; Steam account data remains unchanged.

## Tool surface

| Area             | Tools                                                                                                              | What they do                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Steam library    | `steam_get_library`, `steam_search_library`, `steam_get_game`, `steam_get_recent_games`, `steam_get_library_stats` | Read owned games and, when configured, available Steam Families games. |
| Local tracker    | `gaming_get_backlog`, `gaming_get_current_game`, `gaming_get_completed`                                            | List explicitly tracked local game states.                             |
| Local tracker    | `gaming_mark_playing`, `gaming_mark_completed`, `gaming_mark_dropped`                                              | Update local progress state; never writes to Steam.                    |
| Library metadata | `steam_get_game_metadata`, `steam_query_library_metadata`                                                          | Look up metadata for games available in the configured library.        |

## Local safety

> [!WARNING]
> `.env` contains secrets. Keep it untracked and local. Do not paste API keys or `STEAM_WEBAPI_TOKEN` into prompts, tool inputs, issue reports, or logs.

- stdout is reserved for MCP protocol traffic; operational diagnostics belong on stderr.
- Steam requests are read-only. The tracker is the only mutable component, and its SQLite database is local to this machine.
- Back up the tracker database before manual recovery or upgrades. If a migration or storage failure occurs, stop the server and restore a backup rather than deleting the database.
- Steam library reads are cached for five minutes per SteamID and use a 10-second upstream timeout. Safe errors do not expose request URLs, upstream payloads, tokens, or stack traces.

## Verify the project

Run the checks below before changing or publishing the server:

```sh
npm test -- --run
npm run typecheck
npm run lint
npm run format:check
```

## Steam Families

Steam's standard owned-games API does not include borrowed games. Set `STEAM_WEBAPI_TOKEN` only when you want the full Steam Families catalog. The token is temporary and the family endpoint is not formally documented by Steam, so the server treats family synchronization as optional and keeps working with your owned games when it is unavailable.
