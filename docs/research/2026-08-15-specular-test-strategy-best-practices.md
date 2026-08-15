# Specular testing and qualification strategy: primary-source review

**Date:** 2026-08-15
**Scope:** Research only. This note evaluates the agreed testing program against the current Specular repository and primary documentation. It does not implement the program.

## Executive decision

Specular should expand coverage, but the cleanest design is not “more tests everywhere.” It is one production-faithful integration spine, three automated lanes, and two live release gates:

1. **Integration spine:** build the real Vite/Cloudflare application once, then run its generated Worker, D1 binding, routes, and browser through Wrangler's `createTestHarness()`.
2. **Automated lanes:** fast deterministic Vitest tests; browser-to-Worker-to-D1 Playwright tests; and a separate Chromium service-worker lifecycle suite.
3. **Live gates:** a real two-account Sign in with ChatGPT check and a short physical-iPhone Safari/Chrome checklist.

This collapses the proposed “real Worker/D1 harness” and “browser-to-Worker integration harness” into one Cloudflare-supported platform. It also keeps service-worker tests out of ordinary mocked browser tests, where they are currently blocked anyway.

Four adjustments are important before implementation:

- **Do not hard-gate a blanket 90% coverage number on day one.** Establish a baseline, name critical state-machine modules, then ratchet their branch coverage toward 90%. Vitest's changed-file option is not true changed-line coverage.
- **Do not add a second customer authentication provider.** Use Sign in with ChatGPT in production. If hosted agent QA is necessary, isolate a synthetic QA identity ingress in a QA-only Worker entrypoint that cannot be built into production, and retain a manual SIWC gate.
- **Do not permit a cold offline launch to unlock private writing based only on an old browser record.** During beta, preserve drafting when an authenticated page goes offline, but require online authentication after a cold launch or sign-out. A prior identity record is not current authentication on a shared device.
- **Do not migrate the existing local eval system to the OpenAI Evals API.** OpenAI documents that API as deprecated, read-only on 2026-10-31, and shutting down on 2026-11-30. Keep deterministic repository evals and use bounded live calls only as a scheduled or release-candidate gate.

**Hosted QA identity decision: defer it.** Build the local production-faithful harness and synthetic A/B identity seam first. Add a hosted QA-only identity entrypoint only when a named test cannot be exercised locally (for example, a deployed-network or Sites-hosting behavior). This prevents speculative auth infrastructure from becoming a prerequisite for fixing the current cache, D1, and lifecycle gaps.

## Current architecture and the gaps it creates

The repository already has a strong starting set: Vitest 4.1.10, Testing Library, Playwright 1.61.1, `@axe-core/playwright`, Lighthouse CI, `fake-indexeddb`, Drizzle migrations, fixed-corpus model evals, GitHub Actions, Vite PWA/Workbox, and Cloudflare's Vite plugin. The repository began this tranche with `@cloudflare/vite-plugin` 1.37.1 and transitive Wrangler 4.92.0. That Wrangler release does not export the newly documented `createTestHarness()` API, so the integration spine requires the compatible current pair rather than merely promoting the transitive version to a direct dependency.

The largest gaps are structural, not test-count gaps:

