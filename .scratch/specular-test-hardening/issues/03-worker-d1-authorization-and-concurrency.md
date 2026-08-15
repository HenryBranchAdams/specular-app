# 03 — Worker/D1 authorization, migration, and concurrency tests

**Status:** completed

**Blocked by:** 02

**What to build:** Exercise every protected HTTP method/resource through actual D1, including tenant A/B isolation, migration epochs, atomic compare-and-set, mutation replay, quotas, snapshots, archive, deletion generation, and deterministic provider failures.

**Acceptance:** Concurrent same-revision mutations produce exactly one winner, reopening converges durably, foreign identifiers never cross responses, and runtime DDL is removed after migrations become authoritative.
