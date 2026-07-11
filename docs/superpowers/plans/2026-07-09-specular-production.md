# Specular Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace the current JavaScript prototype with the approved production Specular mobile PWA, stateless model service, shared ChatGPT/MCP app, feature-flagged Realtime voice path, and reproducible production controls.

**Architecture:** A React and TypeScript client owns all user content in versioned IndexedDB repositories scoped to ownerScope local. A stateless TypeScript server exposes schema-validated question, Challenge, conclusion, Realtime-session, health, readiness, and MCP operations through one shared application layer; only the server can instantiate the OpenAI adapter. Deterministic providers are injected only by tests, and production without OPENAI_API_KEY returns a typed unavailable error.

**Tech Stack:** React, TypeScript, Vite, vite-plugin-pwa, idb, Zod, OpenAI JavaScript SDK, MCP Apps SDK, Vitest, Testing Library, fake-indexeddb, Playwright, axe-core, Lighthouse CI, ESLint, Docker, and GitHub Actions.

## Global Constraints

- Normal Specular turns contain at most one short setup sentence followed by one independently understandable question, no more than 45 words, and exactly one question mark.
- A blind-spot Challenge contains one question, no more than 55 words, and exactly one question mark.
- A counter-position Challenge contains one compact opposing case, no more than 100 words, and ends with exactly one question.
- No user-facing path may ask “why,” “what makes you think,” “what led you to believe,” or “how come.”
- No interface exposes academic lens names, reasoning modes, scores, streaks, feeds, dashboards, progress bars, or gamification.
- Synthesis happens only after the user invokes Draft a conclusion; its working thesis is at most 150 words, contains three to five insights, and no more than three unresolved tensions.
- Every persisted aggregate contains ownerScope, initially the constant local, and all repository reads and writes are owner-scoped.
- The server persists no conversation or capsule content and logs no prompt, transcript, conclusion, user-authored text, or raw model output.
- User turns are persisted before network dispatch, and invalid model output is repaired exactly once before a typed recoverable error is returned.
- The client never receives the long-lived OpenAI API key; Realtime uses short-lived browser credentials and remains behind a disabled-by-default feature flag.
- The app remains fully usable without microphone permission or model availability.
- Every interactive target is at least 44 by 44 CSS pixels and the app supports 320 through 430 CSS-pixel widths, safe-area insets, visible focus, text scaling, reduced motion, increased contrast, and non-color state labels.
- The primary mobile thread route must gate at Lighthouse performance 90 or higher and accessibility 100, with no scripted interaction animation producing a main-thread task longer than 50 milliseconds.
- Web and ChatGPT/MCP surfaces use the same domain schemas, operation names, validators, and questioning rules; MCP always returns a text compatibility response.
- TypeScript switch statements over discriminated unions and enums use an assertNever default, and all imports remain at module top level.
- OPENAI_API_KEY is not required for deterministic tests, builds, or fixed evals; production model calls and live smoke tests remain explicitly gated until Henry provisions it.

---

### Task 1: TypeScript Toolchain and Shared Domain Contracts

**Files:**
- Modify: package.json
- Modify: index.html
- Delete: src/main.jsx
- Create: tsconfig.json
- Create: tsconfig.node.json
- Create: vite.config.ts
- Create: eslint.config.js
- Create: src/main.tsx
- Create: src/domain/contracts.ts
- Create: src/domain/schemas.ts
- Create: src/domain/validators.ts
- Create: src/domain/validators.test.ts
- Create: src/test/setup.ts

**Interfaces:**
- Produces: OwnerScope, Thread, Turn, ThreadUnderstanding, WorkingConclusion, Capsule, QuestioningProvider, OperationResult, SpecularError, and strict Zod schemas used by every later task.
- Produces: validateOperationResult(operation, unknown) returning a typed result or ProductValidationError.

- [ ] **Step 1: Install the production and quality toolchain**

Run:

~~~bash
npm install -D typescript @types/node @types/react @types/react-dom vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom fake-indexeddb eslint @eslint/js typescript-eslint
~~~

Expected: package-lock.json resolves one version of React, TypeScript, Zod, and the OpenAI SDK with no install error.

- [ ] **Step 2: Add failing validator tests**

Create tests that instantiate one valid result per operation and assert all hard failures:

~~~ts
import { describe, expect, it } from 'vitest';
import { validateOperationResult } from './validators';

