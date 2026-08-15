# 01 — Authenticated workspace entry

**What to build:** Require server-derived ChatGPT identity before Specular exposes a workspace, and give the signed-in author a clear, quiet account boundary in the product.

**Blocked by:** None — can start immediately.

**Status:** completed-local

- [x] Anonymous session and protected API requests fail closed before private data is read.
- [x] The server derives author identity only from the verified Sites request contract and never from client payloads.
- [x] State-changing routes require same-origin mutation intent.
- [x] The browser shows a sign-in gate without rendering cached workspace content when identity is absent.
- [x] A signed-in author sees display-safe account metadata and an explicit Sign out action.
- [x] Focused Worker and browser-interface tests pass.
