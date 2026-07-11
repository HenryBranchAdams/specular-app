# Specular Product Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition Specular as a neutral, question-led workspace for ideas and theses, then make its conclusions durable through meaningful titles, save-and-finish completion, revisitable capsules, and a focused desktop reasoning map.

**Architecture:** Preserve the existing React hook, application-service, schema, repository, and local-first IndexedDB boundaries. Add deterministic local title derivation, an atomic save-and-finish service path, capsule-to-thread activation methods, and one desktop-only disclosure component backed by the existing `ThreadUnderstanding` structure.

**Tech Stack:** React 19, TypeScript 6, Vitest, Testing Library, IndexedDB via `idb`, Vite, Playwright.

## Global Constraints

- Keep OpenAI credentials server-only and keep all local conversation data owner-scoped.
- Preserve one-question-at-a-time behavior, explicit Challenge, user-editable conclusions, provenance validation, reduced motion, 44px targets, and 320–430px support.
- Use neutral object-focused language: ideas, concepts, theses, decisions, evidence, assumptions, constraints, trade-offs, stakeholders, and criteria.
- Do not introduce a dashboard, hidden starter modes, cross-thread model memory, a new dependency, or a storage migration.
- Use exhaustive `never` checks for every new discriminated union.
- Keep imports at module scope.

---

### Task 1: Reposition the visible and model-authored product language

