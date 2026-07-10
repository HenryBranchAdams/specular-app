# Task 4 Report: Stateless Model Service, Repair Flow, Safety, and Privacy Controls

## Status

Implemented and verified. Task 4 adds a separately built stateless model service with strict native HTTP boundaries, a real server-only OpenAI Responses adapter, one bounded repair attempt, conservative safety handling, privacy-safe operational telemetry, and no production deterministic model fallback.

Commit subject: `feat: add stateless Specular model service`

Henry chose to continue without live API access. No credential was created, requested, inspected, or used, and no live model call was made. Production without `OPENAI_API_KEY` reports typed `provider_unavailable`.

## TDD Evidence

### Initial RED

Command:

```bash
npm run test -- server/http.test.ts
```

Result: exit 1. Vitest failed before collecting tests because the wished-for server boundary did not exist:

```text
FAIL  server/http.test.ts [ server/http.test.ts ]
Error: Failed to resolve import "./config" from "server/http.test.ts".
Test Files  1 failed (1)
Tests  no tests
```

### Initial GREEN

The first complete native-HTTP/service contract passed:

```text
Test Files  1 passed (1)
Tests  27 passed (27)
```

### Review-driven RED/GREEN

Independent review and direct SDK-boundary testing exposed issues that injected operation-provider tests could not reveal. Regression tests were added before each correction.

The combined focused RED was:

```text
Test Files  1 failed (1)
Tests  11 failed | 36 passed (47)
```

The 11 failures proved:

1. Shared optional next-question fields were incompatible with SDK 6.46 strict structured-output conversion.
2. The shared root Challenge union produced a root `anyOf`, which is not a valid strict Responses root schema.
3. Empty/null SDK output was not a typed provider failure.
4. Non-completed SDK statuses were translated before the intended typed status classifier.
5. `other`-region safety guidance failed the one-setup-sentence product validator.
6. Three high-confidence imminent-danger phrasings were missed.
7. Historical/negated self-harm references produced two false safety positives.
8. `invalid_output` was not marked recoverable.
9. Rate-limit address state was not bounded.

The fixes produced the final focused GREEN:

```text
Test Files  1 passed (1)
Tests  47 passed (47)
```

The independent narrow re-review then approved all five prior Critical/Important finding groups with no remaining issue.

## Implemented Behavior

### Strict stateless HTTP boundary

- Implements only `POST /api/operations/next-question`, `/challenge`, and `/conclusion`, plus non-billable `GET /healthz` and `/readyz`.
- Accepts the exact strict `{ context }` body, validates the shared bounded `ThreadContext`, and rejects operation/path mismatches.
- Rejects unknown fields, malformed JSON, unsupported content types, query-bearing operation URLs, oversized declared or streamed bodies, unsafe methods, and unknown paths.
- Keeps one deadline active across request-body receipt and provider completion; an abort-ignoring injected provider still resolves externally as typed timeout.
- Applies exact-origin CORS, bounded preflight, CSP, `nosniff`, no-referrer, permissions policy, no-store, request ids, rate limiting, and safe method/path handling.
- Bounds the in-memory rate limiter to 10,000 address keys by default and prunes expired/oldest entries before admitting additional unique addresses.
- Returns only strict client envelopes: `{ ok: true, value }` or `{ ok: false, error }` using canonical error codes.

### Server-only OpenAI adapter

- Uses installed `openai@6.46.0`, the Responses API, and `zodTextFormat`; `OPENAI_MODEL` defaults to `gpt-5.5` and remains environment-overridable.
- Sends bounded output-token budgets, `store: false`, and a 64-character HMAC safety identifier derived from thread identity with a process-private random secret. Authored text is never used as the identifier.
- Uses provider-specific strict API schemas where the canonical client result shape cannot directly satisfy Responses constraints:
  - next-question makes `setup` required-nullable at the API boundary and maps null back to the canonical omitted optional field;
  - Challenge uses a root object with required-nullable `counterPosition` and maps it back to the canonical discriminated union.
- Parses API output through those strict schemas and then through shared result schemas before deterministic product validation.
- Keeps malformed JSON or invalid structured values ephemeral for exactly one repair attempt; the repair prompt receives the invalid value and stable validator codes, never validator messages.
- Treats null/empty output, refusal, incomplete responses, failed/non-completed statuses, timeout, and SDK/provider errors as typed failures without leaking raw output.
- Does not instantiate the SDK client without a key and never selects a deterministic provider as a production fallback.

### Repair and metadata flow

- Valid output is returned with zero repair attempts.
- JSON/schema/product-invalid output receives exactly one repair attempt.
- A second invalid result returns typed recoverable `invalid_output` and never returns the invalid candidate or raw provider text.
- Operational metadata is restricted to request id, operation, latency, provider/model id, token usage when available, schema outcome, repair count, status, and typed error code.
- Metadata sink failures cannot alter the private request result. No prompt, transcript, conclusion, authored text, request body, repair value, or raw model output is logged or persisted.
- The server imports no client storage or content repository.

