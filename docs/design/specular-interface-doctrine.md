# Specular interface doctrine

Status: approved current direction
Approved: 2026-08-15
Applies to: the hosted workspace, PWA states, hosted snapshots, and supported embedded surfaces

Default visual reference: [`specular-magicpath-source.md`](specular-magicpath-source.md) and the linked MagicPath canvas

Historical alignment sheet: [`assets/specular-design-system-sheet-v1.png`](assets/specular-design-system-sheet-v1.png) (superseded; retained for provenance only)

Component registry: [`specular-component-library.md`](specular-component-library.md)

## Product promise

Specular is a private thinking environment in which an author uses nonlinear writing to discover and refine what they think while retaining visible control of their words.

The interface should make authorship feel calm, precise, trustworthy, and recoverable. It must never resemble a generic chatbot, an AI-generated dashboard, or a decorative productivity template.

`CONTEXT.md` and accepted ADRs remain authoritative for domain language, privacy, persistence, synchronization, and authorship. This doctrine governs visual character, interaction quality, and presentation.

## Default visual direction

**Begin with the owner-selected MagicPath `Specular` system.**

Specular retains an editorial, authored-document character without a tan or paper wash. The application canvas and document surfaces default to `#FFFFFF`; muted structure uses `#F4F4F4`; borders and inputs use `#E0E0E0`; primary actions are black. Do not reinterpret “editorial” as beige, nostalgic, or ornamental.

These are defaults, not immutable rules. A contributor may propose a better treatment when it preserves product meaning and accessibility; the owner evaluates the visible result. Avoid undocumented drift and mechanical pixel-copying alike.

The product should feel:

- precise rather than sterile;
- quiet rather than empty;
- editorial rather than nostalgic;
- distinctive rather than ornamental;
- substantial rather than heavy;
- technologically capable without looking “AI-themed.”

## Visual principles

### Canvas and surfaces

- Use `#FFFFFF` for the primary application canvas, card, popover, and canonical document surfaces.
- Use `#F4F4F4` and `#F9F9F9` only for semantic muted, secondary, accent, and sidebar structure.
- Create hierarchy through spacing, alignment, contrast, and restrained borders before adding cards or shadows.
- Avoid nested beige cards, translucent blobs, decorative gradients, excessive blur, and low-contrast floating panels.

### Typography

- Use Playfair Display 400 for authored writing and deliberate editorial hierarchy.
- Use Noto Sans 400 for controls, metadata, status, navigation, and interface body copy.
- Do not synthesize heavier font weights. Create emphasis through size, spacing, placement, and contrast.
- Preserve comfortable reading width and line height for canonical writing.
- Do not use tiny, faint metadata to manufacture elegance.
- Narrow screens receive deliberately designed type scales; desktop clamps alone are insufficient.

### Color

- Use `#222222` foreground on `#FFFFFF` for primary light-mode content.
- Keep muted text readable and subordinate, not washed out.
- Reserve `#0274B6` for visible focus rings and selected emphasis. It is not a filled primary-action color.
- Use danger, warning, success, and synchronization colors semantically.
- Never rely on color alone to communicate state.

### Geometry

- Use `0.75rem` as the default radius, with the loaded `0.5rem`, `1rem`, and `1.5rem` scale only when component purpose requires it.
- Pills are reserved for objects whose semantics justify them, such as tags or compact filters.
- Buttons should not become pills merely to appear friendly.
- Borders and separators should clarify structure without turning the document into a grid.

### Space

- Empty space must reinforce hierarchy, pacing, or concentration.
- Large unstructured gaps are not “calm.”
- Primary task, supporting explanation, and primary action should read as one intentional composition.
- Mobile spacing should respond to available height as well as width, safe areas, software keyboards, and browser chrome.

### Motion and depth

- Motion explains state or spatial continuity; it is not ambient decoration.
- Respect reduced-motion preferences.
- Use only the loaded restrained shadow scale. Shadows indicate real layering or temporary elevation and are not ambient decoration.
- Fixed and floating surfaces must not obscure focus, controls, or authored writing.

## Interaction principles

### One primary task

