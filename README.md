# Specular

Specular is a private environment for people who use writing to discover what they think. Its primary surface is a nonlinear, block-based document. A selection-aware philosophical interlocutor can reflect the writing back, expose an unresolved edge, or open a linked direction—but it never writes canonical prose for the author.

The hosted beta requires ChatGPT sign-in and keeps one server-authoritative private workspace per Site-scoped author account. An account-scoped browser cache keeps writing responsive and available through temporary disconnections. Only context needed for an explicitly invoked model-backed action is sent for inference. Published snapshots contain selected user-authored writing, confirmed order, and source metadata; margin responses and ChatGPT identity are excluded.

## Product invariants

- Every substantive word in the thinking document is written by the user.
- Dictation remains a provisional text draft until the author explicitly chooses Keep.
- Reflection is explicit, selection-aware, provisional, and kept in the margin.
- Calibration chat is ephemeral; clarity must return to the canonical document.
- Context can be limited to a selection, connected blocks, the current document, or the workspace.
- Connections show user-authored material and keep document/workspace scope visible.
- Edits preserve recoverable local history. Staleness changes visual status, not meaning.
- Outside knowledge appears only through an explicit move and carries source links.
- Snapshots and exports omit interlocutor prose.

## Local development

Use Node 22.23.1 and npm 10.9.8:

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5177`. The Sites-compatible development worker reads ignored local configuration from `.env.local`; `OPENAI_API_KEY` enables live reflection, dictation transcription, and optional faithful cleanup. The interface and deterministic tests do not require a key.

Dictation is available from the microphone button on the focused writing block. Keep Specular visible while speaking: mobile browsers may suspend microphone capture when the app is backgrounded or the screen locks. Specular checkpoints speech as text, marks interruptions explicitly, and never promotes a draft into canonical writing without Keep. Audio is not retained in the workspace. The optional cleanup preference is local and can be set to Verbatim to skip the separate text cleanup request.

## Validation

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

`npm run build` produces the Sites frontend and Worker entrypoint. The D1 migrations in `drizzle/` back authenticated workspaces, content-free inference counters, and author-owned snapshot pages. IndexedDB retains separate offline-capable caches for the author accounts used on that device.

## Hosted release

The Ready to Use production package is designed for deployment with ChatGPT Sites. Its Worker exposes:

- `GET /api/session` for the server-verified ChatGPT account boundary
- `GET` and `PUT /api/workspace` for revision-checked private workspace synchronization
- `POST /api/reflect` for explicit margin reflection
- `POST /api/dictation/transcribe` for bounded audio checkpoints
- `POST /api/dictation/cleanup` for optional faithful transcript cleanup
- `POST /api/shares` for immutable snapshot publication
- `GET /api/shares` and `DELETE /api/shares/:slug` for author-owned link management
- `GET /api/shares/:slug` for published artifacts
- `GET /api/archive` and `DELETE /api/account` for tenant-scoped data control
- `GET /healthz` for deployment health

The repository still contains the earlier native/MCP server as a separately built compatibility surface. It does not define the hosted product interaction.