describe('validateOperationResult', () => {
  it('accepts one concise normal question', () => {
    expect(validateOperationResult('next_question', {
      kind: 'question',
      setup: 'Let us make the boundary concrete.',
      question: 'Which customer would notice the difference first?',
      understanding: { claims: [], observations: [], stakeholders: ['customer'], contexts: [], distinctions: [], tensions: [], exploredBlindSpots: [], unexploredBlindSpots: [] },
    }).kind).toBe('question');
  });

  it.each([
    'Why does that matter?',
    'What makes you think that is true?',
    'What led you to believe the launch failed?',
    'How come nobody objected?',
  ])('rejects prohibited justification question: %s', (question) => {
    expect(() => validateOperationResult('next_question', {
      kind: 'question',
      question,
      understanding: { claims: [], observations: [], stakeholders: [], contexts: [], distinctions: [], tensions: [], exploredBlindSpots: [], unexploredBlindSpots: [] },
    })).toThrow(/prohibited_question/);
  });

  it('rejects multiple normal questions', () => {
    expect(() => validateOperationResult('next_question', {
      kind: 'question',
      question: 'Who noticed first? What changed next?',
      understanding: { claims: [], observations: [], stakeholders: [], contexts: [], distinctions: [], tensions: [], exploredBlindSpots: [], unexploredBlindSpots: [] },
    })).toThrow(/question_count/);
  });

  it('rejects unsolicited conclusion content as a normal turn', () => {
    expect(() => validateOperationResult('next_question', {
      kind: 'question',
      setup: 'The answer is that you should leave.',
      question: 'Which detail supports that decision?',
      understanding: { claims: [], observations: [], stakeholders: [], contexts: [], distinctions: [], tensions: [], exploredBlindSpots: [], unexploredBlindSpots: [] },
    })).toThrow(/unsolicited_synthesis/);
  });

  it('accepts both Challenge shapes and bounded conclusions', () => {
    expect(validateOperationResult('challenge', {
      kind: 'blind_spot',
      question: 'Which person bears the cost if this assumption is wrong?',
    }).kind).toBe('blind_spot');
    expect(validateOperationResult('challenge', {
      kind: 'counter_position',
      counterPosition: 'A credible alternative is that speed protects the team from polishing the wrong idea.',
      question: 'What evidence would distinguish haste from useful compression?',
    }).kind).toBe('counter_position');
    expect(validateOperationResult('conclusion', {
      kind: 'working_conclusion',
      thesis: 'My current read is that the team needs a smaller reversible launch.',
      insights: ['The risk is coordination, not demand.', 'A reversible launch preserves learning.', 'The user values a clear decision boundary.'],
      observations: ['Two prior launches stalled during handoff.'],
      tensions: ['Speed may reduce stakeholder confidence.'],
      caveats: ['The thread contains no customer interview evidence.'],
      provenance: [{ turnId: 'turn-1', excerpt: 'The handoff is where it gets stuck.' }],
    }).kind).toBe('working_conclusion');
  });
});
~~~

- [ ] **Step 3: Verify the tests fail for missing contracts**

Run: npm run test -- src/domain/validators.test.ts

Expected: FAIL because contracts and validators do not exist.

- [ ] **Step 4: Define exact shared contracts and schemas**

Use branded string aliases for ThreadId, TurnId, CapsuleId, and globally generated identifiers. Define ownerScope as the literal local. Define discriminated unions for:

~~~ts
export type Operation = 'next_question' | 'challenge' | 'conclusion';
export type TurnRole = 'user' | 'specular' | 'system';
export type Modality = 'text' | 'voice';
export type DeliveryState = 'pending' | 'accepted' | 'failed';

export interface QuestioningProvider {
  nextQuestion(context: ThreadContext): Promise<NextQuestionResult>;
  challenge(context: ThreadContext): Promise<ChallengeResult>;
  draftConclusion(context: ThreadContext): Promise<WorkingConclusionResult>;
}

export function assertNever(value: never): never {
  throw new Error('Unhandled discriminated union variant: ' + JSON.stringify(value));
}
~~~

ThreadContext must contain only the selected thread’s ordered turns, current structured understanding, optional provisional conclusion, and operation. Zod schemas must be strict, bound all user strings and arrays, and mirror the TypeScript types through z.infer rather than duplicate handwritten response types.

- [ ] **Step 5: Implement deterministic product validators**

Implement wordCount, questionMarkCount, containsProhibitedQuestion, containsFiller, and validateOperationResult. Use a switch on operation with an assertNever default. Reject invalid shapes with ProductValidationError carrying a stable code from: schema_invalid, prohibited_question, question_count, word_limit, filler, unsolicited_synthesis, challenge_shape, or conclusion_shape.

- [ ] **Step 6: Add scripts and strict compiler/lint configuration**

Preserve the runnable prototype server and its chatgpt:server/chatgpt:inspect scripts until Task 4 replaces it. package.json scripts in this task must include dev, build, preview, test, test:watch, lint, typecheck, and validate. TypeScript must enable strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, and noFallthroughCasesInSwitch.

