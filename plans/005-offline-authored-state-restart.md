# Plan 005: Prove authored state survives a service-worker-controlled offline restart

> **Executor instructions**: Follow the plan exactly, modify only in-scope files, and stop on a STOP condition. Commit in the isolated worktree. Do not edit the plan index.
>
> **Drift check (run first)**: `git diff --stat 138b6da..HEAD -- tests/e2e/pwa-offline.spec.ts tests/e2e/helpers.ts`
> Plan 003 may change gather behavior and Plan 004 may change test orchestration; confirm the two-turn and service-worker assumptions below still hold.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/003-enforce-gather-eligibility.md`, `plans/004-isolate-performance-gate.md`
- **Category**: tests
- **Planned at**: commit `138b6da`, 2026-07-12

## Why this matters

The service-worker test currently proves only that an empty shell reloads offline. The ordinary offline test starts from an already-loaded page with service workers blocked. Neither proves the core local-first browser promise: a service-worker-controlled PWA page can restart fully offline and recover an existing inquiry, capsule, and retryable unsent thought from IndexedDB. Playwright does not prove standalone OS-level installation or launch here; that remains an operator check.

## Current state

- `playwright.config.ts:20` blocks service workers in ordinary projects.
- `tests/e2e/pwa-offline.spec.ts:3-24` enables a service worker, loads the empty starter, goes offline, and checks only the shell/list.
- `tests/e2e/specular.spec.ts:100-117` checks offline retry without a full restart.
- `tests/e2e/helpers.ts:82-120` already provides deterministic operation interception and submission helpers.
- `tests/e2e/specular.spec.ts:63-72` is the existing pattern for two user turns, Gather, and Save as capsule.

## Commands you will need

Use the Node 22.23.1 `PATH` from Plan 001 and the Plan 004 browser orchestration.

| Purpose | Command | Expected on success |
|---|---|---|
| Focused PWA test | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npx playwright test tests/e2e/pwa-offline.spec.ts --project=chromium-375 --workers=1 --retries=0` | one test passes |
| Full browser gate | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run test:e2e` | functional and isolated performance stages pass |
| E2E typecheck | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run typecheck:e2e` | exit 0 |

## Scope

**In scope**:

- `tests/e2e/pwa-offline.spec.ts`
- `tests/e2e/helpers.ts` only if a small reusable helper is necessary; prefer no change.

**Out of scope**:

- Production service-worker configuration or cache patterns unless the new test demonstrates a real failure; if it does, stop and report for a separate bug plan.
- IndexedDB implementation changes.
- Adding sync, accounts, or remote backup.
- Weakening offline assertions to shell-only behavior.

## Git workflow

- Use the cumulative isolated executor branch containing Plans 003 and 004.
- Conventional commit: `test: verify offline PWA state recovery`.
- Do not push, merge, or open a PR.

## Steps

### Step 1: Create meaningful authored state in the service-worker context

Extend the existing Chromium-375-only service-worker test. Before initial navigation, install the existing deterministic operation mocks on the page. Load the app online and wait for `navigator.serviceWorker.ready` plus a controlled reload.

Create:

- a first accepted authored thought and Specular question;
- a second accepted authored turn so Plan 003 allows Gather;
- gathered exact excerpts saved as a capsule.

Assert the authored thread text and `Capsule saved.` before going offline. Reuse the selectors and flow from `tests/e2e/specular.spec.ts:63-72`; do not duplicate response fixture logic.

**Verify**: the focused test reaches the saved-capsule state online.

### Step 2: Persist a retryable offline thought and restart the controlled PWA page

Set the context offline, submit a third distinct thought, and assert its persisted `Not sent`/`Retry` recovery group. Close the page entirely while keeping the browser context so IndexedDB and the controlling service worker remain.

Open a new page in the same offline context and navigate to `/`. Assert:

- the PWA shell loads from the service worker;
- the previous accepted authored turns are visible;
- the distinct offline thought is visible with `Not sent` and an actionable `Retry` button;
- opening Capsules shows the saved capsule and its authored working position;
- no horizontal overflow or fatal storage-recovery screen appears.

Do not reconnect or fulfill a retry in this test; the purpose is durable offline restart, not network recovery (already covered elsewhere).

**Verify**: focused PWA test passes with the browser context offline during the second page's complete startup.

### Step 3: Run browser regression gates

Run E2E typecheck and the full Plan 004 composite E2E command. Confirm the PWA test still executes only once in Chromium 375 and the expected duplicate projects remain intentional skips.

**Verify**: typecheck and full browser gate exit 0.

## Test plan

- Use unique text for accepted turn one, accepted turn two, and failed offline turn so assertions cannot match the wrong record.
- Assert the capsule's actual saved content after restart, not only the library dialog title.
- Keep the page replacement inside the same context to model a service-worker-controlled browser restart while preserving origin storage.
- The test must fail if it sees only the empty starter after restart.

## Done criteria

- [ ] The service-worker-enabled test creates a thread and capsule before going offline.
- [ ] A failed offline thought is persisted before page shutdown.
- [ ] A brand-new service-worker-controlled page starts fully offline and restores accepted turns, capsule content, and actionable retry state.
- [ ] The test runs only in Chromium 375 and passes without retries.
- [ ] Full E2E and E2E typecheck pass.
- [ ] Only in-scope files changed.

## STOP conditions

Stop and report if:

- The new page cannot start offline because the built service worker fails to control/cache the app shell.
- Authored IndexedDB data is absent or corrupt after the page restart.
- A real product fix outside the two test files is required.
- Page routing cannot coexist with a service-worker-enabled context without bypassing the production request path; do not replace it with a fake in-memory app.
- The same verification fails twice after one focused test correction.

## Maintenance notes

This is the durable local-first browser restart proof. Future storage migrations, PWA caching changes, and retry-state changes must keep it green. Standalone installed-app and physical-device checks remain separate operator responsibilities.
