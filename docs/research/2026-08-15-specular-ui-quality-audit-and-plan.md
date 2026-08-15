# Specular UI quality audit and enforcement plan

Status: direction approved; implementation planning recorded
Date: 2026-08-15
Scope: research and planning only; no frontend, test, deployment, or release changes were made

Repository baseline: final source inventory at `a642cdb`. The shared repository advanced during the audit; implementation should revalidate this inventory against its starting commit.

## Executive verdict

Specular does not need a wholesale aesthetic reset. It needs a coherent product-quality system beginning from the owner-selected MagicPath `Specular` theme while preserving the current authored-document model. The approved defaults are a crisp white/black neutral system with Playfair Display 400 for authored hierarchy, Noto Sans 400 for interface text, restrained gray structure, and blue reserved for focus or selected emphasis. They may be improved through visible owner-reviewed proposals rather than treated as an immutable pixel contract. The prior tan/paper exploration is superseded as the default direction.

The supplied mobile examples are not isolated polish defects. They expose four structural gaps:

1. Specular has several older documents described as “approved” or “active” that point toward a materially different dark, spectral, capsule-oriented product. The current block-document product has no single canonical visual doctrine that explicitly supersedes those directions.
2. The application has useful visual tokens, accessible semantics, and responsive functional coverage, but most presentation is implemented in one 1,907-line stylesheet and only two explicit `ui` primitives. Component behavior and component appearance therefore drift independently.
3. Automated tests prove many behaviors and accessibility properties, but there is no reviewable catalog of component states and no screenshot baseline. A layout can be functionally correct, non-overflowing, and still look unfinished.
4. Global state messages are composed independently from the route beneath them. This allows technically true messages to compete with or contradict the user's current task, as the signed-out gate and “ready to work offline” prompt demonstrate.

The recommended program is:

- establish one current visual and interaction doctrine;
- inventory the complete surface as semantic components and state matrices;
- repair the highest-risk entry, recovery, update, and offline states first;
- consolidate reusable foundations without flattening Specular's character;
- lock quality with component stories, deterministic visual comparisons, accessibility checks, responsive stress cases, and human approval of changed baselines.

## Evidence and limits

This audit used:

- the two owner-supplied mobile screenshots;
- the owner-supplied MagicPath `Specular` theme CSS and the five-surface MagicPath canvas generated and reviewed from that loaded system;
- read-only inspection of the signed-out live Site at 375 by 812 and 320 by 700 CSS pixels;
- the current React components, stylesheet, Playwright configuration, unit tests, domain context, ADRs, and completed refinement spec;
- pattern research from NameThatUI and primary documentation for Storybook, Playwright, React Spectrum, Primer, W3C, MDN, Stylelint, and Style Dictionary;
- generated DeepWiki repository orientation for Storybook, React Spectrum, Primer React, and Playwright. This orientation was used to choose primary-source questions, not as evidence for the recommendations; the reproducibility record appears below.

The authenticated workspace was not opened during the original audit, no sign-in was attempted, and no physical-device or assistive-technology session was run. The MagicPath surfaces are approved default references, not production verification or immutable compositions. Source inspection can establish surface and state coverage, but it cannot certify the visual quality of authenticated routes. That requires a later evidence pass against representative seeded data.

## Screenshot and live-surface audit

### Step 1 — Application update prompt

Health: **poor / critical composition defect**

The prompt forces a sentence and two minimum-height actions into one horizontal row at a narrow mobile width. “Update now” wraps onto two lines, all three elements compete at nearly equal visual weight, and the three pill-like masses overwhelm the page beneath them. The result looks like a magnified desktop control rather than an intentionally composed mobile status surface.

The code confirms the cause: the prompt remains a single flex row at all widths; its actions and message have no narrow-layout contract; the controls use decorative full-pill geometry; and the fixed bottom offset does not include the device safe area.

Recommended behavior:

- Treat update availability as a persistent, author-actionable status surface, not a transient success toast.
- At narrow widths, use a compact stacked composition: message first, actions on a second row or full-width primary plus quiet text action.
- Keep labels on one line; allow the surface, not the control label, to grow.
- Explain the safety contract in concise product language, for example that Specular will preserve current writing before refreshing.
- Keep the prompt until the author chooses update or later; do not auto-dismiss it.
- Respect `env(safe-area-inset-bottom)` and test against browser chrome as well as standalone PWA mode.

### Step 2 — Signed-out gate with offline-ready status

Health: **poor / high semantic and hierarchy defect**

The sign-in page places the brand at the top and centers the content in the remaining viewport, producing a large dead zone and an accidental-looking vertical composition. The offline-ready prompt then competes with the only primary task.

More importantly, the copy forms a product contradiction. The gate says Specular will not open or read a workspace before sign-in, while the global prompt says Specular is ready to work offline. The latter may be technically true of the application shell, but it is not true of the signed-out user's available task under the hosted-only, account-scoped workspace model.

Recommended behavior:

- Suppress offline-ready confirmation when the private workspace is locked or the author is signed out. Cache readiness is not useful feedback there.
- Preserve update availability where needed, but compose it with the sign-in route rather than blindly overlaying it.
- Use a deliberate mobile page frame with safe-area-aware padding and bounded spacing rather than centering in a leftover `1fr` track.
- Change `100vh` to a dynamic-viewport strategy with a resilient fallback.
- Keep the sign-in explanation direct and privacy-grounded; avoid implying a local-only mode that the ADRs explicitly reject.

### Step 3 — Live signed-out route at 375 by 812

Health: **needs work / hierarchy defect**

The live route reproduces the supplied sign-in composition: restrained colors and typography are promising, but the brand, headline, supporting copy, and action do not form a coherent vertical unit. The empty area is not purposeful calm because it does not reinforce a reading order or focal point.

### Step 4 — Live signed-out route at 320 by 700

Health: **needs work / responsive defect**

At 320 CSS pixels the headline wraps to three lines. It remains readable, but the clamp-based display size and near-unit line height make the heading dominate the available frame. The page needs a type and spacing rule designed for the narrow case rather than a desktop scale merely allowed to shrink.

## Root-cause findings

### 1. No single current visual source of truth

The current domain is an authored block-document workspace, and the completed refinement spec preserves that model. Several older design documents still describe a dark spectral chat/capsule interface and retain “approved” or “active” language. A future contributor or agent can follow either direction in good faith.

Create one canonical current document, for example `docs/design/specular-interface-doctrine.md`, and add explicit supersession headers to old visual directions. Keep domain and product decisions in `CONTEXT.md` and ADRs; use the visual doctrine for sensory character, hierarchy, interaction principles, and component rules.

The approved visual defaults come from the loaded MagicPath `Specular` system:

- `#FFFFFF` application, card, popover, and document surfaces;
- `#222222` primary foreground, black primary actions, `#F4F4F4` muted structure, and `#E0E0E0` borders and inputs;
- Playfair Display 400 for authored hierarchy and Noto Sans 400 for interface/body text, without synthesized heavier weights;
- clear ink contrast, precise borders, disciplined spacing, and restrained elevation;
- `#0274B6` reserved for focus rings and selected emphasis rather than filled primary actions;
- no default beige card stacks, decorative pill proliferation, washed-out metadata, or low-contrast “AI product” softness.

### 2. Styling has tokens but not an enforceable component architecture

The paper, ink, line, accent, and state variables are a useful seed. They do not yet form a complete semantic system for typography, space, elevation, motion, focus, control geometry, overlays, and responsive composition. A single large stylesheet also makes ownership and dead-rule detection difficult.

Do not begin by introducing a large third-party visual system. Consolidate Specular's own semantic seams first:

- foundations: color roles, type roles, spacing, radii, borders, elevation, motion, focus, safe areas, and breakpoints;
- primitives: button, icon button, link action, field, textarea, surface, separator, and status text;
- patterns: inline alert, actionable update notice, transient toast, dialog, menu, drawer/library panel, empty state, recovery state, and loading state;
- product components: document header, block editor, reflection margin, connections, dictation review, history, snapshot, and account boundary.