- [ ] **Step 7: Run and commit the foundation**

Run:

~~~bash
npm run test -- src/domain/validators.test.ts
npm run typecheck
npm run lint
~~~

Expected: all commands PASS with zero errors.

Commit: feat: establish Specular production contracts

---

### Task 2: Versioned Owner-Scoped IndexedDB Persistence

**Files:**
- Create: src/storage/repositories.ts
- Create: src/storage/indexed-db.ts
- Create: src/storage/migrations.ts
- Create: src/storage/export.ts
- Create: src/storage/indexed-db.test.ts

**Interfaces:**
- Consumes: Thread, Turn, Capsule, OwnerScope, and stable identifiers from Task 1.
- Produces: ThreadRepository, TurnRepository, CapsuleRepository, PreferencesRepository, ExportRepository, and createLocalRepositories(ownerScope, indexedDBFactory?).

- [ ] **Step 1: Install the IndexedDB adapter**

Run: npm install idb

Expected: idb is recorded as a production dependency.

- [ ] **Step 2: Write failing repository, migration, export, import, and delete tests**

Tests must prove:

~~~ts
it('never returns another owner scope', async () => {
  const local = await createLocalRepositories('local', indexedDB);
  await local.threads.put(makeThread({ id: 'thread-local', ownerScope: 'local' }));
  await seedRawAggregate({ id: 'thread-other', ownerScope: 'other' });
  expect((await local.threads.list()).map((thread) => thread.id)).toEqual(['thread-local']);
});

it('persists a pending user turn before any provider await', async () => {
  const repositories = await createLocalRepositories('local', indexedDB);
  await repositories.turns.put(makeTurn({ id: 'turn-1', deliveryState: 'pending' }));
  expect((await repositories.turns.get('turn-1'))?.deliveryState).toBe('pending');
});

it('round trips stable ids through export and import', async () => {
  const first = await createLocalRepositories('local', indexedDB);
  await seedCompleteThread(first);
  const archive = await first.export.exportAll();
  await first.export.deleteAll();
  await first.export.importAll(archive);
  expect(await first.export.exportAll()).toEqual(archive);
});
~~~

Also cover schema version 1 creation, migration rollback preserving the original database, cascade deletion of a thread and its turns, capsule permanent deletion, sanitized export filenames, and deletion of all content.

- [ ] **Step 3: Verify tests fail**

Run: npm run test -- src/storage/indexed-db.test.ts

Expected: FAIL because createLocalRepositories is missing.

- [ ] **Step 4: Implement repository interfaces and IndexedDB schema**

Use database name specular-local and explicit version 1 stores:

~~~ts
export interface SpecularDbSchema extends DBSchema {
  threads: { key: [OwnerScope, ThreadId]; value: Thread; indexes: { 'by-owner-updated': [OwnerScope, number] } };
  turns: { key: [OwnerScope, TurnId]; value: Turn; indexes: { 'by-thread-position': [OwnerScope, ThreadId, number] } };
  capsules: { key: [OwnerScope, CapsuleId]; value: Capsule; indexes: { 'by-owner-updated': [OwnerScope, number] } };
  preferences: { key: [OwnerScope, string]; value: UserPreference };
}
~~~

Every repository method must build the ownerScope into its key or index range; no caller may provide an unscoped query.

- [ ] **Step 5: Implement atomic migrations and recovery**

Keep migrations as a numbered top-level array. The upgrade transaction must abort on failure. Surface StorageMigrationError with databaseName, fromVersion, and toVersion but no user content. Block repository writes after migration failure and expose exportRecoverySnapshot without deleting or overwriting the original database.

- [ ] **Step 6: Implement validated export, import, and permanent deletion**

Export JSON must include format: specular-export, version: 1, exportedAt, ownerScope, threads, turns, capsules, and preferences. Validate imports strictly before a single write, preserve all ids, reject non-local owner scopes in the initial product, escape rendered content through React text nodes only, and sanitize the downloaded filename to specular-export-YYYY-MM-DD.json.

- [ ] **Step 7: Verify and commit persistence**

Run:

~~~bash
npm run test -- src/storage/indexed-db.test.ts
npm run typecheck
~~~

Expected: repository, migration, export/import, and deletion tests PASS.

Commit: feat: add local-first Specular persistence

---

### Task 3: Conversation Application Service and Typed Network Client

**Files:**
- Create: src/application/conversation-service.ts
- Create: src/application/context-builder.ts
- Create: src/application/http-questioning-client.ts
- Create: src/application/product-telemetry.ts
- Create: src/application/conversation-service.test.ts

