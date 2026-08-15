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

## Prospective style ratchet

`npm run lint:styles` runs Stylelint correctness rules and verifies `docs/design/ui-style-ratchet.json`. Existing global-stylesheet debt may decrease but cannot increase by category. Any new CSS file must be registered with zero raw visual values or an owner-reviewed, dated exception. The ratchet is intentionally bounded; it does not require mass formatting or prevent an approved token or baseline change.
