# 06 — Authenticated snapshot lifecycle

**What to build:** Make every hosted snapshot an owner-managed, signed-in capability artifact without exposing account identity as attribution.

**Blocked by:** 02 — Server-authoritative workspace.

**Status:** completed-local

- [x] Snapshot creation derives ownership from the current author account.
- [x] Anonymous snapshot reads fail closed while signed-in visitors with the opaque link can read the published projection.
- [x] Snapshot payloads omit private workspace and ChatGPT identity metadata.
- [x] Authors can list and revoke only their own hosted snapshots.
- [x] Revoked, missing, and unauthorized private artifacts expose no distinguishing metadata.
- [x] Existing unowned test snapshots are removed by the authenticated schema cutover.
- [x] Focused Worker and browser tests pass.