**Interfaces:**
- Consumes: owner-scoped repositories and domain schemas.
- Produces: ConversationService with startThread, submitUserTurn, retryTurn, challenge, draftConclusion, keepDigging, saveCapsule, finishThread, exportAll, deleteThread, deleteCapsule, and deleteAll.

- [ ] **Step 1: Write failing orchestration tests**

Use an injected deferred provider and call-order array to prove the user turn write completes before the network promise begins. Assert accepted assistant output and updated understanding are persisted only after validation; timeout leaves the user turn failed and retryable; retry does not duplicate content; challenge and conclusion require explicit method calls; finishThread closes the old thread and creates a clean new thread; and buildThreadContext never includes another thread.

- [ ] **Step 2: Verify tests fail**

Run: npm run test -- src/application/conversation-service.test.ts

Expected: FAIL because ConversationService is missing.

- [ ] **Step 3: Implement minimum-context construction**

buildThreadContext(threadId, operation) must load only that thread, its ordered turns, its compact understanding, and its provisional conclusion. It must cap turn content and total payload length according to the schemas while retaining provenance ids. Starting a thread creates no link to any prior thread.

- [ ] **Step 4: Implement submit, retry, Challenge, and conclusion flows**

Each public operation returns:

~~~ts
export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SpecularError };
~~~

Use assertNever when mapping error and operation unions. Persist a user turn as pending before calling HttpQuestioningClient. Map offline, timeout, provider_unavailable, invalid_output, rate_limited, and storage_failure to concise typed errors. Never substitute deterministic output after a failed request.

- [ ] **Step 5: Implement opt-in local product telemetry**

Default telemetryEnabled to false in owner-scoped preferences. ProductTelemetry records only aggregate event names and timestamps after opt-in: thread_started, turn_sent, challenge_requested, conclusion_requested, capsule_saved, voice_started, and recoverable_error. It must accept no arbitrary properties or authored strings, and disabling telemetry permanently clears queued local events.

- [ ] **Step 6: Implement conclusion lifecycle and capsule provenance**

keepDigging persists the edited conclusion as provisional context on the same thread. saveCapsule persists the user-edited thesis and structure with source thread id and inclusive turn range. finishThread marks the line complete and returns a fresh empty thread. User edits always replace provider wording before save.

- [ ] **Step 7: Verify and commit the application layer**

Run:

~~~bash
npm run test -- src/application/conversation-service.test.ts
npm run typecheck
~~~

Expected: all orchestration tests PASS.

Commit: feat: orchestrate private Specular threads

---

### Task 4: Stateless Model Service, Repair Flow, Safety, and Privacy Controls

**Files:**
- Create: server/index.ts
- Create: server/http.ts
- Create: server/config.ts
- Create: server/openai-provider.ts
- Create: server/operation-service.ts
- Create: server/prompts.ts
- Create: server/telemetry.ts
- Create: server/rate-limit.ts
- Create: server/safety.ts
- Create: server/http.test.ts

**Interfaces:**
- Consumes: shared schemas, validators, QuestioningProvider, and ThreadContext.
- Produces: POST /api/operations/next-question, /api/operations/challenge, /api/operations/conclusion; GET /healthz and /readyz; POST /api/realtime/session in Task 8.

- [ ] **Step 1: Install the server adapter and add server scripts**

Run: npm install openai

Add dev:server, build:server, start, and audit scripts for the compiled stateless server. Preserve the runnable prototype chatgpt:server/chatgpt:inspect entry until Task 7 integrates the shared MCP operations into the new server and performs the cutover.

- [ ] **Step 2: Write failing HTTP and service contract tests**

Inject a scripted provider and metadata sink. Prove strict request bounds, origin allowlist, request-size rejection, rate limiting, timeout abort, secure headers and CSP, exactly one repair after invalid output, no repair after valid output, typed invalid_output after two failures, provider_unavailable without OPENAI_API_KEY in production, health without model calls, readiness without billable calls, and no user content in captured logs or telemetry.

- [ ] **Step 3: Verify tests fail**

Run: npm run test -- server/http.test.ts

Expected: FAIL because createHttpServer and createOperationService are missing.

- [ ] **Step 4: Implement privacy-safe configuration and HTTP boundaries**

Parse environment once into:

~~~ts
export interface ServerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  allowedOrigins: string[];
  openAiApiKey?: string;
  openAiModel: string;
  requestTimeoutMs: number;
  requestBytes: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  enableRealtime: boolean;
}
~~~

Reject unknown JSON fields, cap strings and turns, set Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and a specific Access-Control-Allow-Origin only after allowlist validation. Never log request bodies. Default OPENAI_MODEL to gpt-5.5, the current generally available flagship recommended by the official model guide, while allowing an environment override for controlled rollout or pinned snapshots.

