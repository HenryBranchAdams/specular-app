# Quiet Spectral Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the PWA's starter, recovery, composer, toast, and capsule empty states to faithfully match row A of the approved Quiet Spectral Refinement reference.

**Architecture:** Preserve the existing React/application/storage boundaries. Move failed-turn recovery into `Transcript`, reduce optional composer and starter chrome through component variants and CSS, and isolate destructive capsule actions in an accessible overflow menu while retaining existing confirmation services.

**Tech Stack:** React 19, TypeScript, Vite, Lucide React, Testing Library, Vitest, Playwright, IndexedDB.

## Global Constraints

- Reference truth is row A in `docs/superpowers/specs/assets/specular-quiet-spectral-reference.png`.
- Preserve all model, persistence, voice, export, and irreversible-deletion contracts.
- Imports remain at module top; discriminated switches retain exhaustive `never` checks.
- Visible controls remain at least 44 × 44 CSS pixels.
- Support 320–430 CSS pixels, safe areas, 200% text scaling, keyboard navigation, and reduced motion.
- No raster asset is required: the accepted direction uses code-native text and the existing Lucide icon family.

---

### Task 1: Inline Persisted-Turn Recovery

**Files:**
- Modify: `src/components/Transcript.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `UseSpecularResult.canRetry`, `UseSpecularResult.retry`, `UseSpecularResult.activity`.
- Produces: `TranscriptProps.onRetry?: () => void` and `TranscriptProps.retrying?: boolean`; one inline recovery group attached to the latest retryable user turn.

- [ ] **Step 1: Write the failing restored-recovery component test**

Add an App test that initializes with a persisted failed `next_question` user turn and asserts:

```tsx
const recovery = await screen.findByRole('group', { name: 'Saved thought recovery' });
expect(within(recovery).getByText('Not sent')).toBeVisible();
await user.click(within(recovery).getByRole('button', { name: 'Retry' }));
expect(retryTurn).toHaveBeenCalledWith(failedTurn.id);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm run test -- src/app/App.test.tsx`

Expected: FAIL because recovery is rendered outside the failed turn and its action label is `Retry saved thought`.

- [ ] **Step 3: Implement inline recovery**

Extend `TranscriptProps` and render only the latest retryable turn as:

```tsx
<div aria-label="Saved thought recovery" className="turn__recovery" role="group">
  <span className="turn__delivery turn__delivery--failed">Not sent</span>
  <button className="turn__retry touch-target" disabled={retrying} onClick={onRetry} type="button">
    {retrying ? 'Retrying…' : 'Retry'}
  </button>
</div>
```

Pass `specular.retry` and retry activity from `App`; remove the detached `.recovery-notice` block.

- [ ] **Step 4: Run focused tests**

Run: `npm run test -- src/app/App.test.tsx src/components/Transcript.test.tsx`

Expected: PASS with restored and newly failed turns exposing one inline Retry action.

- [ ] **Step 5: Commit**

```bash
git add src/components/Transcript.tsx src/app/App.tsx src/app/App.test.tsx src/styles.css
git commit -m "fix: make saved thought recovery visible"
```

---

### Task 2: Starter, Composer, and Offline Notice Fidelity

**Files:**
- Modify: `src/components/StarterDeck.tsx`
- Modify: `src/components/Composer.tsx`
- Modify: `src/components/Composer.test.tsx`
- Modify: `src/components/PwaUpdatePrompt.tsx`
- Modify: `src/components/PwaUpdatePrompt.test.tsx`
- Modify: `src/styles.css`
- Modify: `tests/e2e/specular.spec.ts`

**Interfaces:**
- Consumes: existing starter prompt array, `VoiceStatus`, PWA prompt callbacks.
- Produces: open editorial starter hierarchy; icon-only optional voice states; non-reflowing compact PWA notice.

- [ ] **Step 1: Write failing component and browser assertions**

Assert unsupported voice has no visible duplicated `Voice unavailable` text while retaining an accessible unavailable control/status contract, and assert the offline-ready prompt does not change `.app-shell` top padding or move the composer below 812px.

```tsx
expect(screen.queryByText('Voice unavailable')).not.toBeVisible();
expect(screen.getByRole('button', { name: 'Voice unavailable' })).toHaveClass('voice-button--icon');
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- src/components/Composer.test.tsx src/components/PwaUpdatePrompt.test.tsx`

Expected: FAIL because the unavailable label is visibly duplicated and CSS reserves `8.5rem` above the shell.

- [ ] **Step 3: Implement the approved visual hierarchy**

- Add a display-serif token and use it only for `.starter-deck__item:first-child .starter-deck__prompt` and major artifact headings.
- Remove the starter plane's card-like background/shadow while retaining one restrained spectral edge.
- Keep three supporting prompts at primary opacity; reduce later prompt opacity/density without removing prompt interchangeability.
- Give unavailable voice an icon-only visual treatment with screen-reader text and no duplicate visible status line.
- Keep active `Connecting`, `Listening`, and failure states textual.
- Remove `#root:has(.pwa-prompt) .app-shell` reflow; render the PWA notice as a compact bottom overlay above safe-area padding.
- Preserve 44px controls and reduced-motion behavior.

- [ ] **Step 4: Run focused and mobile browser tests**

Run:

