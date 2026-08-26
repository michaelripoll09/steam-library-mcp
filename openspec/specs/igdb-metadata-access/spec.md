# igdb-metadata-access Specification

## Purpose

Provide validated, normalized IGDB metadata only for games already owned in the configured Steam library.

## Requirements

### Requirement: Secure, non-blocking IGDB boundary

The client MUST use the free IGDB API tier with free Twitch developer credentials read only from `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET`, validate responses, enforce a 10-second timeout, and never expose credentials, headers, raw payloads, or stack traces. The public unavailable result MUST expose top-level `{ isError: true, error: { code: 'METADATA_UNAVAILABLE', message: string, retryable: boolean } }` without a text-wrapped or `structuredContent` error payload. At the MCP client boundary, the official SDK protocol-defaults `content` to `[]`; that empty array is permitted and expected. The solution MUST NOT require paid infrastructure. Invalid IGDB configuration MUST NOT prevent the five Steam tools from starting.

#### Scenario: Invalid IGDB configuration
- GIVEN either IGDB credential is absent or blank
- WHEN the server starts and metadata tools are called
- THEN all metadata tools remain discoverable and return `{ content: [], isError: true, error: { code: 'METADATA_UNAVAILABLE', message: string, retryable: boolean } }` at the MCP client boundary
- AND the five Steam tools remain usable

#### Scenario: Invalid upstream payload
- GIVEN IGDB returns a timeout, non-success status, invalid JSON, or schema-invalid payload
- WHEN metadata is requested
- THEN a safe actionable or partial result is returned and the invalid value is not cached

### Requirement: Ownership-gated canonical matching

The service MUST verify Steam ownership before querying IGDB and consider only records whose external-game category is `1` and whose UID exactly equals the decimal Steam app ID. If multiple records remain, it MUST select the lowest IGDB record ID; unowned IDs MUST NOT be queried.

#### Scenario: Exact owned match with tie
- GIVEN an owned app ID has multiple category-1 records with the same decimal UID
- WHEN metadata is fetched
- THEN only the record with the lowest IGDB ID is used

#### Scenario: Unowned or unmatched ID
- GIVEN an app ID is unowned or has no canonical match
- WHEN metadata is fetched
- THEN IGDB is not queried for an unowned ID and the result has `missing` status

### Requirement: Normalized metadata model

Returned metadata MUST contain Steam `appId`, name, unique trimmed arrays for genres, tags, and themes, nullable `releaseDate`, and status exactly `complete`, `partial`, or `missing`. Recommendation, ranking, and scoring fields MUST NOT exist.

#### Scenario: Optional fields
- GIVEN a matched record omits tags or release date
- WHEN it is normalized
- THEN arrays remain valid, `releaseDate` is null, and status is `partial`

### Requirement: Cache, rate limits, and concurrency

Positive metadata MUST use a 24-hour TTL; negative/missing results MUST use a 1-hour TTL; stale positive entries MAY be served for up to 7 days. At most four IGDB requests MAY execute concurrently. HTTP 429 MUST receive exactly two total attempts (initial request plus one retry) with bounded backoff, then map to stale data or safe `missing`/unavailable output.

#### Scenario: TTL and stale fallback
- GIVEN a positive, negative, or stale cached entry
- WHEN metadata is requested
- THEN fresh entries avoid IGDB, negative entries expire after one hour, and stale positives are served only within seven days

#### Scenario: Rate limit
- GIVEN IGDB returns HTTP 429
- WHEN the initial request and one retry are exhausted
- THEN no further retry occurs and only safe stale/missing/unavailable output is returned