- [ ] **Step 5: Implement the provider and structured prompts**

OpenAIQuestioningProvider is server-only and uses the installed OpenAI SDK Responses API with zodTextFormat for strict structured outputs. It must preserve enough ephemeral response data inside the provider/service boundary to route JSON/schema/product-validation failures through the single repair attempt, while never logging, persisting, or returning raw model output. Handle null, refusal, and incomplete responses as typed recoverable provider failures. System instructions must encode one-question, no-why, no filler, user authority, Challenge permission, explicit conclusion, provenance, and safety rules. Model output is parsed with the shared schemas before deterministic validation.

- [ ] **Step 6: Implement one repair attempt and typed errors**

createOperationService calls the provider once, validates, and on ProductValidationError sends the invalid result plus only stable validator codes to provider.repair once. A second invalid result becomes invalid_output. Record request id, operation, latency, provider/model id, token counts if available, schema outcome, repair count, status, and error code; record no authored content or raw output.

- [ ] **Step 7: Implement a clear crisis/safety path**

Safety handling must not diagnose. It must return a schema-valid, concise safety response with immediate-danger guidance appropriate to the configured region, invite concrete next-step information without asking why, and preserve the user’s ability to continue. Ordinary emotionally charged thoughts remain in the normal reflective path.

- [ ] **Step 8: Verify and commit the model service**

Run:

~~~bash
npm run test -- server/http.test.ts
npm run typecheck
npm run lint
~~~

Expected: all server, repair, safety, security-header, and privacy tests PASS.

Commit: feat: add stateless Specular model service

---

### Task 5: Installable Spectral-Glass Mobile Shell and Core Text Loop

**Files:**
- Create: public/manifest.webmanifest
- Create: public/icons/icon.svg
- Create: public/icons/maskable.svg
- Create: src/app/App.tsx
- Create: src/app/use-specular.ts
- Create: src/components/StarterDeck.tsx
- Create: src/components/ThreadHeader.tsx
- Create: src/components/Transcript.tsx
- Create: src/components/Composer.tsx
- Create: src/components/ThreadActions.tsx
- Replace: src/styles.css
- Create: src/app/App.test.tsx

**Interfaces:**
- Consumes: ConversationService and owner-scoped repositories.
- Produces: the canonical mobile PWA empty and thread surfaces with stable accessible labels and data-testid hooks used by Playwright.

- [ ] **Step 1: Install PWA build support**

Run: npm install -D vite-plugin-pwa

Expected: vite-plugin-pwa is recorded as a development dependency.

- [ ] **Step 2: Write failing component tests**

Tests must prove: all eight approved starters render as interchangeable copy; selecting any starter only focuses the composer and does not send a mode or strategy; reduced motion shows a static list; typing and voice controls are immediately available; sending begins a thread; history remains scrollable; the latest question has current-question semantics; Challenge me and Draft a conclusion remain available; new turns and errors use aria-live without moving focus; and every icon button has an accessible name.

- [ ] **Step 3: Verify tests fail**

Run: npm run test -- src/app/App.test.tsx

Expected: FAIL because the production app components are missing.

- [ ] **Step 4: Configure the PWA and stable bootstrap**

Configure VitePWA with display standalone, start_url /, theme/background colors matching the deep black-violet base, generated service worker, offline shell caching, and update prompting. index.html must set viewport-fit=cover, theme-color, description, and manifest. src/main.tsx must render App under StrictMode with no layout-changing async font dependency.

- [ ] **Step 5: Build the empty state and one-plane thread**

The StarterDeck contains the eight exact approved lines. CSS motion uses only translate and opacity, pauses after focus/pointer/keyboard interaction, and becomes a static list under prefers-reduced-motion. The thread uses one primary glass plane, quiet typographic turns, a compact title/capsules header, strong current-question emphasis, and no modes, lens names, dashboard, cards-on-cards, orb, or continuous blur animation.

- [ ] **Step 6: Build the composer and persistent actions**

Composer supports multiline text, submit, disabled/pending/retry labels, voice affordance, safe-area padding, and 44-pixel targets. ThreadActions contains persistent Challenge me and Draft a conclusion controls with text labels. Ambient cyan/ultraviolet/lime light settles while the composer is focused or content is being read.

- [ ] **Step 7: Implement accessible state and mobile CSS**

Use warm-white type on deep black-violet, ember shift with explicit Challenge label, and pearl conclusion state. Include :focus-visible, forced-colors, prefers-contrast, prefers-reduced-motion, low-power class, 200% text zoom, min/max width handling, and env(safe-area-inset-*). Do not render user or model content as HTML.

