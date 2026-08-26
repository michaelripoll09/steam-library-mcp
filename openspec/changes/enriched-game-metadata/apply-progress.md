# Apply Progress: Enriched Game Metadata

## Bounded V3 Metadata Contract Remediation

```yaml
schema: gentle-ai.remediation-result/v1
change: enriched-game-metadata
lineage_id: ""
generation: 7
fix_batch: 0
failed_evidence_revision: sha256:d55f84f4c25899a63957612d5a2e327125603303a6b510923904a92f88bbb747
mode: unmanaged
review_receipts: disabled
status: completed
```

```json
{"schema":"gentle-ai.remediation-evidence/v1","change":"enriched-game-metadata","lineage_id":"","generation":7,"fix_batch":0,"failed_evidence_revision":"sha256:d55f84f4c25899a63957612d5a2e327125603303a6b510923904a92f88bbb747","focused_test":{"command":"npm exec vitest run tests/tools/metadata-tools.test.ts tests/services/metadata-service.test.ts","result":"11 passed"},"full_verification":{"tests":"90 passed across 16 files","build":"passed","typecheck":"passed","lint":"passed","format_check":"passed"},"runtime_harness":{"scenario":"In-memory MCP metadata query returns the top-level METADATA_UNAVAILABLE fields without a text-wrapped error payload","result":"passed"},"rollback_boundary":"Revert the V3 metadata schema, service, adapter, tests, and design changes in this work unit; V1 Steam and V2 tracker tools remain intact."}
```

## Completed Work

- [x] Added `limit` to `steam_query_library_metadata`: integer 1–50, default 50, with post-filter truncation.
- [x] Passed `METADATA_UNAVAILABLE` through metadata adapters as the exact top-level service envelope; successful results retain normal MCP text content.
- [x] Added strict-TDD coverage for partial metadata, negative-cache expiry, seven-day stale cutoff, successful query payload/default limit, invalid year ranges, and bounds validation.
- [x] Corrected the design contract to the unified thirteen-tool surface: five Steam, six tracker, and two metadata tools.

## TDD Cycle Evidence

| Work unit | RED | GREEN | REFACTOR |
|---|---|---|---|
| V3 metadata contract remediation | `npm exec vitest run tests/tools/metadata-tools.test.ts tests/services/metadata-service.test.ts` failed with four expected contract gaps: missing `limit`, unwrapped unavailable envelope, no truncation, and stale/negative cache boundary coverage. | The same focused suite passed 11 tests after the minimal schema/service/adapter implementation. | Prettier completed; the full suite, build, typecheck, lint, and format check passed. |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `npm exec vitest run tests/tools/metadata-tools.test.ts tests/services/metadata-service.test.ts` — 11 passed. |
| Runtime harness | In-memory MCP `steam_query_library_metadata` probe returned `isError`, `error.code`, `error.message`, and `error.retryable` at the top level; no text-wrapped error payload. |
| Rollback boundary | Revert `src/tools/schemas.ts`, `src/domain/metadata.ts`, `src/services/metadata-service.ts`, `src/tools/register-metadata-tools.ts`, the two test files, and `design.md`; V1/V2 behavior remains. |