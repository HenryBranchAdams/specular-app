# Specular

Specular is a private environment for people who use writing to discover what they think. Its primary surface is a nonlinear, block-based document. A selection-aware philosophical interlocutor can reflect the writing back, expose an unresolved edge, or open a linked direction—but it never writes canonical prose for the author.

The hosted release keeps the workspace corpus in the browser. Only the context the author deliberately exposes is sent for inference. Published snapshots are immutable artifacts containing selected user-authored writing, confirmed order, and source metadata; margin responses are excluded.

## Product invariants

- Every substantive word in the thinking document is written by the user.
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

Open `http://127.0.0.1:5177`. The Sites-compatible development worker reads ignored local configuration from `.env.local`; `OPENAI_API_KEY` enables live reflection. The interface and deterministic tests do not require a key.

## Validation

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

`npm run build` produces the Sites frontend and Worker entrypoint. The D1 migration in `drizzle/` backs published snapshot pages. Local workspace writing remains in IndexedDB.

## Hosted release

The Ready to Use version is packaged and deployed with ChatGPT Sites. Its Worker exposes:

- `POST /api/reflect` for explicit margin reflection
- `POST /api/shares` for immutable snapshot publication
- `GET /api/shares/:slug` for published artifacts
- `GET /healthz` for deployment health

The repository still contains the earlier native/MCP server as a separately built compatibility surface. It does not define the hosted product interaction.
