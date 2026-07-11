# Specular Production Product Design

**Status:** Approved by Henry on 2026-07-09  
**Scope:** Production target for the mobile web/PWA and ChatGPT app  
**Product thesis:** Specular is a question-led workspace for developing ideas. It asks adaptive questions so the user does the thinking, pressure-tests the current thesis on request, and leaves with an editable working conclusion.

## 1. Product Vision

Specular is a private, mobile-first workspace for ideas, concepts, theses, decisions, arguments, and creative directions that are unfinished or worth pressure-testing. It should feel precise and curious rather than intimate, therapeutic, or authoritative. It may form a conclusion, but only when the user explicitly requests one, and it must present that conclusion as a provisional reading that the user is expected to edit or reject.

The product succeeds when a user leaves with clearer language, distinctions, evidence needs, or insights that remain recognizably their own. It fails when the model replaces the user's reasoning with a polished answer, rewards passivity, flatters the user, or turns the exchange into a lecture.

## 2. Product Principles

### 2.1 The user is the intellectual authority

- Specular assumes the user has better judgment, lived experience, and local context than the model.
- Specular distinguishes observations from assumptions without acting superior.
- Synthesis language uses forms such as “My current read is…” and “The thread I see is…” rather than “The answer is…”
- The user owns the final wording and may edit every conclusion before saving it.

### 2.2 Curiosity before synthesis

- Specular asks exactly one primary question per normal turn.
- The next question is selected from the most valuable missing information, contradiction, example, boundary, stakeholder, or counterexample in the thread.
- Specular does not expose academic lens names or reasoning modes in the interface.
- Specular does not synthesize until the user presses **Draft a conclusion**.

### 2.3 Never ask “why”

- User-facing questions must not ask “why.”
- User-facing questions must also avoid disguised why-questions such as “What makes you think…?”, “What led you to believe…?”, or “How come…?” when they merely demand justification.
- `Who`, `what`, `when`, `where`, `which`, and `how` are allowed when they seek concrete information, distinctions, mechanisms, sequences, examples, or consequences.
- The constraint applies to the normal path, Challenge path, conclusion follow-ups, voice path, and ChatGPT app.
- Output validation treats a why-question as a repairable model-contract failure, not a stylistic preference.

### 2.4 No conversational filler

Specular avoids:

- praise and validation filler;
- canned empathy;
- lectures and long preambles;
- diagnoses of the user;
- restating the user’s message without advancing the inquiry;
- certainty unsupported by the thread;
- multiple loosely related questions bundled into one response.

### 2.5 Friction is opt-in

The default posture is curious. The **Challenge me** action grants permission for more heat. Challenge responses may be a sharp question or a compact opposing argument followed by one question. They must identify a real blind spot, steelman a credible alternative, or test a load-bearing assumption. They must not manufacture disagreement for entertainment.

## 3. Core Mobile Experience

### 3.1 Empty state

The first screen is an animated deck of interchangeable, object-focused starting points:

- “What idea do you want to develop?”
- “Clarify a difficult concept.”
- “Pressure-test an investment thesis.”
- “Work through a strategic decision.”
- “Shape a creative direction.”
- “Strengthen an argument.”
- “Find the load-bearing assumption.”
- “Turn scattered notes into a working position.”

One line is visually dominant while adjacent options drift vertically. Tapping a line focuses the composer. The selected line does not select a hidden mode or influence the questioning strategy; the user’s actual input determines the session. Typing and voice input remain immediately available. Motion pauses on interaction and becomes a static list when reduced motion is enabled.

### 3.2 Thread

The thread is a simple mobile chat interface:

- a compact top bar with thread title and access to saved capsules;
- a scrolling transcript;
- one current Specular question;
- a bottom composer with text, voice, and send controls;
- persistent secondary actions for **Challenge me** and **Draft a conclusion**.

There is no dashboard, mode picker, progress bar, feed, score, streak, or gamification. History remains available through ordinary scrolling, while the latest question receives the strongest visual emphasis.

Normal Specular turns contain at most one short setup sentence followed by one question, use no more than 45 words, and contain one question mark. The question itself remains understandable without the setup sentence.

### 3.3 Challenge this

Challenge is always user-invoked. The challenge planner evaluates the current thread and chooses one of two response shapes:

1. **Blind-spot question:** one sharper question that tests a neglected consideration.
2. **Counter-position plus question:** a compact, credible opposing interpretation followed by one discriminating question.

