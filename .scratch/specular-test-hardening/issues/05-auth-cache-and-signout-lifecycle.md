# 05 — Auth, cache, sign-out, and update lifecycle

**Status:** completed

**Blocked by:** 04

**What to build:** Fix stale authenticated UI test-first: central authentication-loss propagation, `pageshow` revalidation, immediate shielding, cache cleanup/quarantine, final-sync recovery, platform sign-out navigation, and waiting service-worker activation.

**Acceptance:** Session or workspace 401 immediately removes private UI; sign-out cannot bounce back into cached writing; pending writing is recoverable; and service-worker activation never discards acknowledged or checkpointed author text.
