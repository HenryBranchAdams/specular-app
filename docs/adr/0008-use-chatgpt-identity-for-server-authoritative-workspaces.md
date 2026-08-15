# Use ChatGPT identity for server-authoritative workspaces

Specular assigns each signed-in ChatGPT author account one server-authoritative private workspace, keyed only by the stable Site-scoped user ID supplied to server requests. Browser-local partitioning would be simpler, but it would not provide account-level isolation or cross-device continuity; email and client-provided identity are rejected because they are mutable or untrusted.
