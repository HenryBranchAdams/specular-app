# 05 — Unify overlays, focus, and destructive actions

Status: needs-triage

## Outcome

Give the Library drawer, Snapshot editor, menus, disclosures, and destructive confirmations one dependable interaction contract.

## Acceptance

- Modal surfaces contain focus, support appropriate Escape dismissal, make the background inert, and restore trigger focus.
- Drawer and dialog semantics match their visual and interaction behavior.
- Native `alert`/`confirm`, inline confirmation, and custom alert-dialog usage are reconciled into documented patterns.
- Initial destructive focus, pending state, failure, cancellation, and recovery are consistent.
- Narrow-height, long-content, keyboard-only, and PWA-overlay layering cases pass.
- Important touch targets meet the agreed mobile size policy.
