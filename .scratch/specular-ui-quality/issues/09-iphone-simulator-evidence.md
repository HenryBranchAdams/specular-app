# 09 — Add non-blocking iPhone Simulator evidence

Status: ready-for-agent
Blocked by: 08

## Outcome

Use XcodeBuildMCP and iOS Simulator to capture practical Safari/PWA visual receipts without creating a physical-device release gate.

## Acceptance

- A documented command sequence boots a named iPhone simulator, opens Mobile Safari, navigates to the live Site, and captures semantic snapshots plus screenshots.
- The evidence set exercises Safari chrome, portrait/landscape reflow, software keyboard, safe areas, fixed notices, and critical overlays.
- Ordinary Safari and installed standalone-PWA states are identified separately.
- Any manual Add to Home Screen step is recorded honestly rather than implied to be automated.
- Simulator receipts contain synthetic/no author content.
- The output is supplemental under ADR 0007 and cannot be reported as physical-device certification.

## Comments

- 2026-08-15: Captured synthetic iPhone 17 Pro / iOS 26.5 receipts under `docs/validation/iphone-simulator/` for the deployed Safari route and the local visual candidate. The package covers portrait, landscape, Safari chrome and safe areas, the live fixed notice, Library and Snapshot overlays, focused writing, and semantic UI snapshots.
- 2026-08-15: The deployed route remains the pre-rework tan UI, so it is labeled only as live-route/browser-chrome evidence. Candidate receipts come from a loopback synthetic fixture; no publication is implied.
- 2026-08-15: Safari exposed its input accessory strip but not the full on-screen key grid after the hardware/software keyboard toggles. The limitation is recorded explicitly. Installed standalone-PWA capture remains a distinct manual Add to Home Screen follow-up under ADR 0007, and no physical-device certification is claimed.
