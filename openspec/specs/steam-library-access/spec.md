# steam-library-access Specification

## Purpose

Provide normalized Steam data.

## Requirements

### Requirement: Validated API boundary

The Steam client MUST enforce a 10-second timeout and Zod-validate responses before use.

#### Scenario: Valid response
- GIVEN a successful schema-conforming Steam response
- WHEN it is processed
- THEN normalized domain data is returned

#### Scenario: Timeout, HTTP, or schema failure
- GIVEN a timeout, non-success status, or invalid JSON
- WHEN it is processed
- THEN a safe error is returned and not cached

### Requirement: Stable normalized models

Models MUST expose stable IDs, names, playtime, and optional recent timestamps; unknown fields MUST be omitted.

#### Scenario: Optional fields absent
- GIVEN valid data omits an optional playtime or image field
- WHEN it is normalized
- THEN identity remains usable and the optional value uses its documented empty form

### Requirement: Five-minute cache

Library data MUST be cached per SteamID for five minutes: fresh hits avoid requests, expiry refreshes, and failed refreshes do not replace valid data.

#### Scenario: Hit then expiry
- GIVEN data was fetched for the configured SteamID
- WHEN read within five minutes, THEN cached data is returned
- WHEN read after expiry, THEN fresh data is fetched

#### Scenario: Refresh failure
- GIVEN an expired entry and a failed refresh
- WHEN a read occurs
- THEN a safe error is returned and no partial value is stored
