# 09 — Add non-blocking iPhone Simulator evidence

Status: needs-triage

## Outcome

Use XcodeBuildMCP and iOS Simulator to capture practical Safari/PWA visual receipts without creating a physical-device release gate.

## Acceptance

- A documented command sequence boots a named iPhone simulator, opens Mobile Safari, navigates to the live Site, and captures semantic snapshots plus screenshots.
- The evidence set exercises Safari chrome, portrait/landscape reflow, software keyboard, safe areas, fixed notices, and critical overlays.
- Ordinary Safari and installed standalone-PWA states are identified separately.
- Any manual Add to Home Screen step is recorded honestly rather than implied to be automated.
- Simulator receipts contain synthetic/no author content.
- The output is supplemental under ADR 0007 and cannot be reported as physical-device certification.