Each state should make its next meaningful author action obvious. Secondary, destructive, and explanatory actions remain available without competing for attention.

### Pattern follows purpose

- Toast: a transient, nonessential completed outcome.
- Inline alert: a persistent problem tied to affected content.
- Banner: a rare route- or workspace-wide condition.
- Application notice: a persistent update or system action with explicit choices.
- Dialog: a focused decision that requires temporary modality.
- Drawer: a contained secondary workspace with complete focus and dismissal behavior.
- Tag: non-interactive metadata.
- Chip/filter: an interactive category or filter.

Visual resemblance does not make these patterns interchangeable.

### Authorship and provenance

- Canonical writing remains visually primary.
- Generated titles, inferred kinds, reflections, directions, and external sources remain visibly distinguishable from authored writing.
- Calibration remains ephemeral unless the author deliberately returns substance to the document.
- Status feedback must not imply ownership, availability, synchronization, or durability that the system cannot provide.

### Recovery over surprise

- Preserve writing before updates, reloads, authentication loss, and synchronization transitions.
- Explain recovery and conflict states in plain language.
- Destructive actions use consistent confirmation, focus, pending, error, and recovery behavior.
- Busy and disabled controls explain what is happening when that information affects the author's decision.

### Accessibility is part of the visual system

- Keyboard focus is always visible and unobscured.
- Persistent selection and transient keyboard focus are separate states: selected list rows use the neutral MagicPath treatment, while the blue focus outline appears only on `:focus-visible` around the complete control.
- Do not substitute ornamental brackets, partial rails, glows, or badges for a complete focus indication.
- Important mobile actions aim for approximately 44 by 44 CSS pixels while respecting the WCAG floor.
- Ordinary content reflows at 320 CSS pixels and 200% text without overlap or two-dimensional scrolling.
- Dialogs and drawers contain focus, support Escape where appropriate, make the background inert, and restore focus.
- Dynamic status and error messages use the correct announcement urgency.
- Automation supplements rather than replaces keyboard, zoom, screen-reader, and simulator review.

## Responsive doctrine

Specular is mobile-first but not mobile-only.

Every critical composition must be intentionally reviewed at:

- 320, 375, and 430 CSS-pixel mobile widths;
- a representative desktop width;
- 200% browser text or equivalent zoom/reflow;
- narrow viewport height;
- software-keyboard exposure where a field can receive text;
- Safari browser chrome and standalone-PWA modes where applicable.

Use dynamic viewport units and safe-area environment variables for edge-adjacent essential controls. Responsive acceptance includes hierarchy and visual balance—not merely absence of horizontal overflow.

## Component doctrine

Specular owns its visual language. Native HTML and the existing Radix foundation may supply behavior; neither third-party defaults nor one-off CSS defines the product.

Reusable visible components must have:

- a narrow, named API;
- supported visual variants and sizes;
- accessible naming and focus behavior;
- loading, disabled, error, and long-content behavior where applicable;
- deterministic synthetic-data stories;
- responsive and visual evidence;
- a registry/manifest entry or explicit temporary exception.

Use three token layers:

1. base values such as palette, space, type, radius, elevation, and motion;
2. semantic roles such as canvas, document surface, text, border, focus, danger, and success;
3. component tokens only when semantic roles cannot express a legitimate component need.

## Embedded surfaces

An embedded host may justify a distinct density or chrome treatment, but not a separate product meaning. The repository's separately built MCP widget is currently classified as a legacy compatibility surface outside the hosted-product rework. It is neither an active hosted surface nor implicitly scheduled for removal. Retention, adaptation, or removal requires separate future work.

## Quality approval

Automated gates prevent known regressions; they do not decide whether a surface is wonderful.

Intentional visual-baseline changes require concise before/after evidence and the owner's greenlight. Keep this lightweight. Add more approval structure only if team scale or repeated regressions demonstrate a need.

## Supersession

This document supersedes the visual direction—not the still-valid product or engineering decisions—in earlier dark spectral/chat-oriented design specifications. Those documents remain historical evidence and must be labeled accordingly when the implementation batch begins.
