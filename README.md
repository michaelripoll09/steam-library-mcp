# Steam Library MCP

A [Model Context Protocol](https://modelcontextprotocol.io/) server for a
single Steam library with explicit local game-progress tracking and owned-game metadata. It exposes thirteen tools over stdio:

- `steam_get_library`
- `steam_search_library`
- `steam_get_game`
- `steam_get_recent_games`
- `steam_get_library_stats`
- `gaming_get_backlog`, `gaming_get_current_game`, and `gaming_get_completed`
- `gaming_mark_playing`, `gaming_mark_completed`, and `gaming_mark_dropped`
- `steam_get_game_metadata` and `steam_query_library_metadata`

The server does not modify Steam data or infer completion from playtime. Tracker state is explicit and local; metadata only describes games the configured Steam user owns.

## Requirements

- Node.js 22 or newer
- A Steam Web API key
- The 64-bit SteamID for the library to query

## Install and run

Install dependencies and compile the production entrypoint:

```sh
npm install
npm run build
```

Set the required environment variables in your MCP client configuration or shell:

```sh
STEAM_API_KEY=replace-with-your-Steam-Web-API-key
STEAM_ID=76561198000000000
# Optional; defaults to .steam-library/tracker.sqlite
TRACKER_DATABASE_PATH=.steam-library/tracker.sqlite
# Optional free Twitch developer credentials for IGDB metadata tools
IGDB_CLIENT_ID=replace-with-your-Twitch-client-id
IGDB_CLIENT_SECRET=replace-with-your-Twitch-client-secret
```

Start the stdio server with:

```sh
node dist/index.js
```

For local development and verification, use:

```sh
npm test -- --run
npm run typecheck
npm run lint
npm run format:check
```

## Security and protocol behavior

`STEAM_API_KEY` is a credential. Keep it in your MCP client configuration or a
local environment file that is not committed to source control. Do not place it
in prompts, tool arguments, or logs.

The process uses stdout exclusively for MCP protocol traffic. Operational
diagnostics must not be written to stdout, and configuration failures do not
print API keys or other secrets. Tool responses are normalized and safe; they do
not expose Steam response payloads, request URLs, or stack traces.

Library reads are cached for five minutes per configured SteamID. The server
uses a 10-second upstream request timeout and returns actionable safe errors
when Steam is unavailable or returns invalid data.

IGDB metadata uses the free Twitch developer credential flow. When either IGDB credential is absent, both metadata tools remain discoverable and return a safe `METADATA_UNAVAILABLE` result; Steam and tracker tools continue to work. To roll back metadata, unset both IGDB variables and revert the metadata work-unit commits without touching Steam credentials or the tracker database.

## Local tracker storage and recovery

Tracker state is stored in a local SQLite database at `TRACKER_DATABASE_PATH`.
Back up the database file before upgrades or manual recovery. If startup reports
a migration or storage failure, stop the server, restore the most recent backup,
and restart; never delete the database automatically. The default `.steam-library/`
directory is ignored by Git.