- [ ] **Step 8: Verify and commit the core PWA**

Run:

~~~bash
npm run test -- src/app/App.test.tsx
npm run build
npm run typecheck
~~~

Expected: component tests and production PWA build PASS.

Commit: feat: build the Specular mobile thinking loop

---

### Task 6: Editable Conclusions, Capsule Library, Export, and Deletion UI

**Files:**
- Create: src/components/ConclusionEditor.tsx
- Create: src/components/CapsuleLibrary.tsx
- Create: src/components/ConfirmDeleteDialog.tsx
- Create: src/components/StorageRecovery.tsx
- Create: src/components/ConclusionEditor.test.tsx
- Create: src/components/CapsuleLibrary.test.tsx
- Modify: src/app/App.tsx
- Modify: src/app/use-specular.ts
- Modify: src/styles.css

**Interfaces:**
- Consumes: ConversationService conclusion, capsule, export, and delete methods.
- Produces: focused pearl conclusion surface and quiet local capsule library.

- [ ] **Step 1: Write failing conclusion and capsule tests**

Prove Draft a conclusion is the only route into synthesis; thesis, three-to-five insights, observations, up-to-three tensions, and caveats are editable; Keep digging returns to the same thread with edited provisional context; Save as capsule preserves edits and provenance; Finish closes the line and opens the starter state; capsules open, edit, export, and delete; destructive actions require explicit confirmation and are irreversible; deleting a thread/capsule/all content removes the corresponding IndexedDB records.

Also prove a storage migration failure stops writes, leaves the original database intact, and presents a StorageRecovery surface that can download the recovery snapshot before any reset action.

- [ ] **Step 2: Verify tests fail**

Run: npm run test -- src/components/ConclusionEditor.test.tsx src/components/CapsuleLibrary.test.tsx

Expected: FAIL because conclusion and capsule components are missing.

- [ ] **Step 3: Build the focused conclusion editor**

Use semantic form fields with explicit labels, character/word guidance, non-color uncertainty labels, and the exact actions Keep digging, Save as capsule, and Finish. Never overwrite local edits when async state changes. Present the thesis as “My current read is…” or “The thread I see is…” unless the user edits it.

- [ ] **Step 4: Build the quiet capsule library**

The header opens a full-height mobile sheet with a chronological capsule list, accessible close behavior, editable detail view, Export, and Permanently delete. It must not look like a feed or dashboard and must not inject capsule content into a new thread.

- [ ] **Step 5: Wire export and permanent deletion**

Use Blob plus an object URL for validated JSON export, revoke the URL after download, and use the sanitized repository filename. Confirm deletion with the artifact title and an irreversible warning. Announce completion through aria-live.

- [ ] **Step 6: Build storage recovery without destructive defaults**

StorageRecovery explains that local data could not be upgraded, offers Download recovery copy as the primary action, and keeps reset unavailable until export succeeds or the user explicitly acknowledges continuing without it. It displays no server details and never retries writes against the failed database.

- [ ] **Step 7: Verify and commit completion surfaces**

Run:

~~~bash
npm run test -- src/components/ConclusionEditor.test.tsx src/components/CapsuleLibrary.test.tsx
npm run typecheck
~~~

Expected: all conclusion, capsule, export, and deletion tests PASS.

Commit: feat: add editable conclusions and capsules

---

### Task 7: Shared ChatGPT/MCP Operations and Spectral Widget

**Files:**
- Create: server/mcp.ts
- Create: server/mcp.test.ts
- Replace: public/specular-widget.html
- Modify: server/http.ts
- Modify: package.json
- Modify: README.md
- Delete: server.js

**Interfaces:**
- Consumes: the same ThreadContext, operation schemas, validators, and operation service as the web API.
- Produces: next_question, challenge, and draft_conclusion MCP tools plus ui://widget/specular.html.

- [ ] **Step 1: Write failing MCP contract tests**

Tests must invoke each tool through an in-memory transport and prove strict thread-scoped inputs, shared output schemas, shared no-why and length validation, text content on every result, no cross-thread state, typed recoverable errors, no server persistence, and widget resource metadata.

- [ ] **Step 2: Verify tests fail**

Run: npm run test -- server/mcp.test.ts

Expected: FAIL because createSpecularMcpServer is missing.

- [ ] **Step 3: Register the three shared operations**

Register next_question, challenge, and draft_conclusion with strict Zod inputs built from ThreadContext and output schemas from Task 1. Each handler delegates to createOperationService and returns both structuredContent and a concise content text fallback. Do not retain session content in module globals or server instances.

