# Proposal: Enriched Game Metadata

## Intent

Give client LLMs reliable genre, tag, and release-date context for games the configured Steam user already owns, without embedding recommendation logic or exposing third-party credentials.

## Scope

### In Scope
- Documented IGDB client using environment-only credentials, Zod response validation, bounded timeouts, and redacted actionable errors.
- Steam-app-ID-based matching restricted to owned games, with normalized genres, tags/themes, and optional release dates.
- Read-only MCP tools to fetch one owned game's metadata and query owned-library metadata by structured filters.
- Cache with explicit TTL plus resilient handling of IGDB rate limits, including bounded retry/backoff guidance and safe partial/missing metadata.
- TDD and behavior-oriented work-unit commits that keep implementation, tests, and relevant documentation together.

### Out of Scope
- Server-side recommendations, scoring, ranking, personalization, or discovery of unowned games.
- SQLite tracking, gameplay status, notes, ratings, or any tracker implementation.
- Steam core ingestion changes beyond integration required to verify ownership.

## Capabilities

### New Capabilities
- `igdb-metadata-access`: Secure IGDB configuration, validated client behavior, owned-game matching, normalization, caching, and rate-limit resilience.

### Modified Capabilities
- `mcp-stdio-foundation`: Validate IGDB environment configuration and preserve secret-safe startup/tool errors.
- `steam-library-tools`: Add read-only owned-game metadata lookup and structured owned-library metadata query contracts; no recommendation output.

## Approach

Place IGDB behind a typed client and metadata service. Resolve IGDB records through Steam external app IDs only after ownership is established by the Steam library service. Normalize optional metadata before exposing it through MCP adapters. Use injectable clock/fetch dependencies for deterministic timeout, cache, and rate-limit tests. Deliver as reversible work units: client/config; normalization/cache; MCP tools/docs, with tests in each commit.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/clients/`, `src/config/` | New/Modified | IGDB client and secure configuration |
| `src/domain/`, `src/services/` | New | Normalization, ownership gate, cache |
| `src/tools/` | Modified | Read-only metadata query tools |
| `tests/`, `README.md` | Modified | TDD coverage and public setup/contracts |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| IGDB throttling/outage | Medium | TTL cache, bounded retry/backoff, safe partial results |
| Incorrect cross-catalog match | Medium | Match only Steam external app IDs and verify ownership |
| Credential leakage | Low | Environment-only secrets and redaction tests |

## Rollback Plan

Revert the independent metadata work-unit commits and unregister the added tools; Steam core behavior and persisted user data remain unchanged.

## Dependencies

- Steam library core ownership lookup.
- IGDB/Twitch credentials and API availability.

## Success Criteria

- [ ] Only owned Steam games can produce normalized metadata through the new tools.
- [ ] Timeout, invalid payload, rate-limit, missing-match, and credential paths return documented safe behavior.
- [ ] Cache behavior and metadata contracts are covered by deterministic tests.
- [ ] No server-side recommendation, ranking, or SQLite tracker behavior exists.