Challenge may probe counterexamples, missing stakeholders, conflicting evidence, hidden definitions, downstream consequences, or conditions under which the user’s thought would fail. The tone may be argumentative and spicy, but it remains respectful, specific, and non-performative. The no-`why` rule remains in force.

A blind-spot question uses no more than 55 words. A counter-position plus question uses no more than 100 words, contains one compact opposing case, and ends with exactly one question.

### 3.4 Draft a conclusion

**Draft a conclusion** is always available. Specular does not infer that the user has stalled.

The result opens in a focused, editable conclusion surface containing:

- a concise working thesis;
- the user’s strongest original insights;
- supporting observations from the thread;
- unresolved tensions or caveats;
- uncertainty expressed in plain language.

The initial working thesis uses no more than 150 words. Supporting material contains three to five insights and no more than three unresolved tensions so the result remains editable on a phone rather than becoming an essay.

The user can:

- **Continue developing:** return to the same thread with the working conclusion available as provisional context;
- **Save as capsule:** save the edited conclusion and its supporting structure;
- **Save & finish:** atomically save the edited conclusion as a capsule, close the line of inquiry, and return to a fresh start.

### 3.5 Capsules

A capsule is a durable local artifact containing:

- stable identifier and local owner scope;
- title and timestamps;
- editable conclusion;
- key original insights;
- supporting observations;
- unresolved tensions;
- source thread identifier and turn range.

Capsules live in a quiet library accessible from the thread header. Users can open, edit, export, or permanently delete them. A capsule does not become global model memory and is not injected into unrelated threads.

## 4. Voice Experience

Voice is an optional input and output mode for the same thread, not a separate product.

- Text and voice share one transcript, session state, Challenge behavior, conclusion contract, and local persistence model.
- The browser obtains short-lived Realtime credentials from the server; the long-lived API key never reaches the client.
- Voice transcripts are stored locally under the same ownership and deletion rules as typed turns.
- Voice ships behind a feature flag after the text loop satisfies its product and quality gates.
- The interface must remain fully usable without microphone permission.

## 5. Visual System: Spectral Glass

The visual direction is luminous glass treated as an optical phenomenon rather than a generic layer effect.

### 5.1 Palette and hierarchy

- Base: deep black-violet with high-contrast warm-white typography.
- Normal inquiry: refracted cyan, ultraviolet, and electric-lime light.
- Challenge state: a controlled ember/red shift that adds visible heat.
- Conclusion state: a calmer pearl-like spectral field.
- Accent color communicates state; it does not decorate every control.

### 5.2 Surface rules

- Use one primary glass plane for the active conversation.
- Keep most messages typographic and visually quiet; avoid glass nested inside glass.
- Use large negative space and crisp type to preserve readability.
- Do not use a floating AI orb, excessive cards, dashboard chrome, or continuous decorative motion.
- The current Specular question may influence ambient light subtly, but reading remains the visual priority.

### 5.3 Motion and performance

- Motion responds to navigation, input, voice energy, Challenge activation, and conclusion resolution.
- Ambient motion pauses or settles while the user reads or types.
- Prefer bounded CSS transforms, gradients, masks, and small SVG textures over full-screen continuously animated blur or expensive shaders.
- Support reduced motion, increased contrast, low-power fallbacks, and stable layout during hydration and font loading.
- Target smooth interaction on ordinary current mobile hardware, not only flagship devices.
- At the production gate, the mobile web app must achieve Lighthouse scores of at least 90 for performance and 100 for accessibility on the primary thread route, with no known interaction animation producing a main-thread task longer than 50 milliseconds in the scripted mobile trace.

## 6. Architecture

### 6.1 Application shape

- React and TypeScript mobile web application built as an installable PWA.
- Versioned IndexedDB persistence for threads, turns, conclusions, capsules, and user preferences.
- A stateless server for model requests, Realtime session creation, MCP tools/resources, health checks, and privacy-safe telemetry.
- Shared domain contracts for the web app, model service, and ChatGPT/MCP app.

### 6.2 Local-first ownership with future tenancy

The initial product has no account system and stores user content locally. The code must leave a deliberate boundary for future multi-tenant sync without implementing unused tenancy infrastructure now.

