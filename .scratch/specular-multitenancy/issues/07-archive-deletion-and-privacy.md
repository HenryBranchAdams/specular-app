# 07 — Archive, deletion, and privacy controls

**What to build:** Give each author transparent control over their hosted data without introducing archive import or cross-account effects.

**Blocked by:** 03 — Offline workspace cache and session locking; 06 — Authenticated snapshot lifecycle.

**Status:** completed-local

- [x] Authors can download a versioned archive containing only their durable author-owned workspace material and snapshot records.
- [x] Offline authors can download distinct recovery material for unsynced cached writing.
- [x] Archive import is absent and clearly not implied by the UI.
- [x] Delete all removes only the current account's authored data and owned snapshots after explicit confirmation.
- [x] Deletion rotates the cache generation so stale devices cannot resurrect removed data.
- [x] Settings explains hosted storage, local caching, inference triggers, diagnostics, and excluded content.
- [x] Focused Worker, cache, browser, and accessibility tests pass.
