# Proposal: Steam Library Core

## Intent

Create a public, read-only MCP server through which one configured Steam user can query owned and recently played games without exposing credentials or upstream response details.

## Scope

### In Scope
- TypeScript/Node LTS stdio server using the official MCP SDK, Zod, native `fetch`, strict TypeScript, ESLint, Prettier, and Vitest.
- Environment configuration for one SteamID and Steam Web API key; secrets are never returned or logged.
- Steam Web API client behind a service layer with a 10-second timeout, safe errors, and normalized stable domain models.
- Tools: `steam_get_library`, `steam_search_library`, `steam_get_game`, `steam_get_recent_games`, and `steam_get_library_stats`.
- Five-minute library cache, TDD, and small behavior-oriented commits that include their tests.

### Out of Scope
- Recommendations, databases, multi-user authentication, scraping, achievements, reviews, prices, and wishlist data.
- Personal tracker and IGDB enrichment: separately planned sibling workstreams for the same coordinated release.

## Capabilities

### New Capabilities
- `mcp-stdio-foundation`: Server lifecycle, stdio transport, validated configuration, and safe tool errors.
- `steam-library-access`: Read-only Steam API integration, normalized game/library models, timeout behavior, and five-minute caching.
- `steam-library-tools`: Contracts and behavior for the five library query and statistics tools.

### Modified Capabilities
- None.

## Approach

Separate MCP adapters, application services, and the Steam API client. Validate boundaries with Zod, normalize upstream data, and test each behavior before implementation. Keep commits independently reviewable and reversible.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| Root configs | New | Runtime and quality tooling |
| `src/` | New | Server, domain, services, client, cache, and tools |
| `tests/` | New | Unit and contract coverage |
| `README.md` | New | Setup, tools, and security guidance |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Steam failures or schema drift | Medium | Timeout, Zod boundary validation, normalization, and safe errors |
| Secret disclosure | Low | Environment-only secrets and redaction-focused tests |
| Stale or cross-request cache data | Low | Single-SteamID cache keying and fixed five-minute TTL |

## Rollback Plan

Revert the work-unit commits for this change; no migration or persistent data rollback is required.

## Dependencies

- Steam Web API availability, API key, and configured SteamID.
- Node.js LTS and the official MCP TypeScript SDK.

## Success Criteria

- [ ] All five tools return validated, stable read-only results over stdio for the configured SteamID.
- [ ] Requests time out after 10 seconds and expose safe actionable errors without credentials.
- [ ] Library reads reuse cached data for five minutes.
- [ ] Tests, type checking, linting, and formatting pass; public setup and tool contracts are documented.
