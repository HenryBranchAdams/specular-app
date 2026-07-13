# Plan 001: Give immediate-safety responses a first-class contract

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. Touch only the files listed as in scope. If a STOP condition occurs, stop and report; do not improvise. Commit the work in the isolated executor worktree. The reviewer maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**: `git diff --stat 138b6da..HEAD -- src/domain/schemas.ts src/domain/schemas.test.ts src/domain/contracts.ts src/domain/validators.ts src/domain/validators.test.ts src/application/http-questioning-client.ts src/application/conversation-service.ts src/application/conversation-service.test.ts src/app/use-specular.ts src/app/App.test.tsx src/app/App.task6.test.tsx server/safety.ts server/operation-service.ts server/http.test.ts server/mcp.ts server/mcp.test.ts server/mcp-http.test.ts server/mcp-test-harness.ts server/specular-widget.test.ts public/specular-widget.html evals/run-evals.ts evals/run-evals.test.ts`
> If any in-scope file changed, compare the excerpts below against live code. If the current semantics differ, stop and report the drift.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none
- **Category**: bug / tech-debt
- **Planned at**: commit `138b6da`, 2026-07-12

## Why this matters

Immediate-safety guidance is currently disguised as normal product output. A gather request can receive server-authored crisis guidance encoded as a `working_conclusion`; the PWA can persist it as gathered notes, and the widget labels it “Exact words from this thread.” Conversely, every ordinary `counter_position` is labeled as safety in the widget. Safety semantics must be explicit so every surface can render guidance without misrepresenting authorship or opening the conclusion editor.

## Current state

- `server/safety.ts:80-109` returns one of the normal operation shapes. The conclusion branch uses server-authored fields and a provenance excerpt that is not in the user turn:

  ```ts
  case 'conclusion':
    return {
      kind: 'working_conclusion',
      thesis: guidance,
      // server-authored fields omitted here
      provenance: [{
        turnId: sourceTurnId(context),
        excerpt: 'An immediate safety concern needs attention.',
      }],
    };
  ```

- `server/operation-service.ts:262-277` structurally validates that value as the requested operation and returns it before provider work.
- `src/application/conversation-service.ts:193-197,448-486` checks only whether provenance turn IDs belong to accepted user turns before persisting a conclusion; it does not call the existing exact-authorship validator.
- `src/domain/validators.ts:471-525` already contains the canonical exact-authorship rule: every provenance excerpt must occur in an accepted user turn, and every gathered field must exactly equal one distinct excerpt.
- `public/specular-widget.html:472-506` labels all `counter_position` values as “Safety / Immediate support” and all `working_conclusion` values as “Exact words from this thread.”
- `src/components/Transcript.tsx:43-49` hides every stored turn whose `operation` is `conclusion`. A first execution attempt proved that persisting immediate-safety guidance with the interrupted Gather operation makes the safety turn invisible even though the service succeeds.
- `evals/run-evals.ts:181-184,503-525` models evaluated output as normal `OperationResult`, but reads the broader service success value directly. Safety must be handled explicitly as a non-normal evaluation outcome for the current question/challenge/gather dimensions.
- `src/domain/contracts.ts:42-46` defines the client-facing `QuestioningProvider` methods as operation-specific normal results only.

The active product vocabulary is “Test this” and “Gather this thread.” Gathering is exact-extractive only. Immediate-safety guidance may interrupt any requested operation, but it is never a gathered position and must not be stored as user-authored provenance.

## Target contract

Add a strict shared domain result with this semantic shape (names may differ only if all tests and consumers stay equally explicit):

```ts
{
  kind: 'immediate_safety';
  guidance: string;
  question: string;
}
```

Keep `OperationResult` as the union of normal model/product results. Introduce a separate response union such as `OperationResponse = OperationResult | ImmediateSafetyResult`. This prevents model-provider validation from accepting a fabricated safety discriminator while allowing the server boundary and HTTP client to transport the safety response.

## Commands you will need

The host default Node is incompatible. Use the pinned runtime already installed on this machine:

