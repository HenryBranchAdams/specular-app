# 08 — Integrated acceptance and live-qualification harness

**What to build:** Prove the complete authenticated beta locally and provide a repeatable live Sites qualification procedure without deploying or changing access.

**Blocked by:** 04 — Conflict-copy synchronization; 05 — Tenant-scoped inference and usage safeguards; 06 — Authenticated snapshot lifecycle; 07 — Archive, deletion, and privacy controls.

**Status:** ready-for-live-qualification

- [x] Full type checking, lint, unit, integration, production-build, browser, accessibility, PWA, and performance gates pass.
- [x] Automated two-account tests prove isolation across workspace, cache, inference, snapshot, archive, and deletion operations.
- [x] The production package preserves the existing Sites project and contains no secret or authored test data.
- [x] A documented live checklist covers two real ChatGPT accounts, same-browser switching, expiry, revocation, external visitor identity, spoof attempts, and signed-in snapshot links.
- [x] Automated engines and unperformed live checks are reported honestly.
- [x] No deployment or Sites access mutation occurs without separate authorization.
