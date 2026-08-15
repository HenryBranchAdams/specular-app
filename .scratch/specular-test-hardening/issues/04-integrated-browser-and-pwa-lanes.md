# 04 — Integrated browser and PWA lanes

**Status:** completed

**Blocked by:** 02, 03

**What to build:** Split Playwright into mocked UI, real Worker/D1 integrated journeys, and Chromium-only PWA lifecycle suites. Add runtime auth-route pass-through and two-version update tests.

**Acceptance:** Backend-critical journeys use the real Worker/D1; PWA tests prove cache provenance, API/auth exclusion, warm-offline behavior, cold-offline shielding, and safe version takeover.
