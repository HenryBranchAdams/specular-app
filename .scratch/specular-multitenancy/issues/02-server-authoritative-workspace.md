# 02 — Server-authoritative workspace

**What to build:** Give every author account one isolated hosted private workspace that loads across browsers and saves through revision-checked server writes.

**Blocked by:** 01 — Authenticated workspace entry.

**Status:** completed-local

- [x] First sign-in creates a fresh validated private workspace and opaque cache namespace.
- [x] Workspace reads and writes are tenant-scoped at the D1 query.
- [x] Writes are revision-checked and retry identifiers are idempotent.
- [x] Two accounts using the same server cannot read or change one another's workspace.
- [x] A second browser for the same account loads the acknowledged workspace.
- [x] Existing writing, reflection, dictation, connections, and history behavior remains intact.
- [x] Focused Worker, workspace-interface, and browser tests pass.
