# 02 — Wrangler production-build and D1 integration spine

**Status:** completed

**Blocked by:** 01

**What to build:** Add a direct Wrangler dependency and a reusable `createTestHarness()` fixture that builds the production Worker, applies checked-in D1 migrations, seeds fixed synthetic tenants, resets bindings between tests, and exposes diagnostics only on failure.

**Acceptance:** A red-then-green tracer test reaches the built Worker's session route and real local D1. The harness never changes remote state and requires no production credentials.
