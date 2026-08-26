# mcp-stdio-foundation Specification

## Purpose

MCP stdio.

## Requirements

### Requirement: Stdio lifecycle

The server MUST run strict TypeScript on Node.js LTS, use the MCP SDK over stdio, keep protocol traffic on stdout, register supported tools, and shut down.

#### Scenario: Valid launch
- GIVEN valid configuration and an MCP client
- WHEN the process initializes
- THEN MCP initializes and tools are listed
- AND stdout contains no diagnostics or secrets

#### Scenario: Invalid configuration
- GIVEN a required setting is missing or blank
- WHEN the process starts
- THEN startup fails without serving requests

### Requirement: Secure configuration and errors

Configuration MUST validate SteamID and Steam API key as startup-blocking settings, and validate `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` for metadata use. Secrets, raw upstream payloads, authorization headers, and stack traces MUST NOT appear in logs or responses. Invalid IGDB configuration MUST leave the five Steam tools available while metadata tools return top-level `{ isError: true, error: { code: 'METADATA_UNAVAILABLE', message: string, retryable: boolean } }`; the official MCP SDK's protocol-defaulted `content: []` is permitted, while text-wrapped or `structuredContent` error payloads are forbidden.
(Previously: Every missing required setting caused startup failure.)

#### Scenario: Missing Steam setting
- GIVEN SteamID or Steam API key is absent or blank
- WHEN startup runs
- THEN startup fails with setting remediation and no secret values

#### Scenario: Missing IGDB credential
- GIVEN an IGDB credential is absent or blank
- WHEN startup runs and metadata is requested
- THEN the five Steam tools remain usable and metadata tools return `{ content: [], isError: true, error: { code: 'METADATA_UNAVAILABLE', message: string, retryable: boolean } }` at the MCP client boundary
- AND no credential, token, header, or stack trace is disclosed

#### Scenario: Upstream failure
- GIVEN Steam or IGDB is unavailable, times out, rate-limits, or returns invalid data
- WHEN the failure is returned
- THEN the client receives an actionable safe error or partial result
