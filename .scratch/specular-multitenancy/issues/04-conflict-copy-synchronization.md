# 04 — Conflict-copy synchronization

**What to build:** Reconcile multi-device changes without ever choosing or merging the author's prose automatically.

**Blocked by:** 03 — Offline workspace cache and session locking.

**Status:** completed-local

- [x] Retried mutations are idempotent.
- [x] Independent document changes synchronize without conflict.
- [x] Concurrent changes to the same document preserve the server version and create a linked conflict copy from the cached version.
- [x] Conflict copies are visibly identified until resolved or dismissed.
- [x] Synchronization never merges, rewrites, or discards document prose.
- [x] Focused workspace-interface and browser tests pass.
