# 03 — Offline workspace cache and session locking

**What to build:** Preserve responsive and offline writing in an account-scoped cache while preventing stale or differently authenticated sessions from rendering it.

**Blocked by:** 02 — Server-authoritative workspace.

**Status:** completed-local

- [x] Authored changes are durable in the workspace cache before appearing locally saved.
- [x] Offline changes survive reload and synchronize after reconnection.
- [x] The UI communicates synchronized, unsynced, synchronizing, and locked states quietly.
- [x] Identity loss or change hides the workspace before another account renders.
- [x] Explicit Sign out synchronizes, handles remaining unsynced work, clears the current account cache, and uses the Sites-owned route.
- [x] Legacy unowned local test data is removed without being claimed.
- [x] Two account caches in one browser remain isolated.
- [x] Focused cache, browser, offline, and accessibility tests pass.
