# Tasks: Steam Library Core

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 700–950 lines across source, tests, configs, README |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR/base | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Tooling, config, domain | PR 1; base=feature/tracker | `npm test -- --run tests/config-domain.test.ts` | `npm run typecheck`; no network | Root configs and config/domain files |
| 2 | Steam boundary, TTL service | PR 2; base=PR 1 | `npm test -- --run tests/steam-client-service.test.ts` | Stubbed fetch: success, timeout, invalid DTO, expiry | `src/steam/`, `src/cache/`, `src/services/` and tests |
| 3 | Five MCP tools, stdio | PR 3; base=PR 2 | `npm test -- --run tests/tools-contract.test.ts` | In-memory MCP transport: list five tools, invoke one query | `src/tools/`, `src/server.ts`, `src/index.ts` and tests |
| 4 | Full verification, README | PR 4; base=PR 3 | `npm test && npm run typecheck && npm run lint && npm run format:check` | Spawn built stdio server; malformed frame, shutdown, redaction | E2E tests, README, quality-gate changes |

Each unit uses a conventional commit (for example `feat(config): validate Steam runtime settings`) and pushes after focused checks pass.

## Phase 1: Foundation / Strict TDD

- [x] 1.1 RED: add failing Vitest smoke test; GREEN: install Vitest and create package/ESM/TypeScript/quality configs; REFACTOR: set `openspec/config.yaml` strict_tdd=true and exact quality commands after installation.
- [x] 1.2 RED: test missing settings remediation and secret absence; GREEN: implement `src/config.ts`; REFACTOR: centralize constants/errors.
- [x] 1.3 RED: test stable models and hidden causes; GREEN: implement `src/domain/models.ts`/`src/errors.ts`; REFACTOR: enforce readonly and safe serialization.

## Phase 2: Steam Access / Service

- [x] 2.1 RED: test URL encoding, 10-second abort, HTTP/JSON/DTO failures, and no failure caching; GREEN: implement `src/steam/schemas.ts`/`client.ts`; REFACTOR: isolate fetch/clock.
- [x] 2.2 RED: test TTL hit/expiry, SteamID keying, and failed refresh; GREEN: implement `src/cache/ttl-cache.ts`; REFACTOR: simplify expiry.
- [x] 2.3 RED: test normalization, search, lookup, recent count, and stats; GREEN: implement `src/services/steam-service.ts`; REFACTOR: isolate DTOs.

## Phase 3: Tools / Stdio

- [x] 3.1 RED: test invalid search/appId/count never contacts Steam; GREEN: implement `src/tools/schemas.ts`; REFACTOR: share bounds.
- [x] 3.2 RED: contract-test five names, normalized outputs, safe errors; GREEN: implement `src/tools/register-steam-tools.ts`; REFACTOR: keep adapters thin.
- [x] 3.3 RED: test malformed frames, protocol-only stdout, shutdown errors, and no secrets; GREEN: implement `src/server.ts`/`src/index.ts`; REFACTOR: preserve injection.

## Phase 4: Verification / Documentation

- [x] 4.1 RED: add stdio E2E spawn and README setup/security tests; GREEN: complete `tests/**/*.test.ts`/`README.md`; REFACTOR: remove duplication.
- [x] 4.2 Run quality gates, record evidence, and push each verified commit; rollback only its named unit boundary.
