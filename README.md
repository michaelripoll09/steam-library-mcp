# Steam Library MCP

Give an MCP client safe, read-only access to one Steam library, with explicit local game-progress tracking and optional owned-game metadata. The server runs over stdio and never changes Steam account data.

## Quick start

1. Install **Node.js 22+** and provide a Steam Web API key plus the 64-bit SteamID to query.
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

For development, `npm run dev` rebuilds the project and starts the server. Shell-provided environment variables take precedence over `.env`, so an MCP client can supply configuration through its own environment.

## Configuration

Start from the tracked [`.env.example`](.env.example) file. Do not copy real credentials into documentation, prompts, tool arguments, or logs.

| Variable                | Required     | Purpose                                                             |
| ----------------------- | ------------ | ------------------------------------------------------------------- |
| `STEAM_API_KEY`         | Yes          | Steam Web API credential used for library requests.                 |
| `STEAM_ID`              | Yes          | 64-bit SteamID of the single library to query.                      |
| `TRACKER_DATABASE_PATH` | No           | Local SQLite location; defaults to `.steam-library/tracker.sqlite`. |
| `IGDB_CLIENT_ID`        | For metadata | Twitch developer client ID for IGDB metadata tools.                 |
| `IGDB_CLIENT_SECRET`    | For metadata | Twitch developer client secret for IGDB metadata tools.             |

If the IGDB credentials are not set, the metadata tools remain discoverable and return a safe `METADATA_UNAVAILABLE` result. Steam library and local tracker tools continue to work.

## Tool surface

| Area                | Tools                                                                                                              | What they do                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Steam library       | `steam_get_library`, `steam_search_library`, `steam_get_game`, `steam_get_recent_games`, `steam_get_library_stats` | Read the configured library and its game activity.                  |
| Local tracker       | `gaming_get_backlog`, `gaming_get_current_game`, `gaming_get_completed`                                            | List explicitly tracked local game states.                          |
| Local tracker       | `gaming_mark_playing`, `gaming_mark_completed`, `gaming_mark_dropped`                                              | Update local progress state; never writes to Steam.                 |
| Owned-game metadata | `steam_get_game_metadata`, `steam_query_library_metadata`                                                          | Look up metadata only for games owned by the configured Steam user. |

## Local safety

> [!WARNING]
> `.env` contains secrets. Keep it untracked and local. Do not paste credentials into prompts, tool inputs, issue reports, or logs.

- stdout is reserved for MCP protocol traffic; operational diagnostics belong on stderr.
- Steam requests are read-only. The tracker is the only mutable component, and its SQLite database is local to this machine.
- Back up the tracker database before manual recovery or upgrades. If a migration or storage failure occurs, stop the server and restore a backup rather than deleting the database.
- Steam library reads are cached for five minutes per SteamID and use a 10-second upstream timeout. Safe errors do not expose request URLs, upstream payloads, or stack traces.

## Verify the project

Run the checks below before changing or publishing the server:

```sh
npm test -- --run
npm run typecheck
npm run lint
npm run format:check
```

## Architecture and scope

| Layer                                              | Responsibility                                            |
| -------------------------------------------------- | --------------------------------------------------------- |
| `src/server.ts` and `src/index.ts`                 | Compose and run the stdio MCP server.                     |
| `src/tools/`                                       | Register the Steam, tracker, and metadata tool contracts. |
| `src/steam/` and `src/services/steam-service.ts`   | Fetch and normalize read-only Steam library data.         |
| `src/tracker/`                                     | Persist explicit local progress state in SQLite.          |
| `src/igdb/` and `src/services/metadata-service.ts` | Fetch optional IGDB metadata for owned games.             |

This project intentionally supports one configured Steam library, explicit tracker status rather than playtime-based completion inference, and metadata for owned games only. It is not a Steam account management tool or a general game catalog service.
