# Use an account-scoped cache for offline writing

Specular keeps a durable workspace cache partitioned by author account so writing can continue during disconnection and synchronize afterward. An online-only workspace would simplify concurrency, while a browser-authoritative workspace would weaken cross-device continuity; the cache therefore preserves unsynced changes without becoming the authority for ownership or silently overwriting newer server state.
