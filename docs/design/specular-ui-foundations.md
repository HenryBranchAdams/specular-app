# Specular UI foundations

Status: production default
Owner review: required for intentional baseline changes

## Typography

- UI, controls, labels, and metadata use Noto Sans 400.
- Authored titles, writing, reflections, and snapshot reading use Playfair Display 400.
- Font synthesis is disabled. A component that needs greater emphasis changes size, spacing, color, or structure rather than inventing an unavailable weight.

## Color and surfaces

- Canvas and primary surfaces are `#FFFFFF`.
- Subtle selected or secondary surfaces use `#F4F4F4`.
- Primary text and actions use `#222222`; muted text uses `#6F6F6F`; structure uses `#E0E0E0`.
- `#0274B6` is reserved for keyboard focus and selected emphasis. It is not decorative brand color.
- Error, warning, and success colors communicate those semantics only.
- Dark tokens remain valid under `[data-theme="dark"]`; this release does not expose a theme control.

## Component states

Buttons, icon buttons, fields, textareas, and surfaces share the semantic token layer in `src/styles.css`.

- Default: neutral surface and readable label.
- Hover: restrained opacity or neutral-surface change; no scale, glow, or spring.
- Keyboard focus: 2px blue outline with 2px offset, `:focus-visible` only.
- Selected: subtle gray fill and neutral perimeter; never a bracket, notch, badge, or decorative rail.
- Disabled or busy: action remains named, is non-interactive, and does not rely on color alone.
- Invalid: field remains editable when recovery is possible and links its error text with `aria-describedby`.

## Layout and motion

- Important touch actions use the shared 44px-equivalent target token.
- Dynamic viewport and safe-area utilities are available for full-height and fixed compositions.
- Reflow utilities permit 200% text without horizontal clipping.
- Motion uses the shared timing tokens and becomes effectively immediate under reduced motion.

## Overlays and destructive actions

- Drawers and dialogs contain keyboard focus, make their background inert, close with Escape when no operation is pending, and restore focus to the control that opened them.
- Cancel is the initial focus for irreversible or provisional-content actions. While an action is pending, both cancel and confirm remain named but disabled; a failure stays in the dialog for recovery.
- Alert dialogs are reserved for irreversible workspace deletion and discarding provisional dictation. A local block uses an inline confirmation because the decision remains adjacent to its authored content and does not interrupt the whole workspace.
- Native browser `alert` and `confirm` are not product interaction patterns. Blocking guidance is presented as an inline, announced status next to the affected draft.
- The alert-dialog layer stays above application-update notices; all overlay surfaces scroll internally on narrow-height screens.

## Prospective style ratchet

`npm run lint:styles` runs Stylelint correctness rules and verifies `docs/design/ui-style-ratchet.json`. Existing global-stylesheet debt may decrease but cannot increase by category, and a same-count substitution cannot introduce a raw visual value outside the owner-reviewed allowlist. Any new CSS file must be registered with zero raw visual values or an owner-reviewed, dated exception. `node scripts/validate-ui-style-ratchet.mjs --print-baseline` prints a proposed policy after an intentional owner-approved change; it never writes or accepts the baseline. The ratchet is intentionally bounded; it does not require mass formatting or prevent an approved token or baseline change.