| Purpose | Command | Expected on success |
|---|---|---|
| Runtime | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin node --version` | `v22.23.1` |
| Install in fresh worktree | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm ci` | exit 0 |
| Focused tests | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run test -- src/domain/schemas.test.ts src/domain/validators.test.ts src/application/conversation-service.test.ts src/app/App.test.tsx src/app/App.task6.test.tsx server/http.test.ts server/mcp.test.ts server/mcp-http.test.ts server/specular-widget.test.ts` | all selected tests pass |
| Typecheck | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run typecheck` | exit 0 |
| Full validation | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run validate` | 27+ files and 379+ tests pass; builds pass |
| Product eval | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run eval` | 16 cases, 48 operations, 0 violations |
| Production verifier | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run verify:production` | `ok: true`, all named checks pass |

## Scope

**In scope** (only these files may be modified):

- `src/domain/schemas.ts`
- `src/domain/schemas.test.ts`
- `src/domain/contracts.ts`
- `src/domain/validators.ts`
- `src/domain/validators.test.ts`
- `src/application/http-questioning-client.ts`
- `src/application/conversation-service.ts`
- `src/application/conversation-service.test.ts`
- `src/app/use-specular.ts`
- `src/app/App.test.tsx`
- `src/app/App.task6.test.tsx`
- `server/safety.ts`
- `server/operation-service.ts`
- `server/http.test.ts`
- `server/mcp.ts`
- `server/mcp.test.ts`
- `server/mcp-http.test.ts`
- `server/mcp-test-harness.ts`
- `server/specular-widget.test.ts`
- `public/specular-widget.html`
- `evals/run-evals.ts`
- `evals/run-evals.test.ts`

**Out of scope**:

- Safety detection regexes, regional phone numbers, or guidance wording.
- Adding authentication, accounts, telemetry fields, or persistence.
- Changing ordinary question, challenge, or gathering limits; Plan 002 owns ordinary-question limits.
- Changing the public tool names or operation identifiers (`conclusion` and `draft_conclusion` remain compatibility identifiers).
- Visual redesign outside the widget labels needed for semantic correctness.

## Git workflow

- Work only on the isolated branch/worktree assigned by the reviewer.
- Use conventional commits consistent with history, e.g. `fix: separate immediate safety results`.
- Do not push, merge, or open a PR.

## Steps

### Step 1: Add an explicit safety response schema and response union

In `src/domain/schemas.ts`, add a strict `immediateSafetyResultSchema` with bounded non-empty `guidance` and `question` fields. Export its inferred type and an `operationResponseSchema`/type that unions it with the existing `operationResultSchema`; do not add `immediate_safety` to `OperationResult` itself. Re-export the new types through `src/domain/contracts.ts`.

Widen each `QuestioningProvider` method return type to its normal operation result or `ImmediateSafetyResult`. Add a validator/parser that accepts `immediate_safety` unchanged but sends every normal value through `validateOperationResult(operation, value)`. Do not let an OpenAI provider generation bypass normal operation validation by claiming `immediate_safety`.

Add schema/validator tests proving strict fields, bounds, unknown-field rejection, and that a normal operation kind cannot be substituted for another operation.

**Verify**: focused domain tests pass and `npm run typecheck` exits 0.

### Step 2: Return the explicit shape from the server safety path

Change `createSafetyResult` to return the same `ImmediateSafetyResult` for all three requested operations. Remove the operation switch and the fabricated conclusion provenance. Preserve `requiresImmediateSafetyResponse`, regional guidance, and provider bypass behavior.

Update `OperationServiceResult` to carry the response union. In `createOperationService.execute`, return the safety value directly after the new response validation; provider-generated output must continue through `validateProviderResult`, including exact conclusion-authorship validation.

Extend server tests to prove, for `next_question`, `challenge`, and `conclusion`:

- the provider is not called;
- the successful value has `kind: 'immediate_safety'`;
- no `working_conclusion`, provenance, or authored-content field is present;
- telemetry remains metadata-only.

**Verify**: `npm run test -- server/http.test.ts server/mcp.test.ts server/mcp-http.test.ts` passes.

### Step 3: Handle safety without opening or persisting a conclusion

Update `HttpQuestioningClient` to parse the response union and return safety for any operation. In `ConversationService`, add one shared content formatter for immediate-safety guidance plus its question, then branch before normal operation parsing:

- next question: accept the pending user turn and persist a Specular response turn while preserving the current understanding;
- challenge: persist a Specular response turn and leave provisional conclusion unchanged;
- gather: persist a Specular response turn, do not create `WorkingConclusion`, and do not set `thread.provisionalConclusion`.

For all three safety branches, persist the response turn with `operation: 'next_question'` because the stored artifact is guidance plus one immediate question, not a Challenge or gathered conclusion. The response envelope and server telemetry still retain the originally requested operation. This mapping keeps safety visible in the existing transcript without changing persisted schemas or teaching `Transcript` to infer semantics from authored text.

Make the gather service result discriminated so `useSpecular` can distinguish a gathered conclusion from immediate safety. On safety, update the thread/turn view and keep `conclusion: null`; never open `ConclusionEditor`. For every normal conclusion, replace the weak turn-ID-only check with `validateConclusionAuthorship(validated, context.turns)` before persistence.

Add application and App tests for safety returned during all operations, especially a gather request. Assert the editor does not open and the safety text appears as a normal Specular response.

Extend the existing real `HttpQuestioningClient` cases in `src/application/conversation-service.test.ts` for all three methods. Feed a successful HTTP envelope containing `immediate_safety` to `nextQuestion`, `challenge`, and `draftConclusion`; assert each method returns the safety value rather than rejecting it as `invalid_output`. These assertions are mandatory seam coverage and cannot be replaced by fake-provider service tests.

**Verify**: `npm run test -- src/application/conversation-service.test.ts src/app/App.test.tsx` passes.

### Step 4: Make MCP and the widget render safety explicitly

Each MCP tool output schema must accept its normal result or the strict immediate-safety result. Keep the compatibility bridge localized in `server/mcp.ts`; do not broaden output schemas to `unknown`. Update text fallback so safety guidance/question is described as immediate support, while a normal counter-position remains a Test response.

In the widget:

- add an `immediate_safety` render case labeled `Safety` / `Immediate support`;
- render `guidance` and `question` as text only;
- relabel normal `counter_position` as `Test` / `Counter-position`;
- keep normal `working_conclusion` labeled as exact gathered user words.

Update source/contract tests and MCP in-memory transport tests for all three tools. Assert no safety value is mislabeled as gathered notes and no ordinary counter-position is mislabeled as safety.

**Verify**: `npm run test -- server/mcp.test.ts server/mcp-http.test.ts server/specular-widget.test.ts` passes.

### Step 5: Run the complete contract and production gates

Before the full gates, update the eval execution boundary so `ImmediateSafetyResult` is never assigned to `OperationEvaluation.output`. When the local detector returns safety for a corpus case, set `serviceOk` false for the existing normal-operation dimensions and retain only the optional normal candidate for diagnostic evaluation. Add an eval regression case whose input triggers immediate safety and prove the normal eval gate fails rather than crashing, widening `OperationResult`, or treating guidance as a question/challenge/conclusion.

Run the focused tests (including `evals/run-evals.test.ts`), typecheck, `npm run validate`, `npm run eval`, and `npm run verify:production` with the pinned runtime. If the production verifier needs loopback access, request the reviewer/operator to run it rather than weakening the check.

**Verify**: every command exits 0; fixed eval remains 16/48/0; production verifier reports all 10 checks.

## Test plan

- Model domain tests after `src/domain/validators.test.ts` and `src/domain/schemas.test.ts`.
- Model provider-bypass and three-operation safety tests after the existing immediate-danger parameterized cases in `server/http.test.ts` and `server/mcp.test.ts`.
- Model application persistence assertions after `src/application/conversation-service.test.ts` tests that verify accepted exchanges and conclusion provenance.
- Extend the `HttpQuestioningClient` cases near the bottom of `src/application/conversation-service.test.ts`; they must exercise the actual response parser for all three operation methods.
- Model the UI assertion after the gather flow in `src/app/App.test.tsx`, but inject `immediate_safety` and assert the Working position textbox is absent.
- Update the widget source test to require the new case and correct labels.

## Done criteria

- [ ] `immediate_safety` exists as a strict shared response but is not a provider-generated `OperationResult` variant.
- [ ] Immediate danger returns the same explicit safety shape for all operations without provider work.
- [ ] A gather safety response cannot create or persist a `WorkingConclusion` or provenance.
- [ ] Every immediate-safety response turn is stored with `operation === 'next_question'` and remains visible in the transcript, including when it interrupted Challenge or Gather.
- [ ] Every normal gathered conclusion passes `validateConclusionAuthorship` in the client application boundary.
- [ ] Normal counter-positions are not labeled safety; safety is not labeled gathered notes.
- [ ] Eval execution handles safety explicitly as outside its normal operation-result dimensions and has a regression test for a detector-triggering corpus input.
- [ ] Focused tests, typecheck, `npm run validate`, `npm run eval`, and `npm run verify:production` pass.
- [ ] `git diff --name-only` contains only in-scope files.

## STOP conditions

Stop and report if:

- A host/MCP constraint cannot express a union of the normal tool output and the strict safety shape without dropping output-schema validation.
- Correct handling appears to require changing regional guidance or the safety detector rather than only the result contract.
- A normal provider can emit `immediate_safety` without passing through the local detector.
- Existing persisted IndexedDB records require a schema migration; this plan should change response semantics, not stored record shapes.
- Making safety visible would require changing `Transcript` or the persisted turn schema after applying the explicit `next_question` safety-turn mapping.
- Any verification fails twice after one focused correction attempt.

## Maintenance notes

Future operation kinds must explicitly decide whether immediate safety can interrupt them. Reviewers should scrutinize every exhaustive switch, MCP output schema, and the gather path. Keep server-authored guidance out of conclusion provenance permanently.
