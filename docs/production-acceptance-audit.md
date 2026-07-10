# Specular Production Acceptance Audit

**Audit date:** 2026-07-10  
**Specification:** `docs/superpowers/specs/2026-07-09-specular-production-design.md`  
**Policy:** A criterion is accepted only with current, named evidence. Playwright engines are not represented as physical devices, and an absent live API key is not represented as a live-model pass.

## Acceptance criteria

| # | Criterion | Current authoritative evidence | Result |
|---|---|---|---|
| 1 | Installable mobile PWA creates, reloads, and retains a local thread | Lighthouse `installable-manifest` audit (manifest + service worker); `installed service worker keeps the PWA shell available offline`; `first run, delayed persistence, reload, Challenge, conclusion, and Keep digging` on Chromium/WebKit at 320/375/430 | Pass |
| 2 | Starters are animated interchangeable copy without hidden strategy | Component tests for starter copy/focus/no operation input; browser test `starter motion becomes a static list under reduced-motion preference`; operation request contracts derive only from thread input | Pass |
| 3 | Normal turns are adaptive and pass every hard validator | Validator/provider contract tests; fixed eval dimensions `usefulNextQuestion`, `noWhyOrDisguisedWhy`, `noFillerLectureDiagnosisOrPraise`, `noPrematureSynthesis`, `realInformationGap`, and `mobileConcision`: all 16/16 or 48/48 | Pass |
| 4 | Challenge returns a blind spot or counter-position adaptively | Challenge schemas/validators/provider/MCP contract tests; fixed eval `credibleChallenge` 16/16; browser Challenge flow across the mobile matrix | Pass |
| 5 | Conclusion is explicit, editable, and grounded | No automatic conclusion transition in application tests; explicit Draft action and editable conclusion E2E; fixed eval `groundedConclusion` and `uncertaintyAndUserAuthority` 16/16 | Pass |
| 6 | Keep digging, capsule save, finish, export, and permanent delete work | `capsule edit, export, permanent deletion, Finish, and a clean new thread`; Task 6 component/application/repository tests including irreversible owner-scoped deletion | Pass |
| 7 | Fresh threads receive no unrelated prior context | Conversation service context tests, owner/thread-scoped repository tests, MCP statelessness tests, and clean-new-thread E2E assertion | Pass |
| 8 | Spectral glass meets performance, contrast, reduced-motion, and target requirements | Lighthouse performance >=0.90/accessibility 1.00; axe across empty/thread/Challenge/conclusion/capsule/offline/voice; scripted long-task test; 44px computed targets; visible-focus style assertion; nonzero safe-area-variable browser check; 320–430 matrix | Pass for automated release gate; physical release evidence follows `tests/e2e/browser-compatibility.md` |
| 9 | Web and MCP share contracts and questioning rules | `server/mcp.test.ts`, `server/mcp-http.test.ts`, shared `src/domain` schemas/validators, and built widget artifact tests | Pass |
| 10 | Server stores no conversation and logs no authored text | Stateless HTTP/MCP architecture tests and `verify-production` seeded log sentinel; immutable runtime contains no database service or volume | Pass |
| 11 | Tests, evals, typecheck, lint, builds, and security checks pass | Complete named-gate table below | Pass |
| 12 | Preview/production are reproducible, observable, and rollback-capable | Pinned multi-stage Dockerfile, distinct Compose environment profiles, CI image build, `/healthz` + `/readyz`, immutable digest promotion and prior-digest rollback in `deploy/README.md`, `verify-production` | Pass for reproducible deployment artifact; platform deployment is operator-controlled |
| 13 | Enabled voice shares the thread and never exposes the long-lived key | Independently accepted Task 8 review; 127 focused tests; short-lived no-store origin-controlled credential tests; shared `acceptVoiceExchange`; text-only provider output, validation+persistence before active-session local speech, unexpected provider audio never played | Pass |

## Named production gates

| Gate | Command/evidence | Result |
|---|---|---|
| TypeScript, lint, unit/component/contract, client/server builds | `npm run validate` — 24 files / 350 tests | Pass |
| Fixed product eval | `npm run eval` — corpus `2026-07-10.v1`, 16 cases, 48 operations, 0 hard violations | Pass |
| Subjective quality review | `evals/subjective-review.md` — eight category samples, strengths, concerns, disposition | Pass with live-model follow-up before live traffic |
| Live model eval sequencing | `npm run eval:live` without a key | Explicit skipped status; authorized live run remains key-gated per spec §14 |
| Production dependency audit | `npm audit --omit=dev` | Pass, 0 vulnerabilities |
| Mobile browser + accessibility + performance | `npm run test:e2e` — 43 passed / 5 intentionally skipped duplicate PWA projects | Pass |
| Browser versions | Chromium 149.0.7827.55 build 1228; WebKit 26.5 build 2311 | Pass as engine evidence, not physical-device evidence |
| Lighthouse | `npx lhci autorun`; performance 0.91, accessibility 1.00, best practices 1.00, SEO 1.00, console errors 1.00, installable manifest/service worker 1.00 | Pass |
| Scripted interaction long tasks | `scripted mobile interactions produce no task longer than 50 milliseconds` | Pass |
| Immutable runtime/security/privacy | `node scripts/verify-production.mjs` — nine checks | Pass |
| Container build and health | `docker build --target production -t specular:production .`; image `sha256:74b8d0ee9ede05a7d201760439a792b959587322652a4f1f520b209f9877b636`; non-root `node`; Docker health `healthy`; PWA and `/healthz` HTTP 200 | Pass |
| Compose definitions | Compose 5.3.1 `--profile development --profile preview --profile production config --quiet` | Pass |
| CI/dependency automation | `.github/workflows/ci.yml`, `.github/dependabot.yml` | Pass by inspection; CI reruns every named non-live gate |

## Explicit release boundaries

- No live OpenAI request was made. The production adapter and live qualitative smoke remain gated until Henry provisions `OPENAI_API_KEY`, exactly as required by specification §14.
- Automated compatibility ran exact Chromium and WebKit engines. The latest-two-major physical iOS Safari and Android Chrome record is a release-operator step and must use the procedure in `tests/e2e/browser-compatibility.md`; generic emulation is not substituted for that evidence.
- Preview and production environment files contain non-secret example origins. A platform operator must replace them and inject the key from a secret store. The artifact is reproducible and rollback-capable; this audit does not claim an external platform deployment occurred.