- Every persisted aggregate includes an `ownerScope` value, initially the constant `local`.
- Storage is accessed through repository interfaces scoped by `ownerScope`.
- Domain identifiers are globally unique and remain stable across export/import.
- IndexedDB schemas are explicitly versioned and migrated.
- A future remote repository or sync coordinator can implement the same contracts without changing conversation components or domain behavior.

### 6.3 Model boundary

Model access is behind a `QuestioningProvider` interface. The production OpenAI adapter is server-only. Tests use deterministic providers; the product must never silently present deterministic placeholder output as model output in production.

The provider supports three operations:

- produce the next adaptive question;
- produce an opt-in challenge response;
- draft a working conclusion.

All operations consume structured thread context and return schema-validated structured results.

### 6.4 Stateless privacy boundary

- The server does not persist conversation or capsule content.
- Requests include only the thread context required for the current operation.
- Application logs exclude prompts, transcripts, conclusions, and raw model output.
- Telemetry records operational metadata such as latency, status, response-shape validation, and coarse feature usage without user-authored content.

## 7. Domain Model

### 7.1 Thread

A thread contains identity, owner scope, lifecycle state, timestamps, ordered turn references, and an optional provisional conclusion. Starting a new thread creates a clean context.

### 7.2 Turn

A turn records role, content, modality, timestamp, operation type, and delivery state. User turns are persisted before network dispatch so model failures cannot lose writing.

### 7.3 Internal thread understanding

The questioning service maintains a compact structured understanding for the active request:

- claims and tentative claims;
- concrete examples and observations;
- named people or stakeholders;
- time and place context;
- definitions and distinctions;
- tensions, contradictions, and uncertainties;
- explored and unexplored blind spots.

This structure exists to choose better questions. It is not presented as a psychological profile and is not reused across unrelated threads.

### 7.4 Working conclusion

A working conclusion records thesis, original insights, observations, unresolved tensions, caveats, provenance, and edit state. User edits are authoritative.

## 8. Request and Validation Flow

1. Persist the user’s turn locally with a pending delivery state.
2. Build the minimum structured context for the chosen operation.
3. Send the request to the stateless service.
4. Validate the response schema.
5. Run deterministic product validators:
   - one primary question where required;
   - no `why` or disguised why-question;
   - no prohibited filler or unsolicited synthesis;
   - operation-specific response shape;
   - bounded response length.
6. If validation fails, perform one server-side repair attempt.
7. If repair fails, return a typed recoverable error without displaying invalid content.
8. Persist the accepted Specular turn and updated thread state locally.

## 9. Error Handling

- **Offline:** preserve the user turn and show a local retry state. Existing threads and capsules remain usable.
- **Timeout or provider failure:** preserve input, allow retry, and avoid fabricating a response.
- **Invalid model output:** repair once, then return a calm typed failure.
- **Storage migration failure:** stop writes, preserve the original database, and offer a local export/recovery path.
- **Microphone denial or Realtime failure:** fall back to text without blocking the thread.
- **MCP host limitation:** return text content even when the embedded widget cannot render.

Errors use concise language, do not blame the user, and do not expose server details or secrets.

## 10. Security, Privacy, and Safety

- Keep OpenAI credentials on the server and use short-lived client credentials for Realtime.
- Validate all request and response bodies with strict schemas and bounded lengths.
- Apply origin controls, secure headers, Content Security Policy, rate limiting, timeouts, and request-size limits.
- Sanitize exported filenames and content rendering.
- Avoid rendering model content as raw HTML.
- Provide local export and irreversible deletion for threads, capsules, and all content.
- Never transmit one thread’s content as context for another without explicit user action.
- Do not log user-authored content.
- Provide a clear crisis/safety response path without turning ordinary reflective conversations into clinical interactions.

## 11. Accessibility

- Meet WCAG 2.2 AA contrast requirements in every spectral state.
- Maintain at least 44 by 44 CSS-pixel touch targets.
- Support keyboard navigation, screen readers, visible focus, text scaling, and safe-area insets.
- Announce new Specular turns and network errors without stealing focus from the composer.
- Provide reduced-motion and low-power experiences with equivalent information.
- Never rely on color or animation alone to communicate Challenge, pending, error, or conclusion states.
- Support viewport widths from 320 through 430 CSS pixels without horizontal scrolling, clipped controls, or safe-area overlap.
- Support the latest two major releases of iOS Safari and Android Chrome at release time; desktop layouts remain responsive but are secondary.