```bash
npm run test -- src/components/Composer.test.tsx src/components/PwaUpdatePrompt.test.tsx src/app/App.test.tsx
npx playwright test tests/e2e/specular.spec.ts --project=chromium-375 --project=webkit-375
```

Expected: PASS; starter, composer, toast, focus, scaling, and overflow scenarios remain green.

- [ ] **Step 5: Commit**

```bash
git add src/components/StarterDeck.tsx src/components/Composer.tsx src/components/Composer.test.tsx src/components/PwaUpdatePrompt.tsx src/components/PwaUpdatePrompt.test.tsx src/styles.css tests/e2e/specular.spec.ts
git commit -m "feat: refine the quiet spectral thinking surface"
```

---

### Task 3: Quiet Capsule Empty State and Overflow Destruction

**Files:**
- Modify: `src/components/CapsuleLibrary.tsx`
- Modify: `src/components/CapsuleLibrary.test.tsx`
- Modify: `src/app/App.task6.test.tsx`
- Modify: `src/styles.css`
- Modify: `tests/e2e/specular.spec.ts`

**Interfaces:**
- Consumes: existing `onDeleteThread`, `onDeleteAll`, `ConfirmDeleteDialog`, `onExport`.
- Produces: `capsule-library__more` menu state; Export-only persistent footer; unchanged confirmation flow.

- [ ] **Step 1: Write failing menu tests**

```tsx
expect(screen.getByRole('button', { name: 'More capsule actions' })).toBeVisible();
expect(screen.queryByRole('button', { name: 'Delete all local content' })).not.toBeInTheDocument();
await user.click(screen.getByRole('button', { name: 'More capsule actions' }));
expect(screen.getByRole('menuitem', { name: 'Delete all local content' })).toBeVisible();
```

Also assert selecting either destructive menu item still opens the existing confirmation dialog.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- src/components/CapsuleLibrary.test.tsx src/app/App.task6.test.tsx`

Expected: FAIL because destructive controls are always rendered in the footer.

- [ ] **Step 3: Implement the accessible overflow and empty state**

- Add top-right `Ellipsis` control with `aria-haspopup="menu"`, `aria-expanded`, Escape close, and focus return.
- Render current-thread and owner-wide deletion as menu items only while the list view is active.
- Keep selected-capsule deletion in its detail footer.
- Add Lucide `Database` to the empty state and exact approved explanation.
- Keep Export as the only list-view footer action and retain confirmation dialogs unchanged.

- [ ] **Step 4: Run focused and E2E tests**

Run:

```bash
npm run test -- src/components/CapsuleLibrary.test.tsx src/app/App.task6.test.tsx
npx playwright test tests/e2e/specular.spec.ts --project=chromium-375
```

Expected: PASS; capsule export/edit/delete/finish flow uses the menu for owner-wide deletion.

- [ ] **Step 5: Commit**

```bash
git add src/components/CapsuleLibrary.tsx src/components/CapsuleLibrary.test.tsx src/app/App.task6.test.tsx src/styles.css tests/e2e/specular.spec.ts
git commit -m "feat: quiet the capsule library hierarchy"
```

---

### Task 4: Reference Fidelity and Production Gates

**Files:**
- Create: `design-qa.md`
- Create outside repo: `/tmp/specular-quiet-spectral-*.png`
- Modify only if QA identifies drift: files from Tasks 1–3.

**Interfaces:**
- Consumes: approved reference board row A and rendered PWA.
- Produces: `design-qa.md` with `final result: passed` and same-state screenshot evidence.

- [ ] **Step 1: Build and capture same-state mobile screens**

Run the production preview with voice enabled. In the in-app Browser capture 375 × 812 starter, restored failed-turn, and empty capsule states. Capture 320 × 700 and desktop as responsive checks.

- [ ] **Step 2: Compare reference and implementation**

Open `docs/superpowers/specs/assets/specular-quiet-spectral-reference.png` and the three implementation captures. Record at least five comparison points: copy, hierarchy, typography, spectral tokens, composer density, recovery affordance, and destructive-action hierarchy.

- [ ] **Step 3: Fix every P0/P1/P2 mismatch and repeat capture**

Expected: no clipped primary content, no toast reflow, no duplicate unavailable voice copy, one inline Retry, and no persistent owner-wide delete button.

- [ ] **Step 4: Write the blocking QA report**

Create `design-qa.md` with reference path, implementation screenshot paths, viewport/state, comparison history, full/focused evidence, and exactly:

```text
final result: passed
```

- [ ] **Step 5: Run production gates**

```bash
npm run validate
npm run eval
npm run audit
npm run test:e2e
npm run lighthouse
npm run verify:production
```

Expected: all pass; fixed eval has zero hard violations; Lighthouse performance >=0.90 and accessibility 1.00.

- [ ] **Step 6: Commit final fidelity evidence**

```bash
git add design-qa.md
git commit -m "test: verify quiet spectral fidelity"
```

## Plan self-review

- Spec coverage: starter, active failure, composer, toast, capsule empty state, accessibility, and verification each map to one task.
- Placeholder scan: no deferred implementation language or unresolved decisions.
- Type consistency: retry uses existing `UseSpecularResult.retry`; capsule actions reuse current callbacks and confirmation dialog.