| Repository evidence | Consequence |
|---|---|
| `playwright.config.ts` globally sets `serviceWorkers: 'block'`. | The normal browser suite cannot exercise install, activation, cache routing, or update behavior. |
| E2E helpers intercept `/api/session` and `/api/workspace`. | Those tests do not qualify the browser, Worker router, D1 schema, authorization, and serialization as one system. |
| `tests/e2e/pwa-offline.spec.ts` allows a service worker, but still uses page-level API mocks. | It proves that an app shell can be cached; it does not prove that authenticated/API traffic avoids stale caches. Playwright also warns that page routing does not see requests intercepted by a service worker. |
| `worker/index.test.ts` calls the Worker with a handwritten in-memory database. | It is useful as a fast contract fake, but cannot qualify D1 SQL semantics, migration drift, concurrency, or the deployed Worker build. |
| `vite.config.ts` uses `registerType: 'autoUpdate'`, `skipWaiting: true`, and `clientsClaim: true`. | A new worker can take over an open document without a controlled reload. Workbox warns that `skipWaiting()` can break pages when an old page expects old lazy-loaded resources. |
| Auth is rechecked at startup, on a timer, focus, and visibility, but not on `pageshow`. | Browser back/forward cache restoration can reveal stale authenticated UI before revalidation. |
| Both Drizzle migration files and runtime `CREATE TABLE IF NOT EXISTS` paths create schema. | There are two schema authorities that can silently diverge. |
| GitHub Actions retries Playwright once, retains traces locally, but has no `failOnFlakyTests` or artifact upload. | A test that fails then passes can be green without becoming an explicit release signal, and CI failure evidence is not retained. |
| There is no coverage provider/configuration, no real D1 migration test, no physical-device record, and no machine-readable release manifest. | “Green” cannot yet mean the failure classes that reached beta are covered. |

## Documented facts and resulting recommendations

Each subsection explicitly distinguishes platform facts from Specular recommendations.

### 1. Risk-based test pyramid