## 12. Testing and Evaluation

### 12.1 Automated software tests

- Unit tests for domain operations, repositories, migrations, export/delete, and validators.
- Component tests for the empty state, composer, transcript, Challenge control, conclusion editor, and capsule library.
- Contract tests for model providers, Realtime session creation, and MCP tools/resources.
- Mobile browser tests for first-run, starter animation, typed thread, reload persistence, Challenge, conclusion editing, capsule creation, deletion, offline retry, reduced motion, and responsive safe areas.
- Production build, lint, typecheck, and dependency/security checks in CI.

### 12.2 Product evals

The questioning engine requires a repeatable eval corpus covering beliefs, decisions, creative ideas, arguments, plans, emotionally charged thoughts, ambiguous fragments, and adversarial prompt attempts.

Required eval dimensions:

- asks one useful next question;
- avoids `why` and disguised why-questions;
- does not praise, lecture, diagnose, or synthesize prematurely;
- identifies a real information gap;
- Challenge surfaces a credible blind spot or counter-position;
- conclusion is grounded in user-provided material;
- conclusion preserves uncertainty and user authority;
- output remains concise enough for mobile conversation.

Release requires zero known hard-invariant violations in the fixed gate corpus and documented review of subjective quality samples.

## 13. Observability

- Capture request identifiers, operation type, latency, provider/model identifier, token usage where available, schema validation outcome, repair count, and typed error code.
- Do not capture user-authored text or raw model output.
- Track local-only product events in aggregate only when the user has opted into telemetry.
- Provide health and readiness endpoints that verify process state without making billable model calls.

## 14. Deployment and Operations

- Deploy the PWA and stateless service over HTTPS.
- Use separate development, preview, and production configuration.
- Keep secrets in the deployment platform’s secret store.
- Use immutable build artifacts, database-free server deploys, health checks, rollback support, and dependency update automation.
- The service must degrade to local thread and capsule access when the model service is unavailable.
- The production OpenAI adapter and live smoke tests remain gated until Henry supplies or provisions `OPENAI_API_KEY`; this sequencing constraint does not alter the approved product scope.

## 15. ChatGPT App

- Expose the same next-question, Challenge, and conclusion operations through MCP tools.
- Render a compact widget using the same visual tokens and domain contracts where host constraints permit.
- Treat ChatGPT tool input/output as thread-scoped; do not imply persistent cross-thread memory.
- Preserve text-only tool responses as the compatibility baseline.
- Keep the standalone PWA as the canonical full mobile experience.

## 16. Delivery Decomposition

Implementation should proceed as independently testable sub-projects:

1. **Foundation:** TypeScript migration, domain contracts, validators, local repositories, migrations, and tests.
2. **Mobile product loop:** spectral-glass shell, animated starters, thread, composer, Challenge, conclusions, capsules, PWA, and browser tests.
3. **Model service:** stateless API, provider adapter, structured outputs, repair flow, eval harness, safety, and privacy-safe telemetry.
4. **ChatGPT and voice:** shared MCP operations, widget parity, Realtime voice behind a feature flag, and contract tests.
5. **Production hardening:** accessibility audit, performance profiling, security checks, CI, preview/production deployment, and completion audit.

Each sub-project must leave runnable, testable software and may not weaken the hard product invariants to simplify implementation.

## 17. Acceptance Criteria

The production target is achieved only when current evidence demonstrates all of the following:

1. A user can install and use the mobile PWA, create a thread, reload, and retain it locally.
2. Animated starters are interchangeable copy and do not change model strategy.
3. Normal turns ask one adaptive question and pass every hard invariant validator.
4. Challenge adaptively returns a blind-spot question or counter-position plus question.
5. Drafting a conclusion occurs only through explicit user action and produces an editable grounded result.
6. Users can keep digging, save a capsule, finish, export content, and permanently delete it.
7. A fresh thread receives no unrelated prior-thread context.
8. Spectral-glass visuals meet mobile performance, contrast, reduced-motion, and touch-target requirements.
9. Web and ChatGPT/MCP surfaces share domain contracts and questioning rules.
10. The server stores no conversation content and logs no user-authored text.
11. Automated tests, fixed product evals, typecheck, lint, production build, and security checks pass.
12. Preview and production deployments are reproducible, observable, and rollback-capable.
13. Realtime voice, when enabled, shares the text thread and never exposes the long-lived API key.
