```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:d55f84f4c25899a63957612d5a2e327125603303a6b510923904a92f88bbb747
verdict: fail
blockers: 2
critical_findings: 2
requirements: 2/8
scenarios: 10/17
test_command: npm test -- --run
test_exit_code: 0
test_output_hash: sha256:6709a75392d2c20f6fe8d315a51d12abc85414920f61214e019918d3c051d3ad
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:4ba76617703fba57c44d11651044d3cacabf68c310c37df491da107ffa6b8638
```

## Verification Report

**Change**: enriched-game-metadata
**Version**: N/A
**Mode**: Standard
**Candidate**: `bdaf25b61acfd07d3fcc5f30873c70e9bdffa6c0`

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 9 |
| Tasks complete | 9 |
| Tasks incomplete | 0 |
| Requirements compliant | 2/8 |
| Scenarios compliant | 10/17 |

### Build & Tests Execution

**Tests**: ✅ 85 passed, 0 failed, 0 skipped across 16 files.
```text
npm test -- --run
Test Files  16 passed (16)
Tests       85 passed (85)
Exit code: 0
Output hash: sha256:6709a75392d2c20f6fe8d315a51d12abc85414920f61214e019918d3c051d3ad
```

**Build**: ✅ Passed.
```text
npm run build
Exit code: 0
Output hash: sha256:4ba76617703fba57c44d11651044d3cacabf68c310c37df491da107ffa6b8638
```

**Typecheck**: ✅ Passed (`npm run typecheck`, exit 0, `sha256:8d0a0e2fcc49cd57cb7d7a551498a06e0f45613af63eb4f1feb97404b2f42204`).

**Lint**: ✅ Passed (`npm run lint`, exit 0, `sha256:86106d1a1fa6f72b28f5f37b20e6cdb975959478abf0a1066ccec1d255c3545e`).

**Format check**: ✅ Passed (`npm run format:check`, exit 0, `sha256:a107e8d482175e58ea2be2676533cac6d44a6160f242fc25e81c9e0c4f2ad7cd`). The non-mutating check was used because verification must not alter production behavior.

**Coverage**: ➖ Not configured.

### Spec Compliance Matrix
| Requirement | Scenario | Test / runtime evidence | Result |
|-------------|----------|-------------------------|--------|
| Secure, non-blocking IGDB boundary | Invalid IGDB configuration | In-memory MCP probe against built server returned `{content:[...]}` rather than the mandated top-level envelope | ❌ FAILING |
| Secure, non-blocking IGDB boundary | Invalid upstream payload | `tests/igdb/client.test.ts` invalid-payload and timeout cases | ✅ COMPLIANT |
| Ownership-gated canonical matching | Exact owned match with tie | `tests/services/metadata-service.test.ts` lowest exact category-1 match | ✅ COMPLIANT |
| Ownership-gated canonical matching | Unowned or unmatched ID | service ownership-before-IGDB test plus normalization/match tests | ✅ COMPLIANT |
| Normalized metadata model | Optional fields | No runtime test for a matched record with omitted tags or release date | ❌ UNTESTED |
| Cache, rate limits, and concurrency | TTL and stale fallback | Positive 24-hour freshness and stale fallback pass; negative one-hour expiry and seven-day stale cutoff are untested | ⚠️ PARTIAL |
| Cache, rate limits, and concurrency | Rate limit | `tests/igdb/client.test.ts` proves one retry only; service test proves stale fallback | ✅ COMPLIANT |
| Secure configuration and errors | Missing Steam setting | `tests/config-domain.test.ts` startup-blocking missing/blank Steam settings | ✅ COMPLIANT |
| Secure configuration and errors | Missing IGDB credential | Built MCP probe proves metadata response shape contradicts exact contract | ❌ FAILING |
| Secure configuration and errors | Upstream failure | timeout, 429, invalid payload, and redaction tests pass | ✅ COMPLIANT |
| Exact query tool surface | Discovery | `tests/server.test.ts` lists exactly 13 Steam/tracker/metadata tools | ✅ COMPLIANT |
| Exact query tool surface | Existing query contracts | `tests/tools-contract.test.ts` and `tests/server.test.ts` preserve original query behavior | ✅ COMPLIANT |
| Exact query tool surface | Invalid recent-game count | `tests/tools-contract.test.ts` rejects invalid count before Steam | ✅ COMPLIANT |
| Read-only input validation | Invalid arguments | Blank/appId/filter validation exists; invalid metadata year-range runtime coverage is missing | ⚠️ PARTIAL |
| Owned metadata tool contracts | Valid metadata queries | No MCP success-path contract test; required `limit` is absent from schema and service | ❌ FAILING |
| Owned metadata tool contracts | Invalid IGDB configuration | Built MCP probe returns content-wrapped success result, not exact top-level error | ❌ FAILING |
| Owned metadata tool contracts | All filters absent | `tests/tools/metadata-tools.test.ts` rejects before service invocation | ✅ COMPLIANT |

