# 05 — Unify overlays, focus, and destructive actions

Status: ready-for-agent
Blocked by: 02

## Outcome

Give the Library drawer, Snapshot editor, menus, disclosures, and destructive confirmations one dependable interaction contract.

## Acceptance

- Modal surfaces contain focus, support appropriate Escape dismissal, make the background inert, and restore trigger focus.
- Drawer and dialog semantics match their visual and interaction behavior.
- Native `alert`/`confirm`, inline confirmation, and custom alert-dialog usage are reconciled into documented patterns.
- Initial destructive focus, pending state, failure, cancellation, and recovery are consistent.
- Narrow-height, long-content, keyboard-only, and PWA-overlay layering cases pass.
- Important touch targets meet the agreed mobile size policy.

## Comments

- 2026-08-15: Implemented one overlay contract for Library, Snapshot, account deletion, and provisional dictation discard: initial safe focus, focus containment, inert background, Escape cancellation, trigger restoration, scrollable narrow-height layouts, and semantic layer ordering. Native browser prompts were removed; blocking dictation guidance is now announced inline, while local block deletion remains an adjacent inline confirmation under the documented risk-tier rule. Added synthetic Storybook states and focused unit, accessibility, and 390-by-500 browser coverage. Manifest, styles, typecheck, 40 focused unit tests, Storybook build, and 10 Chromium accessibility/workflow scenarios passed. Owner visual review follows in checkpoint 1.
