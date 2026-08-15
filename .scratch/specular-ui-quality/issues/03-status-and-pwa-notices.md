# 03 — Separate status semantics and repair PWA notices

Status: ready-for-agent
Blocked by: 02

## Outcome

Replace the all-purpose PWA prompt with context-aware toast, inline-alert, banner, and application-notice behavior.

## Acceptance

- Offline-ready confirmation is not shown while signed out or while the private workspace is locked.
- Update availability is persistent, author-actionable, and explains safe preservation before refresh.
- The 320/375/430 layouts never wrap short action labels or make controls compete with the message.
- Fixed positioning respects safe areas, browser chrome, software keyboards, and modal stacking.
- Timer, dismissal, focus, announcement, preparing, and update-failure behavior are specified and tested.
- Visual baselines include update-ready, preparing, failure, and offline-ready states.

## Comments

- 2026-08-15: Implemented distinct persistent update-notice and transient offline-toast behavior. Offline readiness mounts only with the authenticated workspace, auto-dismisses after six seconds, pauses while focused or hovered, and remains manually dismissible. Update preparation preserves work, exposes retryable failure, avoids focus theft, and uses safe-area/keyboard-aware responsive layout. Story states and focused component tests cover ready, preparing, failure, offline, dismissal, and workspace-lock suppression.
- 2026-08-15: Added immutable Chromium baselines for update-ready, preparing, failure, and offline-ready mobile states. The release-evidence contract now requires all four receipts.