Integrate the MCP transport at /mcp on the compiled stateless server, replace chatgpt:server/chatgpt:inspect with that server, and only then delete the prototype server.js so the ChatGPT surface remains runnable between tasks.

- [ ] **Step 4: Replace the prototype widget**

The widget must use the same deep black-violet, warm-white, cyan/ultraviolet/lime, ember, and pearl tokens. It renders compact operation output, labels Challenge and conclusion without color alone, exposes no reasoning modes, keeps 44-pixel controls, supports reduced motion/contrast, treats all content as text, and uses window.openai only for tool input/output, tool calls, and local widget state.

- [ ] **Step 5: Document ChatGPT compatibility and privacy**

README must describe the three operations, text-only fallback, thread-scoped input, lack of cross-thread memory, local widget state limitations, HTTPS requirement, health checks, and OPENAI_API_KEY gating.

- [ ] **Step 6: Verify and commit MCP parity**

Run:

~~~bash
npm run test -- server/mcp.test.ts
npm run build
~~~

Expected: MCP contracts and production builds PASS.

Commit: feat: align ChatGPT app with Specular contracts

---

### Task 8: Feature-Flagged Realtime Voice on the Shared Thread

**Files:**
- Create: src/voice/realtime-client.ts
- Create: src/voice/use-voice.ts
- Create: src/voice/realtime-client.test.ts
- Create: server/realtime.ts
- Create: server/realtime.test.ts
- Modify: src/components/Composer.tsx
- Modify: server/http.ts
- Modify: server/config.ts

**Interfaces:**
- Consumes: shared Turn modality, ConversationService, server configuration, and short-lived Realtime credentials.
- Produces: POST /api/realtime/session and an optional WebRTC voice controller that writes into the same transcript.

- [ ] **Step 1: Write failing server and client voice tests**

Prove the endpoint is 404 or feature_disabled when ENABLE_REALTIME is false; it requires an allowlisted origin and never returns OPENAI_API_KEY; returned credentials are short-lived; microphone denial returns to usable text with focus restored; Realtime failure preserves the typed draft; transcripts persist as modality voice in the active thread; Challenge and conclusion remain the same operations; and disabling voice removes no text capability.

- [ ] **Step 2: Verify tests fail**

Run: npm run test -- src/voice/realtime-client.test.ts server/realtime.test.ts

Expected: FAIL because voice modules are missing.

- [ ] **Step 3: Implement short-lived Realtime credential creation**

Only the server calls the official OpenAI client-secret endpoint with the long-lived key. Return the minimum client secret fields and expiry, set Cache-Control no-store, record metadata only, and use the same origin, rate, timeout, and request-size controls as other APIs.

- [ ] **Step 4: Implement optional WebRTC voice input/output**

Request microphone permission only after the user activates Voice. Feed final transcripts into ConversationService as modality voice and render assistant audio/text in the same ordered transcript. Close tracks, peer connections, and audio elements on stop/unmount. Never create a separate voice history.

- [ ] **Step 5: Add accessible voice states and fallback**

Provide Start voice, Stop voice, Listening, Connecting, and Voice unavailable text; do not rely on waveform/color. Reduced motion replaces energy animation with a static level label. On denial/failure, retain the draft, announce the error, and keep text send available.

- [ ] **Step 6: Verify and commit voice**

Run:

~~~bash
npm run test -- src/voice/realtime-client.test.ts server/realtime.test.ts
npm run typecheck
~~~

Expected: all flag, credential, shared-thread, cleanup, and fallback tests PASS.

Commit: feat: add feature-flagged shared-thread voice

---

### Task 9: Fixed Product Evals and Full Browser Acceptance Suite

**Files:**
- Create: evals/fixed-corpus.json
- Create: evals/run-evals.ts
- Create: evals/subjective-review.md
- Create: playwright.config.ts
- Create: tests/e2e/specular.spec.ts
- Create: tests/e2e/helpers.ts

**Interfaces:**
- Consumes: deterministic scripted providers, validators, built PWA, and test server.
- Produces: zero-hard-violation fixed eval report and mobile acceptance coverage.

- [ ] **Step 1: Add the fixed corpus**

Include at least two cases each for beliefs, decisions, creative ideas, arguments, plans, emotionally charged thoughts, ambiguous fragments, and adversarial prompt attempts. Every case names expected information gaps, forbidden behavior, acceptable Challenge targets, and conclusion provenance.

- [ ] **Step 2: Implement the eval runner**

Run all three operations where applicable. Report counts for useful next question, no-why, no filler/lecture/diagnosis, no premature synthesis, real information gap, credible Challenge, grounded conclusion, uncertainty/user authority, and mobile concision. Exit nonzero on any hard invariant violation. eval:live runs only when OPENAI_API_KEY is present and otherwise exits with an explicit skipped status.