**Documented facts.** Playwright recommends testing user-visible behavior and keeping tests isolated; Vitest supports V8 coverage, global and glob-specific thresholds, `perFile`, and `coverage.changed`. [`coverage.changed` narrows collection to changed files](https://vitest.dev/config/coverage.html#coverage-changed); it does not calculate whether each changed line was executed. The V8 provider is supplied by the official optional package `@vitest/coverage-v8`. [Playwright best practices](https://playwright.dev/docs/best-practices) and [Vitest coverage guide](https://vitest.dev/guide/coverage.html).

**Recommendation.** Preserve a risk pyramid rather than an equal test count by layer:

- Unit and model-based tests: reconciliation, authorization decisions, cache/session state, dictation checkpointing, and migration/archive invariants.
- Real-runtime integration: every protected endpoint, actual D1, schema/migrations, concurrent writes, malformed requests, provider failures.
- Browser journeys: only valuable user contracts, using the real Worker/D1 where backend behavior matters.
- Live/manual: platform auth, physical iOS, deployment/cache upgrade, and bounded model quality.

Start with measured coverage and no regression on changed critical files. Define glob-specific thresholds after modules are split into testable state machines. Use **90% branch coverage as a target for those named critical modules**, not for `App.tsx`, the whole Worker, or the whole repository. Do not add a changed-line coverage dependency yet; review the first reports before deciding whether the extra gate is worth its complexity.

### 2. One Cloudflare integration spine

**Documented facts.** Cloudflare recommends its Workers Vitest integration for in-runtime unit testing and now provides `createTestHarness()` for integration testing. The harness exercises production Worker builds, configured HTTP routes, and local bindings, and Cloudflare documents integrations with Playwright and Mock Service Worker. It exposes storage preparation/reset and requires Wrangler as a direct development dependency. For a Vite-built Worker, Cloudflare directs tests to build first and point the harness at the generated Wrangler configuration. [Cloudflare testing overview](https://developers.cloudflare.com/workers/testing/), [test harness setup](https://developers.cloudflare.com/workers/testing/test-harness/get-started/), [Playwright/MSW integration](https://developers.cloudflare.com/workers/testing/test-harness/integrations/), [Vite build configuration](https://developers.cloudflare.com/workers/testing/test-harness/configure/), and [test-state preparation](https://developers.cloudflare.com/workers/testing/test-harness/prepare-test-state/).

**Recommendation.** Make `createTestHarness()` the shared backend fixture for both API integration and Playwright browser tests. The fixture should:

1. build the production Worker;
2. start it from generated Wrangler configuration;
3. apply repository D1 migrations to a fresh database;
4. seed only synthetic tenant A/B data;
5. expose a browser base URL;
6. reset binding state between tests; and
7. print harness diagnostics only on failure.

This eliminates a redundant standalone “browser integration server.” Keep the current in-memory Worker tests as fast contract tests only where they add speed. Do **not** add direct Miniflare. Defer `@cloudflare/vitest-pool-workers` until a concrete test needs same-isolate APIs that the integration harness cannot cover.

### 3. D1 migrations, failure injection, and concurrency

**Documented facts.** Cloudflare's Vitest APIs can read and apply D1 migration files, and Cloudflare's migration mechanism records applied migrations in `d1_migrations`. [D1 migration testing](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/#applyd1migrations) and [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/).

**Recommendation.** Treat checked-in migrations as the one schema authority. Test:

- empty database to head;
- one fixture for each **supported released schema epoch** to head;
- repeated startup after migration;
- schema constraints and indexes;
- concurrent same-tenant writes and stale revisions;
- tenant A/B concurrency; and
- a failed migration/deploy rollback rehearsal.

Once the migration harness is established, move runtime workspace/share/usage DDL into migrations and remove runtime schema creation. Maintaining both is less safe than either convention alone. Use targeted boundary failures rather than a generic chaos framework: D1 error/timeout, provider 429/500/invalid JSON, IndexedDB rejection/quota, network loss between save phases, tab/process termination, and out-of-order sync. Mock outbound OpenAI requests at the harness boundary with MSW or a dedicated mock service, not by mocking Specular's own route.

### 4. PWA cache, update, and auth lifecycle

**Documented facts.** Workbox documents that a newly installed service worker normally waits while an older worker controls clients. Its guidance explicitly warns that `skipWaiting()` can break existing pages and shows an explicit update flow through `workbox-window`'s waiting event and `messageSkipWaiting()`. Playwright supports service-worker inspection only in Chromium-based browsers; page-level routing misses service-worker-handled requests, and `response.fromServiceWorker()` can prove response provenance. [Workbox lifecycle](https://developer.chrome.com/docs/workbox/service-worker-lifecycle), [handling updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates), [workbox-window](https://developer.chrome.com/docs/workbox/modules/workbox-window), [Playwright service workers](https://playwright.dev/docs/service-workers), and [Playwright network routing](https://playwright.dev/docs/network).

The HTML standard defines `pageshow`, including `persisted` for restored page state. Web.dev recommends updating sensitive state after back/forward-cache restore, and WebKit also exposes `pageshow`/`pagehide` around its page cache. [HTML `pageshow`](https://html.spec.whatwg.org/multipage/nav-history-apis.html#event-pageshow), [bfcache guidance](https://web.dev/articles/bfcache), and [WebKit page-cache events](https://webkit.org/blog/516/webkit-page-cache-ii-the-unload-event/).

**Recommendation.** Replace automatic takeover with a safe waiting-update state machine:

- new worker installs and waits;
- UI says an update is available;
- if local writes are pending, sync or checkpoint before updating;
- tell the waiting worker to activate;
- reload only after `controlling` confirms takeover;
- retain a recovery path if activation/reload fails.

Keep `/api/*`, `/signin-with-chatgpt`, `/signout-with-chatgpt`, and `/callback` out of runtime caching; assert that they are never served from a service worker or Cache Storage. A navigation fallback denylist is necessary but not sufficient proof. On sign-out, shield the document immediately, use the platform route, and revalidate on `pageshow`, focus, visibility, and reconnect.

Split Playwright rather than toggling one global setting:

| Suite | Backend | Service worker | Browsers | Purpose |
|---|---|---|---|---|
| UI contracts | mocked APIs | blocked | Chromium + WebKit | fast layout, controls, a11y, deterministic error UI |
| Integrated journeys | real Worker/D1 harness | blocked | Chromium primarily, selected WebKit | browser-to-route-to-D1 behavior |
| PWA lifecycle | real production build/Worker/D1 | allowed | Chromium only | install, cache provenance, offline transition, sign-out, two-version update |

The two-version test must build version A and version B and prove: A remains stable while open; B enters waiting; accepted update preserves/checkpoints text; the page reloads to B; auth/API responses were never served from the old worker; and reopening after explicit sign-out does not reveal writing.

### 5. Offline privacy boundary

**Documented fact.** Sign in with ChatGPT authenticates a user online; Sites audience access and in-app authentication are separate controls. OpenAI tells Site owners to test intended visitor access and explain received identity information. [Creating and managing ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-managing-chatgpt-sites) and [Sign in with ChatGPT](https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt).

**Inference and recommendation.** A browser-stored “last verified user” is not an authentication ceremony and cannot distinguish the owner from another person using the same unlocked browser profile. For the beta:

- allow an already authenticated, open page to go offline and continue checkpointing locally;
- do not allow a cold offline launch to reveal a private workspace;
- after explicit sign-out, purge or quarantine that account's local material and fail closed;
- after reconnect, verify identity before uploading and never merge one account's queue into another account.

Cold offline unlock can be revisited only with an explicit device-bound unlock/encryption design. This narrower policy both improves security and removes the most failure-prone cache/auth ambiguity.

### 6. Real iOS qualification

**Documented facts.** Playwright's WebKit is valuable engine coverage but Playwright documents service-worker testing as Chromium-only. Apple provides Web Inspector for pages, service workers, simulators, and physical devices. Apple's App Review Guidelines require browsing apps to use the appropriate WebKit framework unless granted a limited alternative-browser-engine entitlement. [Playwright service workers](https://playwright.dev/docs/service-workers), [Inspecting iOS](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios), [inspecting apps and devices](https://developer.apple.com/documentation/safari-developer-tools/inspect-apps-and-devices), and [App Review Guideline 2.5.6](https://developer.apple.com/app-store/review/guidelines/).

**Recommendation.** Keep automated WebKit viewport tests, but do not label them “iOS qualification.” Before a beta release, test one currently supported physical iPhone in both Safari and Chrome for:

- first sign-in, sign-out, second-account sign-in;
- app background/foreground and browser process termination;
- offline while open, reconnect, and pending-write reconciliation;
- PWA update after a new deployment;
- dictation permission, interruption, recovery, and long pause; and
- safe-area/keyboard/focus behavior.

Safari and Chrome share an engine in the common iOS configuration but retain different browser storage, session, and UI surfaces, so both are worth the short checklist. Android Chrome can remain out of the initial matrix as agreed. A device farm is premature for a few testers.

### 7. SIWC, QA identity, and tenant isolation

**Documented facts.** Authentication is not authorization. OWASP recommends deny by default, validating permissions on every request, and authorization integration tests. Its regression guidance uses separate tenants and requires zero foreign identifiers in responses. It also recommends a formal authorization matrix as a test source. [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [Authorization Regression Testing](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Regression_Testing_Cheat_Sheet.html), and [Authorization Testing Automation](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Testing_Automation_Cheat_Sheet.html).

**Recommendation.** Keep SIWC as the only customer authentication method. Create a small machine-readable authorization matrix covering every method and resource: anonymous, tenant A, tenant B, malformed identity, direct foreign IDs, workspace save/load, snapshots/shares/archive/delete, dictation/model endpoints, replayed mutations, and cross-tenant cache namespaces. Generate or parameterize tests from that matrix.

For agents and hosted QA, first use the local harness, where synthetic identity injection is deterministic and cannot affect production. If a deployed QA Site is still needed, use a **separate QA Worker entrypoint/build** that verifies an expiring signed QA credential and maps it to exactly two fixed synthetic identities. Requirements:

- QA secret exists only in QA hosting secrets;
- token never appears in URL/query, browser storage, trace, screenshots, or logs;
- QA ingress cannot select arbitrary user IDs;
- the production build has no QA route/parser, enforced by a bundle/source assertion;
- QA D1 and API key/budget are separate;
- a real two-account SIWC checklist remains mandatory because synthetic ingress cannot qualify the Sites dispatcher.

This is more contained than adding Auth0/Supabase/another customer identity system. A static bearer token is acceptable only as an initial rotating QA secret; an expiring HMAC-signed assertion is the better destination.

### 8. CI flakes, evidence, and visual checks

**Documented facts.** Playwright classifies tests as passed, flaky, or failed when retries are enabled and exposes `--fail-on-flaky-tests`. It recommends traces for CI debugging. GitHub Actions artifacts can retain reports, screenshots, logs, and coverage, with per-artifact `retention-days`. Playwright screenshot comparisons require a stable execution environment because rendering varies by OS, browser, hardware, and settings. [Playwright retries](https://playwright.dev/docs/test-retries), [Playwright CLI](https://playwright.dev/docs/test-cli), [Playwright trace options](https://playwright.dev/docs/api/class-testoptions#test-options-trace), [GitHub workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts), [artifact retention](https://docs.github.com/en/actions/tutorials/store-and-share-data#configuring-a-custom-artifact-retention-period), and [visual comparisons](https://playwright.dev/docs/test-snapshots).

**Recommendation.** Keep one CI retry for diagnostics, but set `failOnFlakyTests: true` in CI. A retry must never turn a red first attempt into a green release. Upload fixture-only Playwright HTML/traces on failure for 30 days, and a small machine-readable summary for 7 days. Do not record production/private author text in traces, screenshots, console, or reports.

Add a small, reviewed visual baseline only for stable high-value states (signed-out, document, margin/reflection, dictation review, mobile keyboard-safe state). Run it in a pinned Linux Playwright container/toolchain. Do not add a visual SaaS or snapshot every responsive width.

Keep CI below ten minutes by sharding independent browser lanes, caching npm/Playwright assets, reusing the production build artifact across jobs, and running live model/device/mutation checks outside every PR. Required branch checks should include deterministic unit/coverage/evals, Worker+D1 integration, browser contracts/integrated journeys, PWA lifecycle, build/security scan, and release-manifest generation. Branch protection itself is a repository administration step, not code.

### 9. Property and mutation testing

**Documented facts.** fast-check supports property-based and model-based command testing with shrinking. Stryker supports Vitest through `@stryker-mutator/vitest-runner`, incremental mutation, and thresholds; its Vitest runner does not support Vitest Browser Mode. [fast-check](https://fast-check.dev/), [model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/), [Stryker Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/), and [Stryker configuration](https://stryker-mutator.io/docs/stryker-js/configuration/).

**Recommendation.** Add fast-check early for bounded, deterministic properties:

- synchronization/replay is idempotent;
- no command sequence crosses tenant boundaries;
- archive/export/import preserves user-authored content and provenance;
- cache/auth transitions never expose content after sign-out;
- checkpoint sequences never discard an acknowledged transcript; and
- supported migration fixtures preserve invariants.

Pin the seed in PR CI and retain the shrunk seed/path on failure; run longer scheduled seeds. Defer Stryker until critical logic is extracted into small pure modules and ordinary coverage is stable. Then run it scheduled and scoped, observe mutation score first, and only later choose a break threshold. Whole-UI mutation testing is not useful here.

### 10. Synthetic audio and live model evaluation

**Documented facts.** OpenAI's current speech-to-text guide lists `gpt-transcribe` and supported upload formats, limits file uploads to 25 MB, and says language/context hints improve accuracy. It directs continuously arriving audio to Realtime transcription. OpenAI's Evals API guide marks that API deprecated and recommends newer Datasets/graders tooling for future managed evaluation. [Speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text), [Evals guide and deprecation notice](https://developers.openai.com/api/docs/guides/evals), and [graders](https://developers.openai.com/api/docs/guides/graders).

**Recommendation.** Keep Specular's existing repository `evals/fixed-corpus.json` and deterministic structural checks. Do not add an Evals API integration. Version the model ID, prompt/contract hash, corpus hash, and evaluator version in release evidence.

For dictation, add non-human synthetic fixtures in WAV, WebM, M4A, and MP3 covering English speech, silence, 20–30 second pauses, false starts/filler, wrong-language risk, corrupt/truncated input, interruption, and checkpoint boundaries. Test the transcription and faithful-cleanup phases separately. Everyday CI should use deterministic provider responses; a small cost-capped live suite should run on schedule and for release candidates, with explicit English language hints while the beta is English-only. Moving from `gpt-4o-mini-transcribe` to the currently documented `gpt-transcribe` should be a separate product-quality experiment, not hidden inside test-infrastructure work. Do not adopt Realtime solely to make tests easier.

Model grading may supplement deterministic and human review, but cannot be the only judge of Specular's non-prescriptive voice, fidelity, or user authorship.

### 11. Observability and privacy

**Documented facts.** Cloudflare recommends enabling Workers Logs and traces before production, supports structured JSON logs and sampling, and exposes request counts, errors, CPU time, wall time, and duration. Workers Logs retention is limited and volume-priced. OWASP says logs should omit session identifiers, access tokens, passwords, sensitive personal data, and secrets. [Cloudflare observability](https://developers.cloudflare.com/workers/observability/), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#observability), and [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

**Recommendation.** Use Cloudflare-native observability before adding Sentry or PostHog. Emit fixed-schema events only: route class, outcome/error code, latency bucket, D1/provider status, app/SW/release version, retry count, and synthetic/live environment. Never log writing, transcripts, prompts, responses, email, raw user ID, tokens, session/cookie values, request bodies, or foreign record IDs. Disable or review invocation URL logging if URLs can contain sensitive identifiers.

At beta scale, 100% error events and sampled success events are reasonable, subject to cost. Define queries for auth failure loops, sign-out bounce, sync conflict, D1 error, provider failure, PWA version mismatch, and dictation interruption. Add third-party telemetry only after a real operational need survives this privacy constraint.

### 12. Release evidence and the meaning of “done”

**Documented facts.** GitHub artifacts preserve test outputs between jobs and after a workflow; protected branches can require status checks before merge. [GitHub workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts) and [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

**Recommendation.** Generate a JSON release manifest plus a short human Markdown summary. The manifest is an index to evidence, not proof on its own. Include:

- Git commit/tree and lockfile hash;
- client, Worker, and service-worker asset/version hashes;
- Drizzle migration set/hash and schema epoch;
- test/eval corpus, prompt/contract, evaluator, and model identifiers;
- required suite results and GitHub run/artifact links;
- deployed Site/release identifier;
- synthetic/live environment declaration;
- physical iPhone Safari/Chrome result, operator, and date; and
- accepted exceptions with owner/expiry.

A release is qualified only when deterministic required checks pass without flaky classification, tenant isolation is green, the two-version PWA test is green, real SIWC was checked with two accounts, physical iOS is recorded, and no unresolved severity-one/two defect is waived. “Tests passed” must not be reported as “deployed,” “live,” or “beta-qualified” unless the corresponding evidence exists.

## Exact dependency recommendation

Versions should be installed through npm so the lockfile selects a compatible release; do not hand-edit the lockfile.

### Add in the first implementation tranche

| Package | Placement | Reason |
|---|---|---|
| `wrangler@4.123.0` | `devDependencies`, exact pin initially | `createTestHarness()` is a Wrangler API and Cloudflare requires a direct dependency. Wrangler 4.92.0 does not export it; 4.123.0 does. Update it deliberately with the paired Cloudflare Vite plugin. |
| `@cloudflare/vite-plugin@1.52.1` | `devDependencies`, exact pin initially | This release peers with Wrangler 4.123.0 and generates configuration accepted by that harness. The prior plugin emitted the removed `legacy_env` field. |
| `@vitest/coverage-v8@4.1.10` | `devDependencies`, exact match to Vitest | Official Vitest V8 coverage provider. The lockfile already contains this version as optional metadata, but it is not installed as a direct project dependency. |
| [`fast-check@4.9.0`](https://www.npmjs.com/package/fast-check) | `devDependencies`, exact pin initially | Property/model-based testing for reconciliation, auth/cache, migration, and checkpoint state machines. This was the current npm release at the research date. |

### Add when the real harness introduces outbound provider tests

| Package | Placement | Reason |
|---|---|---|
| [`msw@2.15.0`](https://www.npmjs.com/package/msw) | `devDependencies`, exact pin initially | Cloudflare documents MSW integration with `createTestHarness()`; it can control OpenAI boundary success, rate-limit, timeout, malformed, and server-failure responses without mocking Specular's own routes. If a dedicated mock service binding is introduced instead, omit MSW. This was the current npm release at the research date. |

The install-now command, when implementation begins, is therefore:

```sh
npm install --save-dev --save-exact @cloudflare/vite-plugin@1.52.1 wrangler@4.123.0 @vitest/coverage-v8@4.1.10 fast-check@4.9.0
```

Do not install MSW until the harness test that needs outbound OpenAI interception is written. Then use:

```sh
npm install --save-dev --save-exact msw@2.15.0
```

### Defer

| Package | Trigger to adopt |
|---|---|
| `@cloudflare/vitest-pool-workers` | Only if direct Workers-runtime unit APIs are needed beyond `createTestHarness()` plus existing fast tests. |
| `@stryker-mutator/core`, `@stryker-mutator/vitest-runner` | After critical pure modules and ordinary coverage are stable; scheduled/scoped first. |

### Avoid for now

- Direct `miniflare`: it duplicates the higher-level supported harness.
- A second customer auth SDK/provider: it adds a second identity truth without qualifying SIWC.
- OpenAI Evals API: it is being retired.
- Generic chaos, mobile-device-farm, visual-regression SaaS, Sentry, or PostHog dependencies: each adds operational/privacy surface before a demonstrated need.
- A changed-line coverage package: collect the first critical-module reports and decide from evidence.

## Implementation sequence that minimizes rework

1. **Define evidence and authorization contracts first.** Add the route/role matrix, release-manifest schema, privacy-safe event schema, and explicit critical-module list.
2. **Create the Cloudflare harness.** Direct Wrangler dependency, production build, D1 migrations, tenant fixtures, reset/debug behavior, and deterministic OpenAI boundary.
3. **Convert backend-critical E2E from route mocks to the harness.** Keep presentation-only E2E mocked.
4. **Fix lifecycle architecture before snapshotting it.** Waiting service worker, `pageshow` revalidation, warm-session-only offline policy, sign-out shield, and API/cache exclusions.
5. **Add the dedicated Chromium PWA suite.** Include two-version upgrade and cache provenance.
6. **Add critical coverage and fast-check.** Measure, split state machines, establish thresholds, then ratchet.
7. **Add CI flake failure and privacy-safe artifacts.** Keep live/mobile/mutation outside the PR fast path.
8. **Add QA-only hosted identity only if local automation is insufficient.** Prove production exclusion before deployment.
9. **Add scheduled live transcription/model checks, Cloudflare queries, and the physical-iOS checklist.**
10. **Require the release manifest and two live gates for beta qualification.**

## What this approach catches that the original list could still miss

- **Build-version skew:** client A talking to Worker B, not just stale cached HTML.
- **Back/forward-cache disclosure:** restored private DOM before session revalidation.
- **Warm-offline versus cold-offline confusion:** an explicit security boundary rather than a vague “previously verified” state.
- **Schema dual-authority drift:** runtime DDL succeeding while migration-based deployment or test data differs.
- **Authorization side channels:** status code, response size, timing, cache key, share/archive lookup, and foreign identifier leakage even when a response body seems empty.
- **QA mechanism escaping into production:** prevented by separate entrypoint and build assertion, not only an environment check.
- **Trace/artifact privacy leakage:** test evidence itself can contain writing, transcripts, identities, or tokens.
- **Model-contract drift without a code failure:** model ID, prompt, corpus, and grader versions belong in release evidence.
- **Silent flaky green:** retries stay useful diagnostically but are release failures.
- **Wrong claim level:** local green, hosted green, SIWC-qualified, physical-iOS-qualified, and beta-released remain distinct states.

## Final judgment

The proposed expansion is directionally correct. The elegant version is smaller than a collection of independent harnesses: one Cloudflare production-build harness, explicit browser lanes, a deliberately waiting service worker, a synthetic QA seam that cannot ship to production, and a release manifest that points to evidence. The highest-value first work is real Worker/D1/browser integration plus the service-worker/auth lifecycle; adding many more mocked UI tests before those changes would increase confidence less than it increases test count.
