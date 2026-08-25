# Steam Library MCP

A read-only [Model Context Protocol](https://modelcontextprotocol.io/) server for a
single Steam library. It exposes exactly five library-query tools over stdio:

- `steam_get_library`
- `steam_search_library`
- `steam_get_game`
- `steam_get_recent_games`
- `steam_get_library_stats`

The server does not modify Steam data, track personal game state, or provide IGDB
metadata.

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