- [ ] **Step 3: Add mobile browser tests**

At 320, 375, and 430 CSS pixels cover first-run, starter animation/static reduced motion, typed thread, user-turn persistence before delayed response, reload persistence, Challenge, editable conclusion, Keep digging, capsule creation/edit/export/delete, finish/new clean context, offline retry, microphone denial, safe areas, 200% text scaling, keyboard-only flow, and no horizontal overflow.

Configure Chromium and WebKit mobile projects plus a documented release-compatibility run for the latest two major iOS Safari and Android Chrome releases. Record exact browser versions in the final audit instead of treating generic emulation as device evidence.

- [ ] **Step 4: Run the fixed and browser gates**

Run:

~~~bash
npm run eval
npm run test:e2e
~~~

Expected: zero hard invariant violations and all browser projects PASS.

- [ ] **Step 5: Document subjective sample review and commit**

Record reviewer, date, corpus version, sample ids, notable strengths, concerns, and disposition in evals/subjective-review.md without copying private live user content.

Commit: test: gate Specular product behavior

---

### Task 10: Accessibility, Performance, Security, CI, and Reproducible Deployment

**Files:**
- Create: lighthouserc.json
- Create: tests/e2e/accessibility.spec.ts
- Create: tests/e2e/performance.spec.ts
- Create: Dockerfile
- Create: .dockerignore
- Create: compose.yaml
- Create: deploy/README.md
- Create: deploy/environments.example
- Create: .github/workflows/ci.yml
- Create: .github/dependabot.yml
- Create: scripts/verify-production.mjs
- Modify: package.json
- Modify: README.md

**Interfaces:**
- Consumes: complete client/server/MCP/voice app.
- Produces: immutable build artifact, health-gated runtime, rollback instructions, CI and dependency automation, and machine-readable production verification.

- [ ] **Step 1: Add automated accessibility and long-task tests**

Use axe-core against empty, thread, Challenge, conclusion, capsule, offline error, and voice states. Assert zero serious/critical violations, visible focus, accessible names, live-region behavior, and 44-pixel targets. Instrument PerformanceObserver for longtask entries during starter motion, send, Challenge activation, conclusion transition, and capsule navigation; fail if any interaction-attributed task exceeds 50 milliseconds.

- [ ] **Step 2: Add Lighthouse production gates**

lighthouserc.json must run the built primary thread route in mobile mode and assert categories:performance minScore 0.9 and categories:accessibility minScore 1.0. It must also assert installable manifest/service worker audits and no console errors.

- [ ] **Step 3: Add security and privacy verification**

scripts/verify-production.mjs must start the immutable server artifact, check health/readiness, CSP and secure headers, origin rejection, request-size rejection, typed provider-unavailable behavior without a key, static/PWA availability during model failure, MCP text fallback, and scan captured logs to prove seeded sentinel user text never appears.

- [ ] **Step 4: Build an immutable database-free deployment**

Use a pinned Node LTS multi-stage Dockerfile that runs npm ci, validate, builds client/server, copies only runtime dependencies/artifacts, runs as a non-root user, and defines a healthcheck. compose.yaml provides development, preview, and production profiles with separate env files; no database service exists. deploy/README.md documents HTTPS termination, secret-store injection, preview promotion, immutable image digest deployment, health verification, rollback to the prior digest, and local-content degradation during provider outage.

- [ ] **Step 5: Add CI and dependency automation**

CI must use npm ci and run lint, typecheck, unit/component/contract tests, fixed evals, production build, browser tests, Lighthouse, npm audit --omit=dev, Docker build, and verify-production. Cache only package downloads and browsers, never secrets or user content. Dependabot opens weekly npm and GitHub Actions updates.

- [ ] **Step 6: Run the complete production gate**

Run:

~~~bash
npm run validate
npm run audit
npm run test:e2e
npx lhci autorun
docker build -t specular:production .
node scripts/verify-production.mjs
~~~

Expected: lint, typecheck, all automated tests, fixed evals, production builds, security checks, mobile browser coverage, Lighthouse performance at least 90, accessibility 100, no interaction long task over 50 milliseconds, Docker health, and privacy sentinel checks all PASS.

- [ ] **Step 7: Perform the acceptance-criteria audit**

Create a final audit table mapping all 13 spec acceptance criteria and every named gate to current authoritative evidence: exact test name/output, built artifact, rendered route, endpoint response, or deployment document. Any missing, indirect, or failing evidence keeps the task open.

- [ ] **Step 8: Commit production hardening**

Commit: chore: complete Specular production gates