The existing Radix/shadcn dependencies may supply behavior for selected primitives, but Specular should own the visual contract. Adoption should follow a component-by-component comparison, not a blanket rewrite.

### 3. Tests cover function, not composition

The current Playwright matrix includes 320, 375, and 430-pixel mobile widths and accessibility checks. That is valuable. Assertions such as “no horizontal overflow,” minimum text size, correct role, and fixed positioning cannot detect poor hierarchy, ugly wrapping, crowded controls, excessive dead space, or a prompt that visually obscures the main task.

Add visual evidence at two layers:

- isolated component-state stories for fast, exhaustive review;
- route-level screenshots for composition, layering, and cross-component interactions.

Playwright's official visual-comparison support stores reviewable baselines and compares subsequent renders. It also allows per-test styles and controls for animation and caret rendering, but it requires a stable execution environment and disciplined baseline review. [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)

### 4. Global messages do not understand route or task context

`PwaUpdatePrompt` is rendered beside the session boundary at the root. Its two events—offline readiness and application update—share one visual pattern despite different urgency, persistence, actionability, and relevance.

Split the product concepts even if they share implementation:

- **Transient toast:** nonessential, completed outcomes; may auto-dismiss, pauses on interaction, does not take focus.
- **Inline alert:** persistent problem tied to the affected content or task.
- **Actionable application notice:** persistent global update with explicit actions and a safety explanation.
- **Banner:** rare route- or workspace-wide condition that materially changes what the author can do.

This matches NameThatUI's distinction between floating transient toasts and persistent inline alerts or banners. [Toast](https://namethatui.com/web/toast) [Inline alert and banner](https://namethatui.com/web/alert-callout-banner)

React Spectrum's toast model is a useful behavioral reference: a root container coordinates placement, actions, timeout behavior, and accessibility rather than leaving each producer to improvise. Specular does not need to adopt React Spectrum to copy the discipline. [React Spectrum Toast](https://react-spectrum.adobe.com/v3/Toast.html)

## The falsifiable definition of “high quality and wonderful”

A Specular surface is ready only when all ten dimensions pass:

