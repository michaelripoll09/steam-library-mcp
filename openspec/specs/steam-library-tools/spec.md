# steam-library-tools Specification

## Purpose

Expose Steam query tools alongside gaming tracker tools.

## Requirements

### Requirement: Exact query tool surface

The coordinated server MUST register the five Steam query tools—`steam_get_library`, `steam_search_library`, `steam_get_game`, `steam_get_recent_games`, and `steam_get_library_stats`—and MUST also register all six gaming tracker tools; each MUST validate arguments and return normalized output.

#### Scenario: Discovery
- GIVEN a connected MCP client
- WHEN it lists tools
- THEN the five Steam names and all six gaming tracker names appear exactly once, with no undocumented tool

#### Scenario: Query contracts
- GIVEN valid Steam data
- WHEN each Steam query runs
- THEN library/recent return normalized collections (library cached), search returns matches, game returns one or safe not-found, and stats returns aggregates

#### Scenario: Recent-game count
- GIVEN `steam_get_recent_games` is called without `count` or with an integer from 1 through 50
- WHEN the request is validated
- THEN omitted `count` defaults to 10 and supplied count limits results

#### Scenario: Invalid recent-game count
- GIVEN `count` is non-integer, below 1, or above 50
- WHEN `steam_get_recent_games` is called
- THEN validation returns an error and Steam is not contacted

### Requirement: Read-only input validation

All Steam tools MUST use the configured SteamID, be side-effect free, and reject invalid arguments before contacting Steam.

#### Scenario: Invalid arguments
- GIVEN an empty search term or non-positive app ID
- WHEN its tool is called
- THEN safe validation fails and Steam is not contacted
