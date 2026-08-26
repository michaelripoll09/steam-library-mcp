# Delta for steam-library-tools

## MODIFIED Requirements

### Requirement: Exact query tool surface

The server MUST register exactly thirteen tools: the five read-only Steam library tools, six existing explicit local tracker tools, and `steam_get_game_metadata` plus `steam_query_library_metadata`. Metadata tools MUST remain discoverable even when IGDB configuration is invalid; no recommendation, ranking, or unowned-game tool may be registered.
(Previously: Eleven Steam and tracker tools were registered.)

#### Scenario: Discovery
- GIVEN a connected MCP client
- WHEN it lists tools
- THEN exactly the complete thirteen-tool surface appears, including metadata tools regardless of IGDB configuration

#### Scenario: Existing query contracts
- GIVEN valid Steam data
- WHEN an original query runs
- THEN its existing normalized collection, item, recent-count, and stats behavior is preserved

#### Scenario: Invalid recent-game count
- GIVEN `count` is non-integer, below 1, or above 50
- WHEN `steam_get_recent_games` is called
- THEN validation returns an error and Steam is not contacted

### Requirement: Read-only input validation

All tools MUST use the configured SteamID, be side-effect free, and reject invalid arguments before contacting Steam or IGDB.
(Previously: Validation applied to the five original Steam tools before contacting Steam.)

#### Scenario: Invalid arguments
- GIVEN an empty search term, non-positive app ID, empty metadata filter, or invalid year range
- WHEN its tool is called
- THEN safe validation fails and no upstream service is contacted

### Requirement: Owned metadata tool contracts

`steam_get_game_metadata` MUST accept `{appId: positive integer}`. `steam_query_library_metadata` MUST accept optional plural `genres`, `tags`, and `themes` string arrays, inclusive `releaseYearFrom`/`releaseYearTo`, and `limit` from 1–50 (default 50). Both return normalized owned metadata or an unavailable result with top-level `{ isError: true, error: { code: 'METADATA_UNAVAILABLE', message: string, retryable: boolean } }`; at the MCP client boundary the official SDK protocol-defaults `content: []`, and text-wrapped or `structuredContent` error payloads are forbidden. Success payloads carry metadataStatus `missing` when appropriate, never recommendations; query filters are case-insensitive, OR within each field and AND across fields, with app-ID ordering. An all-absent or all-empty filter query MUST be rejected.

#### Scenario: Valid metadata queries
- GIVEN valid arguments and owned games with normalized metadata
- WHEN either metadata tool runs
- THEN it returns a success payload with metadataStatus exactly `complete`, `partial`, or `missing` and nullable `releaseDate`

#### Scenario: Invalid IGDB configuration
- GIVEN metadata tools are called while IGDB configuration is invalid
- WHEN execution occurs
- THEN `{ content: [], isError: true, error: { code: 'METADATA_UNAVAILABLE', message: string, retryable: boolean } }` is returned at the MCP client boundary and Steam tools remain unaffected

#### Scenario: All filters absent
- GIVEN steam_query_library_metadata receives no filter values
- WHEN execution occurs
- THEN validation rejects the request before Steam or IGDB is contacted
