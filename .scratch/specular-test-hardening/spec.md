# Specular production-confidence test hardening

**Status:** approved for implementation

## Problem Statement

Specular's current tests prove many isolated behaviors, but escaped beta defects have repeatedly lived between layers: service-worker routing, browser lifecycle, authenticated session state, Workspace cache recovery, real D1 semantics, and dictation capture timing. Green mocked tests and a successful Sites deployment therefore do not yet justify calling the beta qualified.

## Solution

Create one production-faithful integration spine using Wrangler's `createTestHarness()` and the built Cloudflare Worker. Apply checked-in D1 migrations to fresh synthetic databases and reuse the same harness for Worker HTTP tests and selected Playwright journeys. Keep fast mocked UI tests, but separate them from real Worker/D1 tests and Chromium-only PWA lifecycle tests.

Fix the known stale-auth and update behavior test-first. A private workspace is shielded immediately when authentication is lost, revalidated on browser restoration, and never exposed by a cold offline launch. A new service worker waits until pending writing is durable before activation and reload. Preserve real two-account SIWC and physical iPhone Safari/Chrome checks as live release gates rather than pretending synthetic identity qualifies the Sites dispatcher.

Add measured critical-module coverage, deterministic property tests, flake-failing CI, privacy-safe artifacts, migration and concurrency fixtures, and a machine-readable release evidence manifest. Defer optional tools until their recorded adoption triggers occur.

## Approved public test seams

1. **Worker HTTP and D1:** exercise public routes through the built Worker with actual D1 migrations and synthetic verified identities.
2. **Workspace synchronization:** exercise bootstrap, durable cache load/save, reconciliation, conflict preservation, locking, recovery, and account cleanup through the workspace-store interface.
3. **Browser product behavior:** exercise user-visible sign-in, writing, reflection, dictation, sharing, archive, deletion, conflicts, and recovery through Playwright.
4. **Service-worker lifecycle:** exercise installation, response provenance, offline transition, two-version update, sign-out, and cache exclusion in a dedicated Chromium suite.
5. **Session lifecycle:** exercise startup, focus, visibility, `pageshow`, reconnect, sign-out, account switching, and protected-route 401 behavior through the session boundary.
6. **Dictation capture:** exercise permission, codec/capture, checkpoint ordering, interruption, empty result, language, and deletion through the capture controller and visible review flow.
7. **Live qualification:** exercise real Sites SIWC with two ChatGPT accounts and one physical iPhone in Safari and Chrome; these checks cannot be replaced by automation.

## Testing Decisions

- Follow vertical red-then-green slices at one approved seam.
- Preserve existing fast fakes where they add speed, but never cite them as D1, service-worker, SIWC, or physical-device evidence.
- Use the Wrangler production-build harness instead of direct Miniflare or a parallel integration server.
- Use synthetic fixed tenant A/B identities locally. Defer a hosted QA identity adapter until a named locally untestable behavior requires it.
- Keep Sign in with ChatGPT as the only customer authentication method.
- Permit warm-session offline drafting but require online authentication on cold launch and after explicit sign-out.
- Replace automatic service-worker takeover with a waiting update that checkpoints writing before activation and reload.
- Ratchet branch coverage on named critical modules toward 90%; do not impose a blanket repository threshold.
- Keep one diagnostic Playwright retry but fail CI when a retry is needed.
- Retain privacy-safe failure artifacts for 30 days and compact success/release summaries for 7 days.
- Keep deterministic repository model evals. Live model and transcription checks are bounded scheduled/release gates.
- Android Chrome is outside the initial beta matrix. Automated WebKit is engine evidence, not physical iOS evidence.

## Completion Criteria

- Real Worker/D1 tests apply the checked-in migrations and cover authorization, isolation, concurrency, snapshots, archive, deletion, quotas, and provider failures.
- Integrated browser tests cover the browser-to-Worker-to-D1 contract without route mocks for backend-critical journeys.
- PWA tests prove auth/API routes never come from Cache Storage or the navigation fallback, and a two-version update preserves pending writing.
- Session loss immediately removes private UI, including workspace-route 401 and `pageshow` restoration.
- Explicit sign-out clears the correct account cache and cannot bounce back into a cached authenticated workspace.
- Critical sync, auth/cache, archive/migration, and checkpoint properties have deterministic shrinking tests.
- CI treats flakes as failures and retains privacy-safe diagnostic evidence.
- The release manifest distinguishes local, integrated, deployed, SIWC-qualified, physical-iOS-qualified, and beta-qualified states.
- Deferred decisions remain tracked in `docs/validation/deferred-test-infrastructure.md`.

## Release Boundary

Implementation and local/CI validation do not authorize a Sites deployment, audience change, branch-protection mutation, paid live-model run, or beta invitation. Those remain separate operator actions.
