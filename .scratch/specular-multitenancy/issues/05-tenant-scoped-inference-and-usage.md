# 05 — Tenant-scoped inference and usage safeguards

**What to build:** Authorize every model-backed action to the current author account and bound beta usage without blocking ordinary writing.

**Blocked by:** 02 — Server-authoritative workspace.

**Status:** completed-local

- [x] Reflection, organization, transcription, and cleanup reject missing identity.
- [x] Model context can contain only material from the current private workspace or the current provisional audio request.
- [x] Per-account and global safeguards use content-free counters.
- [x] Limit failures leave writing persistence available and produce clear feature-specific feedback.
- [x] Diagnostics contain no authored writing, transcripts, model output, email, or display name.
- [x] Optional product telemetry remains disabled by default.
- [x] Focused Worker and browser tests pass.
