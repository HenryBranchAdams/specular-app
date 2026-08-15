# Specular MagicPath visual source

Status: approved default visual reference
Approved: 2026-08-15
MagicPath file: [Specular design system and product surfaces](https://www.magicpath.ai/files/439449649565290496)

This document records the owner-selected MagicPath `Specular` design system and the representative surfaces generated from it. Together with `specular-interface-doctrine.md`, it replaces the prior visual alignment sheet and the earlier loosely defined “clean/crisp with selective warmth” plan as the current default.

The MagicPath canvas is the visual reference. This file records implementation defaults, not an immutable pixel contract. Contributors may improve or adapt them when product semantics, accessibility, platform behavior, or a visibly better composition warrants it; owner review decides whether a deviation succeeds. `CONTEXT.md` and accepted ADRs remain authoritative for product behavior, privacy, persistence, synchronization, and authorship.

## Default theme

### Typography

- Interface and body: Noto Sans, weight 400.
- Authored-document and heading hierarchy: Playfair Display, weight 400.
- Do not synthesize heavier weights. Establish hierarchy through size, line height, spacing, placement, and contrast.

### Light tokens

| Role | Value |
|---|---|
| Background, card, popover | `#FFFFFF` |
| Foreground and card text | `#222222` |
| Primary / primary foreground | `#000000` / `#FFFFFF` |
| Secondary, muted, accent | `#F4F4F4` |
| Border and input | `#E0E0E0` |
| Muted foreground | `#6F6F6F` |
| Focus ring and selected emphasis | `#0274B6` |
| Destructive / destructive foreground | `#E53935` / `#FFFFFF` |
| Sidebar | `#F9F9F9` |
| Sidebar accent | `#EAEAEA` |

The loaded theme also defines semantic chart colors. They do not authorize decorative color in ordinary product chrome. Use them only when a real data or connection meaning requires them and the interface remains understandable without color.

### Dark tokens

| Role | Value |
|---|---|
| Background and sidebar | `#121212` |
| Card and popover | `#1E1E1E` |
| Foreground | `#F5F5F5` |
| Secondary, muted, border, input | `#2A2A2A` |
| Accent | `#333333` |
| Muted foreground | `#A0A0A0` |
| Primary / primary foreground | `#FFFFFF` / `#000000` |
| Focus ring and selected emphasis | `#0274B6` |
| Destructive | `#D32F2F` |

Dark mode is a supported token reference, not permission to revive the superseded dark spectral/chat-oriented product.

### Geometry and elevation

- Default radius: `0.75rem`.
- Supported radius scale: `0.5rem`, `0.75rem`, `1rem`, and `1.5rem`.
- Use the supplied restrained shadow scale only to communicate actual layering. Flat separation by spacing and border remains the default.
- Pills remain semantic exceptions for tags, filters, and similarly compact objects; ordinary buttons do not become decorative capsules.

### Selection and keyboard focus

- A persistent current/selected navigation row uses `#F4F4F4` fill, `#222222` text, and a one-pixel `#E0E0E0` inset perimeter. It does not use blue or left-edge decoration.
- Keyboard `:focus-visible` uses a two-pixel `#0274B6` outline around the complete control with a two-pixel `#FFFFFF` offset.
- A selected and keyboard-focused row combines the neutral selected treatment with the blue focus outline.
- Do not use curved brackets, accent rails, notches, dots, badges, glows, or shadows as generic selection/focus decoration.
- Pointer activation must not leave a keyboard focus ring behind. Preserve `aria-current` or the equivalent semantic current-state signal independently of visual focus.

## Generated reference surfaces

The MagicPath file contains five coordinated, responsive references:

1. **Design System Board** — foundations, typography, controls and states, navigation and selection, feedback patterns, overlays, and a compact dark-mode reference.
2. **Desktop Writing Workspace** — quiet application chrome, Document/Connections navigation, canonical writing, reflection margin, provenance, add-block, and dictation actions.
3. **Mobile Writing Workspace** — an iPhone-width authored document, 44-pixel touch targets, safe-area-aware fixed actions, update notice, and subordinate reflection.
4. **Mobile Auth + Update States** — the exact “Your private thinking workspace” boundary, one “Sign in with ChatGPT” action, and a persistent update state with “Update now,” “Later,” and writing-preservation reassurance.
5. **Connections, Library Drawer & Snapshot Dialog** — connection cards, provisional dictation review, a contained Library drawer, and a focused destructive Snapshot dialog.

## Surface audit result

The reviewed first pass preserved the authoritative product distinctions:

- canonical author writing is visually primary;
- reflection is labeled non-prescriptive and remains subordinate;
- external sources and provisional transcript are distinguishable from canonical writing;
- sign-in does not invent email, password, passkey, or provider fields;
- update availability is an application notice rather than a transient toast;
- black, not blue, is the primary action color;
- the system does not use a tan wash, chat bubbles, gradients, glassmorphism, glowing AI accents, or bento-dashboard framing.

One generated label initially specified Playfair Display at weight 700. That contradicted the loaded theme, which imports only weight 400. A corrective MagicPath pass updated all five surfaces, removed synthesized medium/semibold/bold classes, and changed the board specimen to `Playfair Display 36 / 44 · 400`.

## Implementation boundary

The MagicPath file is a design source, not evidence that the repository implements or passes these states. Production work still requires deterministic fixtures, responsive and accessibility checks, visual baselines, and owner review. MagicPath defaults may be adapted rather than copied mechanically. If a generated composition conflicts with domain semantics, accessibility, or an accepted ADR, those product requirements win.

## Superseded artifact

`assets/specular-design-system-sheet-v1.png` is retained as historical evidence but is not an implementation reference. It represented the earlier exploratory direction and must not be used to override this MagicPath source.
