# Plan 003: Enforce two-turn gather eligibility at every boundary

> **Executor instructions**: Follow every step and verification command. Modify only in-scope files. Stop on a STOP condition instead of improvising. Commit in the isolated worktree and do not edit `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 138b6da..HEAD -- src/domain/validators.ts src/domain/validators.test.ts src/application/conversation-service.ts src/application/conversation-service.test.ts src/app/App.tsx src/app/App.test.tsx server/operation-service.ts server/http.test.ts server/mcp.test.ts server/mcp-http.test.ts evals/run-evals.ts`
> Drift from Plans 001 and 002 is expected on their shared files. Confirm that immediate safety is handled before ordinary operation eligibility and reconcile only those known dependency changes; stop on unrelated drift.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-first-class-safety-result.md`
- **Category**: bug
- **Planned at**: commit `138b6da`, 2026-07-12

## Why this matters

The active product contract delays `Gather this thread` until the user has supplied two accepted turns. The PWA hides the button before then, but the application service, JSON API, and MCP tool will gather after a single accepted user turn. That bypasses a deliberate authorship/anti-premature-synthesis boundary. Eligibility must be one shared rule enforced below every UI.

## Current state

- `src/app/App.tsx:111-115` locally counts accepted user turns and exposes Gather at two.
- `src/application/conversation-service.ts:438-486` builds and dispatches a conclusion context without checking the count.
- `server/operation-service.ts:257-312` executes a conclusion request without a gather eligibility check.
- `server/mcp.ts:312-330` exposes `draft_conclusion` directly over the same service.
- `tests/e2e/helpers.ts:46-51` knows the intended rule and throws when its deterministic browser provider receives fewer than two user turns, but that is test-mock behavior, not a production boundary.

The active spec says gathering “appears only after two accepted user turns” and is “opt-in, delayed, and extractive-only.” Existing provisional conclusions may be reopened locally without calling the server.

## Commands you will need

Use the Node 22.23.1 `PATH` from Plan 001.

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run test -- src/application/conversation-service.test.ts src/app/App.test.tsx server/http.test.ts server/mcp.test.ts server/mcp-http.test.ts` | all pass |
| Typecheck | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run typecheck` | exit 0 |
| Full validation | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run validate` | all tests/builds pass |
| Fixed eval | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run eval` | 16 cases, 48 operations, 0 violations |

## Scope

**In scope**:

- `src/domain/validators.ts`
- `src/domain/validators.test.ts`
- `src/application/conversation-service.ts`
- `src/application/conversation-service.test.ts`
- `src/app/App.tsx`
- `src/app/App.test.tsx`
- `server/operation-service.ts`
- `server/http.test.ts`
- `server/mcp.test.ts`
- `server/mcp-http.test.ts`
- `evals/run-evals.ts`

**Out of scope**:

- Adding a new public error code or changing HTTP status mapping. Use the existing typed `invalid_output` failure for an ineligible direct call.
- Changing the two-turn threshold.
- Adding history/thread navigation.
- Modifying gathered-note authorship or result shape.
- Allowing the UI to gather earlier for any topic.

## Git workflow

- Use the cumulative isolated executor branch containing Plan 001 (and Plan 002 if executed in table order).
- Conventional commit: `fix: enforce delayed gathering`.
- Do not push, merge, or open a PR.

## Steps

### Step 1: Define one shared eligibility predicate

In the domain validator layer, export a named constant for the required accepted-user-turn count (`2`) and a predicate that returns true only when at least that many turns have `role === 'user'` and `deliveryState === 'accepted'`. The predicate must ignore pending, failed, Specular, and system turns.

Add unit tests for zero, one, two, and mixed-role/delivery-state inputs.

**Verify**: `npm run test -- src/domain/validators.test.ts` passes.

### Step 2: Use the predicate in the PWA and application service

Replace the duplicated count in `App.tsx` with the shared predicate. Preserve the existing `|| gathered` behavior so a stored provisional conclusion can be reopened without network work.

In `ConversationService.draftConclusion`, build/validate the current thread context, then return `failure('invalid_output')` before telemetry/provider work when the context is ineligible. Do not count a pending or failed turn. Do not alter existing reopening behavior in `useSpecular`, which reads `thread.provisionalConclusion` before calling the service.

Tests must prove:

- one accepted user turn is rejected and the client/provider is not called;
- one accepted plus one pending/failed turn is rejected;
- two accepted user turns succeed;
- a stored provisional conclusion opens locally without a new call.

**Verify**: application and App focused tests pass.

### Step 3: Enforce the rule in the stateless operation service

In `OperationService.execute`, preserve this order:

1. immediate-safety detection/response from Plan 001;
2. gather eligibility check for `operation === 'conclusion'`;
3. provider readiness and provider execution.

An immediate-safety response must still be returned for a one-turn danger context; it must not be suppressed by gather eligibility. An ordinary one-turn conclusion request returns the existing typed `invalid_output` error without provider work or repair.

Add server and MCP tests for one-turn rejection, two-turn success, no provider call on rejection, and safety precedence. Exercise the real in-memory MCP transport rather than testing only a helper.

**Verify**: server HTTP/MCP focused tests pass.

### Step 4: Keep conclusion eval contexts eligible

The fixed eval context builder currently creates exactly one accepted user turn for every operation. For `operation === 'conclusion'`, add a second, distinct accepted user turn so the harness exercises the normal eligible conclusion path. Preserve the corpus-authored first turn and its existing provenance IDs/excerpts; the synthetic second turn must not change conclusion grounding assertions or add a new qualitative signal. Next-question and Challenge contexts should remain single-turn unless another enforced contract requires otherwise.

Do not bypass the production predicate, weaken the evaluator, or treat `invalid_output` as a passing conclusion. The existing 16-case all-operations eval test must remain the regression proof.

**Verify**: `npm run test -- evals/run-evals.test.ts` and `npm run eval` pass at 16 cases / 48 operations / 0 violations.

### Step 5: Run full gates and scope review

Run typecheck, `npm run validate`, and `npm run eval` under pinned Node. Review `git diff --name-only`.

**Verify**: every command exits 0 and only in-scope files changed.

## Test plan

- Add the predicate matrix to `src/domain/validators.test.ts`.
- Use the existing one-turn conclusion fixtures in `src/application/conversation-service.test.ts`, but change expected behavior to rejection and add a two-turn positive case.
- Extend parameterized immediate-danger cases in `server/http.test.ts` so conclusion safety still succeeds below the ordinary gather threshold.
- Add an MCP tool call with one accepted user turn that returns an error result and does not invoke provider work; add a two-turn positive call.

## Done criteria

- [ ] One shared predicate and one constant define gather eligibility.
- [ ] PWA visibility, application service, JSON API, and MCP all use/enforce the same two-accepted-user-turn rule.
- [ ] Pending, failed, Specular, and system turns never satisfy the threshold.
- [ ] Immediate safety takes precedence over the threshold.
- [ ] Existing gathered notes reopen locally without a second provider call.
- [ ] Fixed conclusion eval contexts contain two accepted user turns while their existing first-turn provenance remains unchanged.
- [ ] Focused tests, typecheck, `npm run validate`, and `npm run eval` pass.
- [ ] Only in-scope files changed.

## STOP conditions

Stop and report if:

- Plan 001 is absent or safety cannot be checked before eligibility.
- The service needs a new error code or public schema change to enforce the rule; that is outside this bounded plan.
- Existing production behavior intentionally supports single-turn gathering in a current, non-superseded decision document.
- A verification fails twice after one focused correction attempt.

## Maintenance notes

Any future threshold change must update the shared constant and its boundary tests. Do not rely on UI visibility as authorization; MCP and native clients remain independently callable.
