# Delta for mcp-stdio-foundation

## MODIFIED Requirements

### Requirement: Secure configuration and errors

Configuration MUST validate SteamID and Steam API key as startup-blocking settings, and validate `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` for metadata use. Secrets, raw upstream payloads, authorization headers, and stack traces MUST NOT appear in logs or responses. Invalid IGDB configuration MUST leave the five Steam tools available while metadata tools return exactly `{ isError: true, error: { code: 'METADATA_UNAVAILABLE', message: string, retryable: boolean } }`.
(Previously: Every missing required setting caused startup failure.)

#### Scenario: Missing Steam setting
- GIVEN SteamID or Steam API key is absent or blank
- WHEN startup runs
- THEN startup fails with setting remediation and no secret values

#### Scenario: Missing IGDB credential
- GIVEN an IGDB credential is absent or blank
- WHEN startup runs and metadata is requested
- THEN the five Steam tools remain usable and metadata tools return the exact MCP error envelope `{ isError: true, error: { code: 'METADATA_UNAVAILABLE', message: string, retryable: boolean } }`
- AND no credential, token, header, or stack trace is disclosed

#### Scenario: Upstream failure
- GIVEN Steam or IGDB is unavailable, times out, rate-limits, or returns invalid data
- WHEN the failure is returned
- THEN the client receives an actionable safe error or partial result