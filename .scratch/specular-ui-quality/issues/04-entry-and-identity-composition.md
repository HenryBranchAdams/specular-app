# 04 — Refactor entry and identity compositions

Status: ready-for-agent
Blocked by: 02

## Outcome

Make verification, signed-out, failed-verification, authentication-loss, and locked-workspace states feel deliberate and consistent with the current doctrine and owner-approved visual defaults.

## Acceptance

- Brand, heading, explanation, and primary action form one intentional composition at target widths and narrow heights.
- The page uses dynamic viewport and safe-area-aware spacing.
- Headline scale and wrapping are designed for 320 CSS pixels and 200% text.
- Copy uses canonical author/private-workspace language and does not imply a local-only mode.
- Sign-in busy, failure, retry, and focus states are represented in stories and route screenshots.
- The owner approves the before/after visual baseline.

## Comments

- 2026-08-15: Implemented one shared entry/identity composition for signed-out, verification-failed, authentication-loss, and locked-workspace states. The white dynamic-viewport layout uses safe-area spacing, bounded Playfair headings, canonical hosted-workspace language, an explicit retry path that stays fail-closed, and a represented sign-in busy state. Focused auth, App, Storybook-build, style, and type checks passed; owner visual review is scheduled for checkpoint 1 after issue 05.
