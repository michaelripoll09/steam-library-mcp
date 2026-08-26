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

## Cumulative Strict-TDD Evidence: Phases 1–3

This reconstruction merges the immutable native runtime ledger with the committed phase work units. It restores the cumulative record that the prior remediation-only artifact replaced; it does not claim new production behavior for the protocol-defaulted SDK field.

| Task | Test file / layer | Safety net | RED | GREEN | Triangulation | Refactor |
|---|---|---|---|---|---|---|
| 1.1 | `tests/igdb/client.test.ts` / unit-integration | New IGDB test file | ✅ `phase-1-igdb-boundary` recorded the expected focused failure because the IGDB modules were absent. | ✅ 19 focused tests passed; full suite 79 tests / 14 files passed. | ✅ Invalid config, OAuth schema, timeout, invalid payload, and one-retry 429 cases. | ✅ Injectable fetch, clock, and backoff preserved green checks. |
| 1.2 | `tests/igdb/client.test.ts` / unit-integration | Phase-1 focused suite clean after implementation | ✅ Same Phase-1 RED record covers the lazy configuration and IGDB boundary behavior. | ✅ Runtime ledger records 59 changed lines and a passed Phase-1 result. | ✅ Valid and invalid configuration plus upstream-failure paths. | ✅ Safe-message and validated-cache cleanup passed. |
| 1.3 | `tests/igdb/client.test.ts` / unit-integration | 19 focused tests passing | ✅ Phase-1 RED preserved in native runtime history. | ✅ Full suite 79/79 plus typecheck, lint, and format check passed. | ✅ Credential redaction and retry/backoff branches vary the external outcome. | ✅ `feat(metadata): add secure IGDB client boundary` (`691f6d9`). |
| 2.1 | `tests/services/metadata-service.test.ts` / unit | New service/domain test files | ✅ Task artifact records RED-first coverage for ownership, exact matching, cache, filters, and concurrency. | ✅ Focused metadata suite: 5 passed; full suite: 84 passed. | ✅ Owned/unowned, exact/leading-zero UID, tie-break, live/stale/missing, and concurrency cases. | ✅ Deterministic helpers isolated. |
| 2.2 | `tests/services/metadata-service.test.ts` / unit | Phase-2 focused suite clean after implementation | ✅ Task artifact records test-first service behavior. | ✅ Native ledger records a passed Phase-2 result. | ✅ Fresh, negative-expiry, stale fallback, and bounded-concurrency paths. | ✅ No ranking or recommendation fields introduced. |
| 2.3 | `tests/services/metadata-service.test.ts` / unit | 5 focused tests passing | ✅ Phase-2 RED-first task evidence retained by the checked task record. | ✅ Full suite 84/84 plus typecheck, lint, and format check passed. | ✅ Matching/filter helpers cover differing ownership and cache paths. | ✅ `feat(metadata): add owned normalization and cache` (`88963dc`). |
| 3.1 | `tests/tools/metadata-tools.test.ts`, `tests/server.test.ts` / MCP contract | Existing Steam/tracker contracts remained green | ✅ Task artifact records contract tests written before tool composition. | ✅ Phase-3 ledger records 85 tests and all quality checks passed. | ✅ Invalid input, metadata success/error, and unchanged Steam contracts. | ✅ MCP adapters remain thin. |
| 3.2 | `tests/tools/metadata-tools.test.ts`, `tests/server.test.ts` / MCP contract | Phase-3 suite clean after registration | ✅ Phase-3 RED-first task evidence retained by the checked task record. | ✅ Native ledger records 57 changed lines and a passed result. | ✅ Two metadata tools plus the unchanged eleven Steam/tracker tools. | ✅ README and server composition stayed aligned. |
| 3.3 | `tests/tools/metadata-tools.test.ts`, `tests/server.test.ts` / MCP contract | 85 tests passing | ✅ Phase-3 RED-first task evidence retained by the checked task record. | ✅ Full suite 85/85 plus quality checks passed. | ✅ Metadata discovery and input/error/success paths exercise distinct MCP outcomes. | ✅ `feat(metadata): expose owned game metadata tools` (`5980ba1`). |

## SDK Envelope Alignment Evidence

| Work unit | RED | GREEN | Triangulation | Refactor |
|---|---|---|---|---|
| V3 SDK-envelope specification alignment | ➖ No production change was authorized or needed: the official MCP SDK already materializes `content: []`. | ✅ `npm exec vitest run tests/server.test.ts` — 3 passed after adding the public in-memory MCP contract assertion. | ✅ The direct registrar test retains the raw top-level envelope while the in-memory MCP client test asserts the protocol-defaulted empty `content`. | ✅ Specification, design, task wording, and client-boundary test now use one protocol-compatible contract. |

## Current Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `npm exec vitest run tests/server.test.ts` — safety net 2 passed before the new contract test; 3 passed after it. |
| Runtime harness | In-memory MCP transport: unconfigured IGDB returns `{ content: [], isError: true, error: { code: "METADATA_UNAVAILABLE", message: "Configure IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to use metadata tools.", retryable: false } }`. |
| Rollback boundary | Revert the OpenSpec contract wording, `tests/server.test.ts`, and this cumulative evidence. No V1 Steam, V2 tracker, or metadata production behavior changes are included. |