**Compliance summary**: 10/17 scenarios compliant.

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| Unified 13-tool surface | ✅ Implemented | Five Steam, six tracker, and two metadata tools are registered and runtime discovery passes. |
| Environment-only IGDB credentials and 10-second timeout | ✅ Implemented | Lazy config, OAuth provider, client timeout, schema validation, and redacted envelopes are present. |
| Exact Steam external-ID match | ✅ Implemented | Category `1`, exact decimal UID, and lowest IGDB ID selection are explicit. |
| Normalization and no recommendation fields | ✅ Implemented | Stable arrays, nullable date, status, missing reason, and cache state only. |
| Cache and concurrency | ⚠️ Partially proven | Constants implement 24h/1h/7d and concurrency four, but boundary tests are incomplete. |
| Metadata query `limit` | ❌ Missing | `metadataQueryInputSchema` rejects `limit`, `MetadataQuery` has no `limit`, and `queryOwnedMetadata` never truncates/defaults to 50. |
| Exact metadata unavailable tool envelope | ❌ Incorrect | `register-metadata-tools.ts` always wraps resolved service values in MCP `content`; disabled metadata therefore is not returned as the exact top-level envelope required by the spec. |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| MCP adapter → metadata service → Steam + IGDB | ✅ Yes | Composition follows the documented boundary. |
| Ownership before IGDB | ✅ Yes | `getGame` completes before the IGDB call. |
| Exact match and deterministic tie-break | ✅ Yes | Implemented and tested. |
| TTL/cache/concurrency policy | ⚠️ Partial evidence | Implementation matches constants; negative expiry and hard stale cutoff lack runtime proof. |
| Metadata tool contract | ❌ No | Required `limit` and exact unavailable envelope are not implemented. |
| Unified tool surface documentation | ⚠️ Stale design | Approved spec and runtime use 13 tools, while `design.md` still states seven tools and its test strategy also references seven-tool discovery. |

### Issues Found

**CRITICAL**
1. `steam_query_library_metadata` does not implement its required `limit` input (1–50, default 50) or truncation. The schema is strict, so a contract-valid request containing `limit` is rejected.
2. Metadata unavailability is not exposed using the mandated exact top-level envelope. A built in-memory MCP call with missing IGDB credentials returned `{"content":[{"type":"text","text":"{\"isError\":true,...}"}]}`, with no top-level `isError`, while the spec explicitly forbids content/structuredContent variants.

**WARNING**
1. Scenario coverage is incomplete for optional-field partial normalization, negative-cache one-hour expiry, seven-day stale cutoff, metadata query success payloads, and invalid year ranges.
2. `design.md` was not updated to the approved unified 13-tool surface and still says seven tools.

**SUGGESTION**
1. Add a full in-memory MCP contract suite for both metadata tools, asserting success shapes, exact unavailable shape, filter semantics, ordering, and default/explicit limits.

### Verdict

**FAIL**

The unified thirteen-tool discovery and all repository quality commands pass, but two normative metadata contracts are not implemented. Remediation is required before archive.