### Conservative safety path

- High-confidence immediate self-harm intent bypasses the provider and returns a schema-valid response for next-question, Challenge, and conclusion operations.
- Guidance is non-diagnostic, preserves user authority and the ability to continue, includes configured-region immediate-danger resources, and asks one concrete no-why next-step question.
- AU, CA, EU, GB, US, and fallback-region outputs all pass the canonical deterministic validators.
- Explicit regression cases cover direct suicide intent, imminent overdose means/intent, weapon means/intent, historical disclosure, negated intent, and ordinary emotionally charged content.

## Scripts and Build

- `dev:server` rebuilds and runs the stateless service under Node watch without adding another runtime dependency.
- `build:server` emits the separate immutable `dist-server/index.js` artifact through `vite.server.config.ts`.
- `start` runs only that compiled service.
- `audit` runs `npm audit --omit=dev`.
- `validate` now includes both the client and server production builds.
- The prototype `server.js`, `chatgpt:server`, and `chatgpt:inspect` remain unchanged for the Task 7 cutover.

## Verification Results

### Focused server suite

```text
npm run test -- server/http.test.ts
Test Files  1 passed (1)
Tests  47 passed (47)
```

### Full validation

```text
npm run validate
Test Files  6 passed (6)
Tests  157 passed (157)
client build: PASS
server build: PASS (dist-server/index.js, 51.12 kB)
```

Typecheck and ESLint both pass with the server included in `tsconfig.node.json`.

### Compiled no-key probe

The final compiled service was started with an explicitly empty key:

```text
GET /healthz -> 200 {"ok":true,"value":{"status":"healthy"}}
GET /readyz -> 503 {"ok":false,"error":{"code":"provider_unavailable",...}}
```

No model call occurred. A prior compiled operation probe also returned typed `provider_unavailable` with exact allowed-origin CORS and emitted only the fixed metadata fields.

### Development and legacy compatibility probes

- `dev:server` rebuilt and served `/healthz` successfully.
- The preserved prototype `chatgpt:server` served its root compatibility message.
- A bounded MCP `initialize` request returned protocol `2025-06-18`, Specular server info, and its tools/resources capabilities.

## Files

- `server/config.ts`: bounded environment parsing and exact-origin configuration.
- `server/http.ts`: native HTTP routing, envelopes, CORS/security headers, request bounds, timeout, and readiness.
- `server/openai-provider.ts`: real SDK Responses adapter and provider-specific strict schema mapping.
- `server/operation-service.ts`: safety dispatch, one repair, typed failure mapping, safety pseudonym, and metadata emission.
- `server/prompts.ts`: bounded initial/repair prompts and product invariants.
- `server/telemetry.ts`: fixed privacy-safe metadata contract and sinks.
- `server/rate-limit.ts`: bounded ephemeral in-memory limiter.
- `server/safety.ts`: conservative high-confidence detection and configured-region responses.
- `server/http.test.ts`: native HTTP, service, adapter, privacy, safety, and limiter regressions.
- `vite.server.config.ts`, `scripts/dev-model-server.mjs`: separate server build/development path.

## Self-review

- Confirmed every Task 4 HTTP, repair, safety, security-header, readiness, and privacy requirement has direct behavior evidence.
- Confirmed provider-specific API shapes map back to the unchanged canonical client `QuestioningProvider` result contracts.
- Confirmed `server.js` and both legacy ChatGPT scripts remain unchanged and runnable.
- Confirmed Task 5+ UI, MCP integration, and Realtime features were not implemented.
- Confirmed imports remain at module top and discriminated-union/enum switches use exhaustive `never` handling.
- Confirmed the spec, implementation plan, and progress ledger were not modified.
- Confirmed `git diff --check`, focused tests, typecheck, lint, full tests, both builds, compiled no-key probes, and bounded legacy MCP initialization are clean.

## Concerns

`npm run audit` exits 1 on two inherited high-severity dependency groups already documented before Task 4:

- Hono `<=4.12.24`: GHSA-wwfh-h76j-fc44, GHSA-j6c9-x7qj-28xf, GHSA-88fw-hqm2-52qc, GHSA-rv63-4mwf-qqc2, and GHSA-wgpf-jwqj-8h8p. A non-forced audit fix is available.
- Vite `8.0.0`–`8.0.15`: GHSA-v6wh-96g9-6wx3 and GHSA-fx2h-pf6j-xcff. npm reports that the available fix moves outside the stated dependency range and requires `--force`.

These advisories were not introduced by Task 4. No live OpenAI smoke was run because a credential remains intentionally unavailable; readiness correctly reflects that state.
