# 02 — Establish visual foundations and the CSS ratchet

Status: ready-for-agent
Blocked by: 01

## Outcome

Implement the approved MagicPath `Specular` defaults as semantic tokens and reusable foundations without mechanically rewriting the whole stylesheet or preventing owner-reviewed improvements.

## Acceptance

- Canvas, document, card, and popover defaults begin from the approved `#FFFFFF` surface treatment; the superseded tan/paper direction is not retained as a parallel default.
- Playfair Display 400 and Noto Sans 400 are loaded explicitly; no component synthesizes an unprovided heavier weight.
- Black remains the primary action color and `#0274B6` is limited to focus and selected emphasis.
- Base, semantic, and narrowly necessary component token layers are defined.
- Button, icon button, field, textarea, surface, focus, and layout foundations have documented states.
- Stylelint begins with correctness and new-value enforcement; existing debt is ratcheted rather than mass-formatted.
- New raw colors, arbitrary z-index, motion, elevation, radius, and spacing require a documented exception.
- Reduced-motion, safe-area, dynamic-viewport, and 200% text utilities are covered.

## Comments

- 2026-08-15: Implemented the approved white/black neutral token system, Noto Sans 400 and Playfair Display 400 assets, dark-token contract, reusable button/field/textarea foundations, focus/safe-area/reflow/motion utilities, Stylelint correctness rules, and a prospective raw-value debt ratchet. Focused foundation tests, style checks, Storybook build, and type checks passed.
