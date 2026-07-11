# Quiet Spectral Refinement

**Status:** Approved visual direction on 2026-07-10  
**Reference:** `docs/superpowers/specs/assets/specular-quiet-spectral-reference.png`, row A  
**Scope:** Standalone mobile PWA only; fresh starter, active-thread recovery, composer, offline-ready notice, and capsule-library empty state

## Intent

Refine the existing production UI around the product's core object: the thought currently in hand. Preserve the black-violet spectral identity and mobile-first behavior, while removing visual weight from optional or destructive controls. The result should feel like a quiet editorial thinking surface rather than a glowing chat card or small dashboard.

## Selected direction

Row A, **Quiet Spectral Refinement**, is authoritative. Rows B and C are rejected alternatives. The implementation should match row A's hierarchy, density, restrained optical edge, and recovery treatment without replacing working product behavior.

## Screen design

### Fresh starter

- Use an open near-black surface rather than making the starter deck read as a large bordered card.
- Keep `Specular` in a compact header and preserve direct Capsule-library access.
- Render the dominant prompt in a high-contrast editorial serif: `What idea do you want to develop?`
- Show three supporting prompts at first-viewport priority; the remaining interchangeable prompts may continue below or rotate through the same positions. No prompt selects a mode.
- Keep the composer fully visible in a 375 × 812 first viewport, including when the offline-ready notice appears.
- Render the offline-ready notice as one slim, bottom-adjacent status row that does not add shell padding or cover controls. It may auto-settle after announcement and retains a compact Dismiss action.

### Active thread and failed-turn recovery

- The latest Specular question remains the strongest typographic object.
- Earlier turns use smaller, quieter type and thin separators rather than nested message cards.
- A failed saved thought receives a bounded recovery row: error icon, thought text, `Not sent`, and a visible `Retry` control in one coherent group.
- A restored failed turn must reconstruct its actionable retry state after reload; `Not sent` is never stranded as inert status copy.
- Keep the composer compact and anchored below the transcript. Voice remains optional and is represented by a single icon control; unsupported voice is hidden visually while its availability remains accessible where needed.

### Capsule library

- Keep the full-height modal, but simplify the empty state around a single database/capsule icon, `No capsules yet.`, and a brief explanation.
- Keep Export as the only persistent footer action.
- Move `Delete current thread` and `Delete all local content` into a top-right overflow menu. Existing confirmation dialogs remain mandatory.
- Do not make destructive actions the highest-contrast objects on an empty screen.

## Visual system

- Background: true deep black-violet, not gray, slate, beige, or blue-black.
- Typography: existing sans-serif for controls/body; `ui-serif, Georgia, serif` for the dominant starter prompt and major artifact titles.
- Accent: one restrained spectral edge using cyan, ultraviolet, and lime. No glow on every control.
- Borders: thin low-contrast rules; no nested cards. A bounded failed-turn recovery surface is the sole exception because it communicates an actionable error object.
- Radius: retain the existing control radius scale, but remove the starter's oversized glass-card silhouette.
- Icons: use the existing Lucide family. Add `Database`, `Ellipsis`, `RotateCcw`, or the closest existing equivalents; do not introduce custom raster or SVG UI icons.
- Motion: supporting starter prompts drift subtly; motion pauses on focus and becomes static under reduced motion. Toast entry/exit uses opacity/transform only.

## Exact visible copy

- `Specular`
- `Capsules`
- `What idea do you want to develop?`
- Existing interchangeable starter prompts
- `Add an idea, question, thesis, or context…`
- `Not sent`
- `Retry`
- `No capsules yet.`
- `Capture and refine a thought, then export it as a capsule.`
- `Export`
- `Delete current thread`
- `Delete all local content`

## Intentional deviations from the generated board

- The composer uses neutral object-focused language rather than an invitation to personal disclosure.
- Direct Capsule-library access remains in the PWA header instead of a generic settings gear.
- The voice control remains a microphone rather than the mockup's plus button because Realtime voice is an approved product capability.
- The PWA uses the existing Lucide icon library rather than reproducing the mockup's illustrative glyphs.
- Existing thread titles remain data-derived rather than hard-coding `Decision clarity`.

## Components and behavior

- `PwaUpdatePrompt`: compact overlay/status with no shell reflow.
- `StarterDeck`: open editorial layout with a dominant serif prompt and reduced first-viewport density.
- `Composer`: one-line control row, compact optional voice icon, send button, no duplicate unavailable label.
- `Transcript`: failed turns expose an inline Retry button wired to the existing retry operation.
- `CapsuleLibrary`: empty-state icon/copy and an accessible overflow menu for owner-wide destructive actions.
- `App` / `useSpecular`: restore the retry target from persisted failed or interrupted user turns.

## Error and accessibility requirements

- Retry remains keyboard accessible, at least 44 × 44 CSS pixels, and announced as an action rather than status text.
- The overflow control exposes an accessible name, closes on Escape/outside selection, and preserves confirmation before deletion.
- The offline-ready notice stays in a polite live region but never steals focus.
- Unsupported voice does not leave duplicate visible failure text.
- All states retain 320–430px support, 200% text scaling, safe-area padding, visible focus, reduced motion, and zero horizontal overflow.

## Verification

- Component tests for compact toast, hidden unsupported voice, inline retry, restored retry, overflow menu, and confirmation preservation.
- Browser comparison at 375 × 812 against row A for starter, restored failure, and empty capsule library.
- Narrow 320 × 700 and desktop secondary checks.
- Axe, focus, reduced-motion, safe-area, long-task, Lighthouse, full validation, fixed evals, and production build remain green.

## Self-review

- No placeholders or unresolved design choices remain.
- Scope is limited to the approved PWA surfaces.
- Existing product invariants, persistence, deletion confirmation, and voice capability are preserved.
- The mockup is treated as a hierarchy and visual-system reference, not as permission to hard-code sample conversation data.