**Files:**
- Modify: `src/components/starter-prompts.ts`
- Modify: `src/components/Composer.tsx`
- Modify: `src/components/ThreadActions.tsx`
- Modify: `src/components/ConclusionEditor.tsx`
- Modify: `src/components/CapsuleLibrary.tsx`
- Modify: `server/prompts.ts`
- Modify: `vite.config.ts`
- Modify: `public/manifest.webmanifest`
- Modify: `index.html`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-09-specular-production-design.md`
- Modify: `docs/superpowers/specs/2026-07-10-quiet-spectral-refinement-design.md`
- Test: `src/app/App.test.tsx`
- Test: `src/components/Composer.test.tsx`
- Test: `src/components/ConclusionEditor.test.tsx`
- Test: `src/components/CapsuleLibrary.test.tsx`
- Test: `server/http.test.ts`

**Interfaces:**
- Consumes: existing component props and operation prompt builders.
- Produces: the copy contract `What idea do you want to develop?`, `Add an idea, question, thesis, or context…`, `Challenge this`, `Draft a working conclusion`, `Working conclusion`, `Continue developing`, and `Save & finish`.

- [ ] **Step 1: Update copy assertions before production strings**
- [ ] **Step 2: Run focused component and server tests and confirm failures reference the old copy**
- [ ] **Step 3: Replace visible, accessible, manifest, documentation, and model-identity language as one coherent pass**
- [ ] **Step 4: Run the focused tests and confirm they pass**

### Task 2: Derive meaningful local thread and capsule titles

**Files:**
- Create: `src/application/thread-title.ts`
- Create: `src/application/thread-title.test.ts`
- Modify: `src/app/use-specular.ts`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Produces: `deriveThreadTitle(content: string): string`, returning a whitespace-normalized, locally derived title of at most 80 characters with generic drafting prefixes removed and `New topic` as the empty fallback.
- Consumes: first submitted user input; capsules continue inheriting `thread.title`.

- [ ] **Step 1: Write unit cases for business ideas, decisions, long input, punctuation, and empty input**
- [ ] **Step 2: Run the unit test and confirm the missing export failure**
- [ ] **Step 3: Implement `deriveThreadTitle` and pass the title into `ConversationService.startThread` on first submission**
- [ ] **Step 4: Add an application assertion that the header and saved capsule use the derived title**
- [ ] **Step 5: Run unit and application tests**

### Task 3: Make Save & finish the primary atomic completion path

**Files:**
- Modify: `src/storage/repositories.ts`
- Modify: `src/storage/indexed-db.ts`
- Modify: `src/application/conversation-service.ts`
- Modify: `src/app/use-specular.ts`
- Modify: `src/components/ConclusionEditor.tsx`
- Test: `src/storage/indexed-db.test.ts`
- Test: `src/application/conversation-service.test.ts`
- Test: `src/app/App.test.tsx`
- Test: `src/components/ConclusionEditor.test.tsx`

**Interfaces:**
- Produces: `ConversationService.saveAndFinish(input: SaveCapsuleInput): Promise<ServiceResult<SaveAndFinishResult>>`.
- Produces: `SaveAndFinishResult = { capsule: Capsule; thread: Thread }`, where `thread` is the fresh active thread.
- Extends: `FinishedThreadWrite` with optional `capsule?: Capsule`; IndexedDB writes completed thread, fresh thread, and capsule in one transaction.

- [ ] **Step 1: Write service, repository, and UI tests proving one action saves a capsule, completes the source, starts fresh, and reports `Saved and finished.`**
- [ ] **Step 2: Run focused tests and confirm the missing service behavior**
- [ ] **Step 3: Extract shared capsule validation/building inside the service and implement the atomic repository write**
- [ ] **Step 4: Route the conclusion primary action through `saveAndFinish`; keep `Save as capsule` as a checkpoint**
- [ ] **Step 5: Run focused service, storage, component, and application tests**

### Task 4: Make capsules revisitable

**Files:**
- Modify: `src/application/conversation-service.ts`
- Modify: `src/app/use-specular.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/components/CapsuleLibrary.tsx`
- Test: `src/application/conversation-service.test.ts`
- Test: `src/app/App.test.tsx`
- Test: `src/components/CapsuleLibrary.test.tsx`

**Interfaces:**
- Produces: `CapsuleThreadMode = 'continue' | 'branch'`.
- Produces: `ConversationService.startFromCapsule(capsuleId: CapsuleId, mode: CapsuleThreadMode): Promise<ServiceResult<Thread>>`.
- Produces hook actions: `continueCapsule`, `branchCapsule`, and `challengeCapsule`, each returning `Promise<boolean>`.
- Capsule detail exposes `Continue developing`, `Branch into new thread`, and `Challenge this`.

- [ ] **Step 1: Write service tests proving continued and branched threads preserve provisional conclusion and structured understanding, with exhaustive mode handling**
- [ ] **Step 2: Run service tests and confirm the missing method failure**
- [ ] **Step 3: Implement capsule-derived thread creation with same-title continue and `— branch` suffix for branching**
- [ ] **Step 4: Write component/application tests for all three actions and modal closure**
- [ ] **Step 5: Implement hook and capsule-library actions; Challenge starts from the capsule then invokes the existing challenge operation**
- [ ] **Step 6: Run service, component, and application tests**

### Task 5: Add the desktop on-demand reasoning map

**Files:**
- Create: `src/components/ReasoningMap.tsx`
- Create: `src/components/ReasoningMap.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles.css`
- Modify: `tests/e2e/specular.spec.ts`

**Interfaces:**
- Consumes: `ThreadUnderstanding`.
- Produces: an accessible closed-by-default `details` disclosure named `Reasoning map`, showing only non-empty Claims & assumptions, Evidence & observations, Stakeholders, Distinctions, Tensions, and Open blind spots.
- Layout: hidden below 56rem; at or above 56rem the shell becomes a two-column editor with a maximum 68rem width and an 18rem reasoning rail.

- [ ] **Step 1: Write component tests for collapsed state, empty sections, section labels, and item content**
- [ ] **Step 2: Run the component test and confirm the missing component failure**
- [ ] **Step 3: Implement the disclosure component and integrate it beside the active work surface**
- [ ] **Step 4: Add responsive CSS without changing the mobile hierarchy**
- [ ] **Step 5: Extend E2E coverage for desktop disclosure and retain mobile no-overflow assertions**
- [ ] **Step 6: Run component, application, and E2E tests**

### Task 6: Verify the complete product pass

**Files:**
- Verify all modified files.

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: a clean validated build and rendered evidence at 375 × 812 and desktop.

- [ ] **Step 1: Run `npm run validate`**
- [ ] **Step 2: Run `npm run eval`**
- [ ] **Step 3: Run `npm run test:e2e`**
- [ ] **Step 4: Run React Doctor and address actionable findings**
- [ ] **Step 5: Launch the app with deterministic operation fixtures and inspect first run, inquiry, Challenge, Save & finish, capsule revisit, and desktop reasoning map in the in-app Browser**
- [ ] **Step 6: Confirm `git status --short` contains only intentional changes and summarize remaining live-model risk**
