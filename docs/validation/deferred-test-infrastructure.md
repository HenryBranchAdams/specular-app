# Deferred test-infrastructure decisions

**Status:** active register
**Last reviewed:** 2026-08-15
**Owner:** Specular maintainers

This register keeps deliberately deferred testing and operational choices visible. A deferred item is not rejected and must not be adopted merely because it is available. Each item has a concrete trigger and a required review before implementation.

| Decision | Current disposition | Adoption trigger | Review required before adoption |
| --- | --- | --- | --- |
| Hosted QA identity adapter | Defer | A named deployed behavior cannot be exercised by the local Wrangler harness or the real two-account SIWC checklist becomes an unsustainable release bottleneck | Prove a separate QA-only entrypoint, fixed synthetic A/B identities, expiring credentials, separate D1 and budget, secret-safe artifacts, and a production-bundle exclusion assertion |
| `@cloudflare/vitest-pool-workers` | Defer | A test needs direct same-isolate Workers runtime APIs that `createTestHarness()` and the existing fast Worker tests cannot expose | Document the missing capability and avoid duplicating the integration harness |
| Stryker mutation testing | Defer | Critical synchronization, authorization, cache, and dictation logic has been extracted into small pure modules with stable ordinary coverage | Start scheduled and narrowly scoped; observe the mutation score before setting a failure threshold |
| Mock Service Worker | Defer | The real Worker harness needs deterministic interception of outbound OpenAI traffic and a dedicated mock service binding would be less maintainable | Add only for that boundary; never use it to mock Specular's own HTTP routes in integrated tests |
| Changed-line coverage tooling | Defer | Critical-module coverage reports show that file-level ratchets routinely miss untested changed branches | Compare maintenance cost against the observed misses before adding another coverage gate |
| Visual-regression SaaS | Defer | The pinned local Playwright image baseline cannot provide usable review evidence or cross-platform rendering becomes a release requirement | Review privacy, cost, retention, and authored-content exposure before connecting a third party |
| Mobile device farm | Defer | The supported-device matrix expands or manual physical-iPhone qualification becomes too slow or unreliable | Prove the service can exercise authentication, PWA, microphone, backgrounding, and privacy-sensitive flows without retaining author content |
| Sentry or PostHog | Defer | Cloudflare-native, content-free diagnostics cannot answer a demonstrated operational question | Complete a data-flow and retention review; authored writing, transcripts, identities, prompts, responses, and tokens remain prohibited |
| Generic chaos framework | Defer | Targeted deterministic failure injection cannot reproduce a real escaped distributed-systems failure | Name the failure class and show why boundary-specific controls are insufficient |
| Another customer authentication provider | Do not adopt during beta | Only reconsider if ChatGPT sign-in can no longer satisfy the product's customer identity requirement | Requires a new product and migration decision, not a testing convenience |
| Direct Miniflare dependency | Avoid | Only reconsider if the supported Wrangler harness is removed or cannot execute a required production binding | Prefer the highest-level Cloudflare-supported production-build harness |
| OpenAI Evals API integration | Avoid | None under the documented retirement path | Keep repository evals and reassess future managed Datasets/graders separately |
| Development-tool transitive audit remediation | Defer targeted upstream upgrades; production audit is clean as of 2026-08-15 | A patched direct tool release is available, a dev tool processes untrusted input, or a finding enters the shipped runtime graph | Re-run both full and `--omit=dev` audits, prove the dependency is not bundled into runtime artifacts, and avoid forced breaking upgrades without test evidence |

Review this register when a trigger occurs, before each beta expansion, and at least once per quarter while the product is actively developed. Record adopted items in an ADR and remove neither the historical decision nor its trigger from version control.

The 2026-08-15 lockfile audit reports zero production vulnerabilities with `npm audit --omit=dev`. The full development graph still reports 18 transitive findings in tooling; that count is evidence for the row above, not a claim that the entire development graph is clean.
