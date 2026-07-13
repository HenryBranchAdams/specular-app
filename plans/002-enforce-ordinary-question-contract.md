# Plan 002: Enforce the current 28-word, no-setup question contract

> **Executor instructions**: Follow this plan step by step, verify each step, modify only in-scope files, and stop on any STOP condition. Commit in the isolated worktree. Do not edit `plans/README.md`; the reviewer owns it.
>
> **Drift check (run first)**: `git diff --stat 138b6da..HEAD -- src/domain/schemas.ts src/domain/schemas.test.ts src/domain/validators.ts src/domain/validators.test.ts src/application/conversation-service.ts src/application/conversation-service.test.ts server/prompts.ts server/prompts.test.ts server/openai-provider.ts server/http.test.ts server/mcp.ts server/mcp.test.ts server/realtime.ts server/realtime.test.ts public/specular-widget.html server/specular-widget.test.ts evals/run-evals.ts evals/run-evals.test.ts`
> This plan expects Plan 001 to be present. Drift caused only by Plan 001 is expected; confirm that immediate-safety guidance now has its own result shape before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-first-class-safety-result.md`
- **Category**: bug / tech-debt
- **Planned at**: commit `138b6da`, 2026-07-12

## Why this matters

The active prompt and design contract require exactly one independently understandable question, no setup sentence, and no more than 28 words. The actual schema, deterministic validator, tests, and eval still accept a setup plus 45 total words. Invalid live output therefore bypasses the one allowed repair and can ship behind a passing gate. After Plan 001 separates safety guidance, the ordinary-question rule can become one executable domain contract.

## Current state

- `server/prompts.ts:13-32` says “Leave setup empty” and “28 words or fewer.”
- `src/domain/schemas.ts:78-83` still declares `setup` optional.
- `src/domain/validators.ts:380-404` combines setup and question and calls `validateQuestionText(..., 45)`.
- `src/domain/validators.test.ts:230-241,380-388` explicitly accepts a setup and 45 words.
- `evals/run-evals.ts:429-451` counts setup plus question and accepts 45 words.
- `server/openai-provider.ts:40-45` still asks the provider for nullable setup output.
- `server/realtime.ts:23-24` separately hard-codes the correct no-setup/28-word voice instruction.

The active source of product intent is `docs/superpowers/specs/2026-07-10-subtle-mystery-refinement-design.md`: the first response proves the product through one precise question; setup copy and model-authored framing are excluded.

## Commands you will need

Use Node 22.23.1 via the installed path shown in Plan 001.

| Purpose | Command | Expected on success |
|---|---|---|
| Focused domain tests | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run test -- src/domain/schemas.test.ts src/domain/validators.test.ts server/prompts.test.ts server/http.test.ts server/mcp.test.ts server/realtime.test.ts evals/run-evals.test.ts` | all pass |
| Typecheck | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run typecheck` | exit 0 |
| Full validation | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run validate` | all tests/builds pass |
| Fixed eval | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run eval` | 16 cases, 48 operations, 0 violations |

## Scope

**In scope**:

- `src/domain/schemas.ts`
- `src/domain/schemas.test.ts`
- `src/domain/validators.ts`
- `src/domain/validators.test.ts`
- `src/application/conversation-service.ts`
- `src/application/conversation-service.test.ts`
- `server/prompts.ts`
- `server/prompts.test.ts`
- `server/openai-provider.ts`
- `server/http.test.ts`
- `server/mcp.ts`
- `server/mcp.test.ts`
- `server/realtime.ts`
- `server/realtime.test.ts`
- `public/specular-widget.html`
- `server/specular-widget.test.ts`
- `evals/run-evals.ts`
- `evals/run-evals.test.ts`

**Out of scope**:

- Challenge limits and shapes.
- Gathered-note limits and authorship rules.
- Immediate-safety guidance; Plan 001 owns its separate shape.
- Prompt tuning beyond expressing the same 28-word/no-setup rule.
- Live-model evaluation or model changes.

## Git workflow

- Use the cumulative isolated executor branch after Plan 001.
- Conventional commit: `fix: enforce concise ordinary questions`.
- Do not push, merge, or open a PR.

## Steps

### Step 1: Define the ordinary question limit once

Export a domain constant such as `MAX_NEXT_QUESTION_WORDS = 28` from `src/domain/schemas.ts` or another existing dependency-safe domain module. Remove `setup` from `nextQuestionResultSchema`; `NextQuestionResult` must contain only `kind`, `question`, and `understanding`.

In `validateNextQuestion`, validate only `question` against the shared 28-word constant. Preserve exactly one terminal question mark, prohibited-question, filler, unsolicited-synthesis, and independence checks. Remove setup-only helpers/tests if no longer used elsewhere.

Add exact boundary tests: 28 words passes, 29 fails with `word_limit`; an unknown `setup` field fails strict schema validation.

**Verify**: domain schema/validator tests and typecheck pass.

### Step 2: Consume the same contract at provider and prompt boundaries

Remove nullable setup from the OpenAI structured output schema and its parsing adapter. Interpolate or reference the shared 28-word constant in `server/prompts.ts` and `server/realtime.ts` so the numeric policy is not independently duplicated. Keep prompt wording concise and behaviorally equivalent.

Update provider/HTTP tests so a 29-word or setup-bearing provider result triggers exactly one repair, while a valid 28-word result does not repair. Immediate-safety results from Plan 001 must remain valid because they no longer use `NextQuestionResult`.

**Verify**: prompt, HTTP, and Realtime focused tests pass.

### Step 3: Remove stale setup handling from consumers

Simplify normal-question content construction in `ConversationService`, MCP text fallback, and widget rendering to use only `question`. The widget may retain a separate guidance element for `immediate_safety`, but the normal `question` case must not read a setup field.

Update exhaustive tests and private-sentinel tests that currently inject setup. Do not weaken the strict schema to preserve old provider output; the server repair path is the compatibility mechanism for live output.

**Verify**: application, MCP, and widget focused tests pass.

### Step 4: Make the eval enforce the active limit

Change `isMobileConcise` for `next_question` to use the shared 28-word limit and the question field only. Update eval mutation tests so 29 words fail and setup-bearing objects fail schema/operation evaluation. Keep the fixed corpus generation deterministic and do not represent it as live-model quality evidence.

**Verify**: `npm run test -- evals/run-evals.test.ts` and `npm run eval` pass with 16/48/0.

### Step 5: Run the full gate

Run typecheck and `npm run validate`, then fixed eval. Inspect `git diff --name-only` for scope.

**Verify**: every command exits 0 and only in-scope files changed.

## Test plan

- Use existing `questionWithWordCount` tests in `src/domain/validators.test.ts` for exact 28/29 boundaries.
- Use existing repair-count tests in `server/http.test.ts` to prove invalid setup/length reaches one repair.
- Update MCP/widget tests to prove normal questions contain no setup while explicit safety guidance still renders.
- Update eval mutations rather than only the happy fixture; the regression test must demonstrate a failing 29-word candidate.

## Done criteria

- [ ] `NextQuestionResult` has no `setup` field.
- [ ] One exported constant defines the 28-word ordinary-question maximum.
- [ ] Provider schema, deterministic validator, Realtime instructions, prompts, MCP fallback, widget, and eval enforce the same rule.
- [ ] Setup-bearing and 29-word ordinary outputs are rejected/repaired; 28-word output passes.
- [ ] Immediate-safety guidance remains valid through its Plan 001 result kind.
- [ ] Focused tests, typecheck, `npm run validate`, and `npm run eval` pass.
- [ ] Only in-scope files changed.

## STOP conditions

Stop and report if:

- Plan 001 is absent or immediate-safety guidance still depends on `NextQuestionResult.setup`.
- A host contract demonstrably requires the optional setup property for backward compatibility and cannot accept its removal.
- Enforcing 28 words requires weakening another validator or changing Challenge/gather behavior.
- A focused correction still leaves the same verification failing twice.

## Maintenance notes

Future ordinary-question policy changes must update the single domain constant and tests, not scattered literals. The live-model gate remains a separate direction item; this plan proves enforceable behavior, not subjective question quality.