| Dimension | Required evidence |
|---|---|
| Product fidelity | The surface preserves private authorship, calm reflection, provenance, and the canonical domain vocabulary. |
| Hierarchy | One primary task is obvious; supporting information and destructive or secondary actions are subordinate. |
| Composition | Spacing, alignment, line length, density, and empty space form an intentional reading path at each target width. |
| Component semantics | The UI pattern matches the job: a toast is not used as an alert, a tag is not a decorative pill, and a link is not styled as an unrelated control. |
| Responsive reflow | At 320 CSS pixels and 200% text, content reflows without clipped labels, overlap, obscured focus, or two-dimensional scrolling. W3C calls out fixed and sticky content as a specific reflow risk. [W3C Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow) |
| Interaction | Pointer, touch, keyboard, focus restoration, dismissal, loading, disabled, retry, and destructive confirmation behavior are deliberate. |
| Content resilience | Empty, minimal, typical, long, translated-like, error, loading, offline, stale, and recovery content are represented. |
| Accessibility | Semantic structure, names, contrast, focus visibility, target size, status announcements, reduced motion, and zoom pass automated and manual review. Focus outlines are never removed without a visible replacement. [NameThatUI focus ring](https://namethatui.com/web/focus-ring-web) |
| Sensory coherence | Typography, color, border, radius, shadow, iconography, and motion use semantic tokens and feel recognizably Specular. |
| Evidence | A reviewer can inspect the relevant story, interaction result, accessibility result, and visual diff without recreating the author's environment. |

“Wonderful” is the final human judgment after these conditions are met. It should mean the interface feels unusually calm, trustworthy, and authored—not that it contains more decoration or motion.

## Source-derived active surface audit draft

The active product is larger than the two photographed entry states. Read-only source inspection found these user-visible journeys and state families. This becomes a complete inventory only after the authenticated states are exercised with representative synthetic data and linked to reviewable evidence:

1. **Entry and identity:** session verification, verification failure, signed-out gate, sign-in handoff and busy state, authenticated workspace, authentication loss, locked workspace, account switch, and sign-in again.
2. **Workspace shell:** sticky header, Document and Connections navigation, Snapshot and Library actions, saving/saved/device/locked sync states, account identity, sign-out, account errors, and workspace initialization.
3. **Library drawer:** new document, active/inactive documents, lifecycle metadata, dormancy/dictation/organization settings, privacy explanation, published-link states, archive, device recovery, account deletion, sign-out, loading, errors, and destructive confirmations.
4. **Thinking document:** blank and populated documents, Writing Starters trigger and popover, starter selection, automatic-organization consent, authored/empty/suggested titles, organizing, storage errors, conflict-copy notice and resolution, block stack, and add block.
5. **Writing block:** focus rail, main/linked block, origin prompt, editable canonical writing, source attachment and removal, empty/authored deletion paths, dictation, version-history disclosure, and restore.
6. **Dictation review:** microphone permission, recording, pause/resume, processing, editable review, verbatim fallback, Keep, Cancel, interrupted capture, storage/transcription failure, partial checkpoint, no-speech, inline errors, and privacy disclosure.
7. **Reflection margin:** empty instructions, selected passage, disabled/enabled Reflect, busy/error, alternate moves, returned mirror, linked directions, external sources, save/dismiss/follow, and selection/connections/document/workspace scopes.
8. **Calibration:** ephemeral exchange history, editable correction, Respond, requesting/recording/processing/interrupted dictation, disabled response, and inline errors.
9. **Connections:** document/workspace scope, kind and lifecycle filters, empty and populated graph, all node kinds, open-node navigation, and author correction of inferred kind.
10. **Snapshot editor:** suggested-title confirmation, editable title, block inclusion, preview, Markdown, print/PDF, publishing, error, published link, copy/Copied, and revocation.
11. **Hosted snapshot:** authenticated route, loading, unavailable/error, title/date/prose/quotation/reference content, and footer.
12. **PWA status:** hidden, offline-ready, update-ready, preparing, safe-update failure, and accepted update/reload.
13. **Embedded MCP widget:** default/question/blind-spot/counter-position/safety/conclusion results, gathered-excerpt disclosure, missing context, busy/progress, tool failure, and unsupported results.

The final inventory also found a set of committed but unreachable chat/Capsule-era components. They should be classified explicitly as legacy source before any component-system work; their existence and unit tests must not be mistaken for active product coverage.

For every active surface record capture: owner task, entry trigger, exit, primary action, secondary/destructive actions, persisted effects, roles and announcements, focus entry/return, narrow layout, content extremes, reduced motion, and visual evidence.

### Additional prioritized defects from the source inventory

- **High — modal and drawer focus:** the Snapshot overlay and Library drawer lack complete focus containment, Escape behavior, background inertness, and trigger restoration even though a tested modal-focus utility exists elsewhere.
- **High — missing visual evidence:** there are no current screenshot assertions for the authenticated workspace; older QA images represent the superseded chat/Capsule UI. The hosted snapshot and MCP widget also lack rendered visual and axe coverage.
- **High — overlay layering:** the PWA prompt lacks safe-area handling and may cover controls, conflict with the software keyboard, and visually sit above the Snapshot modal because of its current stacking level.
- **Medium — fragmented primitives:** active production rendering relies heavily on raw controls and bespoke behavior in a 1,856-line `App.tsx`, while existing shared primitives are largely dormant.
- **Medium — target size and density:** several active triggers are below the repository's 44-pixel target, and 0.61–0.75rem metadata makes the Library, graph, history, and reflection surfaces unusually dense.
- **Medium — incomplete async states:** published links present an empty state while loading; organization failure is silent; account operations lack specific busy states; snapshot publishing/revocation share ambiguous busy state; clipboard failure is not surfaced.
- **Medium — destructive inconsistency:** inline confirmation, native `confirm`, native `alert`, and a dormant custom alert dialog produce inconsistent focus, tone, and recovery behavior.
- **Medium — accessibility communication:** sync status is not live-announced; Library and starter popover focus/Escape behavior is incomplete; widget disabled reasons rely on `title`; widget errors remain in a polite status region.
- **Medium — cross-surface drift:** the hosted workspace uses the light paper/Georgia/Geist direction while the embedded widget uses a separate dark/Inter system. This may be an intentional host-context adaptation, but no doctrine defines the relationship.
- **Medium — possible widget semantic drift:** the embedded widget's “Next question,” “Test this,” and “Gather this thread” interaction model may represent the superseded chat-oriented product rather than the current authored-document model. Before visual consolidation, decide whether the widget remains supported, must adapt to the current domain, or should be classified as legacy.
- **Low — generic empty states:** Connections does not distinguish an empty workspace from empty filtered results, and published-link loading resembles a settled empty state.

## Remediation program

### Wave 0 — Establish the doctrine and baseline

- Choose the current visual defaults and their allowed adaptation boundary.
- Publish one current interface doctrine and mark superseded visual documents unambiguously.
- Capture the existing product in representative seeded states before refactoring.
- Build the component/state inventory and quality-debt register under `.scratch/` after owner approval.
- Define the target browser, viewport, zoom, and physical-device follow-up matrix.

Exit criterion: a contributor can identify the current approved defaults, understand that they are not immutable, and find the complete audit surface without asking which old spec wins.

### Wave 1 — Foundations and state semantics

- Expand semantic tokens and separate them from component rules.
- Establish primitives and documented variants.
- Split toast, inline alert, banner, application notice, dialog, menu, and recovery semantics.
- Add dynamic viewport and safe-area layout utilities. MDN documents safe-area inset variables for content that must avoid device UI. [MDN `env()`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)
- Define content, focus, dismissal, and motion rules for every overlay.

Exit criterion: new screens can be assembled without raw visual values or a new one-off status pattern.

### Wave 2 — Repair entry, update, offline, and recovery

- Refactor the signed-out, verification-failed, loading, and locked-workspace compositions.
- Replace the current all-purpose PWA prompt with context-aware status components.
- Fix narrow action layout, safe-area positioning, 200% text, keyboard focus, and browser-chrome collision.
- Align copy with the hosted-only and account-scoped-cache ADRs.

Exit criterion: the two supplied examples pass the full quality bar at 320, 375, and 430 CSS pixels and at 200% text.

### Wave 3 — Refactor the core authoring journey

- Audit the workspace shell, starter state, document title, writing blocks, reflection margin, calibration, Connections, and dictation review as one reading-and-writing composition.
- Standardize fields, icon actions, provenance, status, and recovery treatment.
- Exercise long author text, long model text, empty structures, network delay, interruption, and keyboard-only use.

Exit criterion: the primary journey has complete stories, route snapshots, interaction tests, and no unowned one-off presentation rules.

### Wave 4 — Refactor library and secondary journeys

- Audit the Library drawer, settings, published-link management, account safety flows, snapshot editor, hosted snapshot, embedded widget, export, print, and account-boundary states.
- Verify overlays against focus, scroll locking, narrow height, long names, errors, and destructive-action recovery.

Exit criterion: all inventory rows have owner-approved visual evidence or an explicitly accepted exception.

### Wave 5 — Make the quality system required

- Enforce stories, visual comparisons, accessibility checks, token/style linting, and evidence in CI.
- Add a UI definition of done and a baseline-change review policy.
- Make quality-debt exceptions explicit, owned, dated, and removable.

Exit criterion: a prospective change cannot silently introduce a new unreviewed component state, raw visual language, or baseline drift.

## Recommended enforcement architecture

### Component state catalog

Use Storybook as the review harness, not as a separate product. A story is a named, deterministic state of a real production component. Storybook's official test stack can treat stories as browser-rendered test cases and run interaction `play` functions. [Storybook testing](https://storybook.js.org/docs/writing-tests) [What is a story?](https://storybook.js.org/docs/get-started/whats-a-story)

Every reusable pattern should include, where applicable:

- default and hover/focus/pressed;
- disabled, busy, success, warning, and error;
- short, typical, and extreme content;
- 320-pixel container and 200% text stress;
- reduced motion and dark/high-contrast variants if supported;
- keyboard interaction and focus-return behavior.

Do not require stories for invisible utilities or domain-only functions. The catalog exists to make visible behavior reviewable.

Maintain a machine-readable `docs/design/ui-surface-manifest.json` (or an equivalently validated TypeScript manifest) that maps each approved visible component or product region to its production entry point, required states, story IDs, route-level scenarios, accessibility checks, visual baselines, maturity (`experimental`, `ready`, or `deprecated`), and any owned exception. This is the mechanism behind the coverage gate; filename conventions alone cannot prove that all required states exist.

The mapping must be reciprocal. As active UI is decomposed from `App.tsx`, route and visible-region imports should pass through a production UI registry, with direct bypass imports prohibited by lint. CI must compare registry IDs to manifest IDs in both directions. During the transition, any change to known UI entry points (`App.tsx`, the global stylesheet, auth UI, active component modules, or the embedded widget) must either update an affected manifest row or carry a designated-reviewer-approved `no visible surface change` attestation. This prevents an undeclared new surface from bypassing a validator that only checks rows already present.

### Visual regression

- Run isolated story screenshots in a pinned Linux browser environment.
- Run a smaller route-composition suite at 320, 375, 430, and a representative desktop width.
- Include Chromium broadly and WebKit for the highest-risk mobile, viewport, form, fixed-position, and PWA states.
- Disable nondeterministic animation, caret, clocks, random IDs, and live network data in fixtures.
- Commit baselines; publish diffs as review artifacts.
- Never let an automated command accept changed baselines. A human reviewer must understand and approve each diff.

Storybook's visual-testing documentation describes snapshots of stories as a way to catch appearance changes such as layout, color, and size. [Storybook visual testing](https://storybook.js.org/docs/8/writing-tests/visual-testing)

Start with the existing local Playwright infrastructure. Storybook's documented hosted visual workflow uses Chromatic; adopting it would add an external processing, credential, cost, and privacy boundary. Do not send stories anywhere unless that boundary is separately approved, and use synthetic authored material in every story and screenshot fixture.

### Accessibility

- Run axe against every relevant story and every critical route.
- Replace the current severity-only gate, which blocks only serious and critical axe findings, with an explicit applicable WCAG A/AA policy. Keep non-WCAG best-practice findings visible even if they initially remain advisory.
- Configure newly introduced violations as failures, not advisory logs. Storybook supports making accessibility findings fail story tests with its a11y configuration. [Storybook accessibility testing](https://storybook.js.org/docs/writing-tests/accessibility-testing)
- Keep manual keyboard, screen-reader announcements, 200% zoom, reduced-motion, and physical-touch checks in release evidence because automation cannot judge reading order, useful copy, or visual calm.
- Use Primer's accessibility checklists as a practical cross-check for semantics, target sizes, focus, contrast, and reflow. [Primer accessibility checklists](https://primer.style/accessibility/tools-and-resources/checklists/)

### Token and CSS policy

- Move foundations into an explicit token layer and use semantic names based on purpose, not appearance.
- Prefer CSS custom properties as the runtime source while keeping the structure compatible with the Design Tokens Community Group format if multiple platforms emerge. Style Dictionary documents platform-agnostic token definitions and DTCG compatibility. [Style Dictionary tokens](https://styledictionary.com/info/tokens/)
- Introduce Stylelint incrementally: standard correctness first, then project conventions, token references, unit rules, and narrowly allowlisted exceptions. Stylelint supports reference token files, unknown-custom-property checks, and project-specific strictness. [Stylelint customization](https://stylelint.io/user-guide/customize/)
- Initially report existing raw values; fail only new violations. Migrate the existing stylesheet by owned component area rather than with a risky mechanical rewrite.

### Pull-request and release evidence

Any change to a visible component must include:

1. affected inventory rows and stories;
2. before/after screenshots at the relevant narrow and desktop cases;
3. reviewed visual diff output;
4. interaction and axe results;
5. keyboard/focus notes for interactive changes;
6. explicit confirmation that canonical writing, privacy, persistence, and synchronization semantics are unchanged—or the ADR/spec that authorizes a change;
7. the relevant simulated-mobile evidence, plus the existing physical-device follow-up record for PWA, fixed overlays, voice, safe areas, browser chrome, and update/recovery flows.

ADR 0007 currently makes physical iPhone and Android interruption testing a documented beta follow-up rather than a release blocker. This plan does not silently override that decision. Making physical-device evidence blocking requires an explicit superseding ADR; until then, CI simulation and live-Site verification remain the release gates and the device matrix remains visible deferred evidence.

### Xcode iPhone Simulator as supplemental evidence

`xcodebuildmcp` is installed on the audit machine. Its current inventory includes iPhone 17, 17 Pro, 17 Pro Max, 17e, and iPhone Air simulators running iOS 26.5. This creates a useful non-blocking evidence lane for the hosted PWA:

1. boot a named iPhone simulator and open Simulator.app through `xcodebuildmcp`;
2. launch Mobile Safari (`com.apple.mobilesafari`), navigate to the live Site through UI automation, and normalize status-bar state where useful;
3. exercise sign-in boundaries, browser chrome, portrait/landscape reflow, software keyboard, safe areas, fixed notices, overlays, and zoom-sensitive compositions;
4. capture semantic UI snapshots plus PNG screenshots with the CLI;
5. attach those receipts to the relevant visual review without treating them as a physical-device certification.

Standalone installed-PWA behavior should be recorded as a distinct state from ordinary Safari. If Add to Home Screen cannot be made deterministic through the CLI, keep that step manual and record the limitation rather than substituting a browser screenshot.

### Concrete CI and evidence integration

The current workflow has strong validation and browser lanes but no UI-specific contract. Wave 5 should propose and then implement these bounded additions:

- `npm run lint:styles`: Stylelint correctness and the new-value token policy;
- `npm run ui:manifest:check`: compare the production UI registry and manifest in both directions, then validate every referenced story/scenario, maturity state, and non-expired exception;
- `npm run test:ui`: render stories and run their interaction and accessibility checks in a browser;
- `npm run test:visual`: run the canonical Chromium screenshot contract and the selected WebKit diagnostic cases;
- upload the HTML report, actual/expected/diff images, manifest result, and accessibility result on failure;
- keep snapshot regeneration as a local explicit command; CI must never update baselines;
- protect the visual check and require an independent reviewer or designated UI owner for changed baseline files when repository governance supports it.

Version the release-evidence schema rather than silently extending version 1. A proposed `uiQuality` object should record the manifest version/path, tested baseline commit, suites and viewports, changed-baseline list, accessibility policy/result, active exceptions, reviewer evidence, and whether physical-device evidence is completed or deferred under ADR 0007. The evidence generator must derive these values from test artifacts and review metadata rather than accepting unsupported self-assertions.

Store temporary exceptions in the local issue system under `.scratch/specular-ui-quality/`, with an owner, rationale, exact affected states, tracking issue, creation date, expiry date, and removal condition. CI should reject expired or unreferenced exceptions.

## DeepWiki orientation record

DeepWiki was used as generated repository orientation—not as a primary source—for these public repositories and questions:

- `storybookjs/storybook`: how stories encode finite component states, how `play` interactions run, and how accessibility and visual checks connect to CI;
- `adobe/react-spectrum`: how toast queues, regions, timers, actions, focus, and layering are coordinated;
- `primer/react`: how components, tokens, stories, visual regression, and axe checks are organized;
- `microsoft/playwright`: how screenshot baselines, projects, deterministic rendering controls, and diff artifacts work.

Because generated DeepWiki answers are not stable evidence artifacts, every adopted recommendation is supported above by an official documentation link or by direct repository inspection.

## Second- and third-order consequences

| Decision | Benefit | Downstream risk | Guardrail |
|---|---|---|---|
| Canonical visual doctrine | Stops direction drift | Can fossilize taste | Review principles separately from implementation; allow documented experiments. |
| Story catalog | Makes hidden states visible | Can become duplicate demo code | Stories import production components and shared fixtures; no story-only component forks. |
| Visual baselines | Catches composition regressions | Can bless bad design or produce noisy diffs | Establish quality before baseline; pin environment; require human approval. |
| More tokens | Produces coherence | Can create aliases nobody understands | Start with semantic roles used by multiple components; document exceptions. |
| Primitive consolidation | Reduces one-offs | Can erase product-specific nuance | Standardize behavior and foundations; preserve deliberate product composition. |
| Automated accessibility | Prevents common regressions | Can create false confidence | Keep manual cognition, reading-order, announcement, zoom, and device checks. |
| Broad viewport matrix | Catches mobile failures | Increases CI time and review noise | Tier the suite: broad component coverage, narrow route coverage, and documented physical-device follow-up under ADR 0007. |
| Context-aware global status | Removes contradictions | Adds state coordination | Define a small status policy and route eligibility table rather than ad hoc conditions. |
| Incremental CSS migration | Protects active work | Leaves two systems temporarily | Track ownership by wave; forbid new legacy-style rules once the replacement exists. |

## Recommended decision sequence

1. Decide which visual doctrine is current and how contributors may improve its defaults.
2. Approve the audit dimensions, target matrices, and baseline-review ownership.
3. Create the inventory and debt register as local `.scratch/` specs and issues.
4. Implement Wave 1 and Wave 2 together far enough to prove the system on the supplied failures.
5. Review that proof before expanding the same method through authenticated authoring and secondary journeys.
6. Turn enforcement from advisory to required only after the initial baselines are intentionally approved.

## Proposed acceptance gates

- No critical journey lacks a deterministic representative-data fixture.
- No reusable visible component mapped in the approved UI manifest lacks its required state stories or an owned exception.
- No route-level overlay is tested only in isolation.
- No supported viewport or 200% text case clips, overlaps, obscures focus, or horizontally scrolls ordinary content.
- No new raw color, type, radius, spacing, elevation, or motion value bypasses the token policy without a documented exception.
- No changed screenshot baseline is accepted automatically.
- No automated accessibility failure is waived without an owned, dated exception.
- No release affecting PWA, authentication, fixed overlays, recovery, or voice omits the simulated-mobile evidence required today or hides the physical-device follow-up required by ADR 0007.
- No old visual document can reasonably be mistaken for the current approved default direction.

## Owner decisions recorded on 2026-08-15

1. The current authored block-document model remains authoritative. The loaded MagicPath `Specular` design system supplies the approved visual defaults—white/black neutral surfaces, Playfair Display 400, Noto Sans 400, restrained gray structure, and blue only for focus or selected emphasis—but it is not immutable; owner-reviewed improvements are allowed.
2. Storybook will serve as the finite component-state harness, with the existing Playwright infrastructure providing local visual regression.
3. The implementation release scope covers the entire active product surface. Work remains blocker-ordered internally so the final coherent release is reviewable without creating one undifferentiated coding task.
4. Intentional baseline changes require the owner's greenlight. Keep the review lightweight: present understandable diffs and avoid additional approval bureaucracy unless scale later demands it.
5. Physical-device testing will not become a new release constraint. Retain ADR 0007 and use Xcode iPhone Simulator evidence as a practical, non-blocking supplement.
6. Implementation and preview evidence precede live publication; publishing the Site requires a separate owner greenlight.
7. Dark tokens remain valid and testable, but the initial rework does not add a user-facing dark-mode control.
8. Deterministic synthetic writing is used for local and preview evidence. Any authorized live verification uses a clearly synthetic test document and leaves existing private writing untouched.
9. Implementation proceeds ticket-by-ticket on one long-lived UI-rework branch with reviewable commits and visual checkpoints, culminating in one coherent final PR to `main`.
10. The active release surface is the hosted workspace, PWA states, authentication boundaries, Library, Connections, snapshots, and hosted snapshots. The separately built MCP widget is treated as a legacy compatibility surface outside this rework; its retention, adaptation, or removal is separate future work.
11. Minor local enhancements may be included when they clarify or strengthen an existing task. Major capabilities, workflow concepts, and data-model changes remain separate future work.
