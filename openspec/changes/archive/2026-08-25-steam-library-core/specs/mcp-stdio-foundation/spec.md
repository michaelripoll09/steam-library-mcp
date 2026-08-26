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

Configuration MUST validate one SteamID and API key from environment variables. Secrets, raw upstream payloads, and stack traces MUST NOT appear in logs or responses; failures MUST state remediation.

#### Scenario: Missing key
- GIVEN the API key is absent
- WHEN configuration is reported
- THEN the message names setting and remediation
- AND contains no secret or unrelated value

#### Scenario: Upstream failure
- GIVEN Steam is unavailable during a tool call
- WHEN the failure is returned
- THEN the client receives actionable error without upstream details
