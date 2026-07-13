# Specular

Specular is a private, question-led workspace for developing ideas, clarifying concepts, testing theses, and working through decisions. It asks one focused question at a time, offers an explicit Challenge, and can draft a grounded working conclusion. The same bounded domain contracts and stateless operation service power the PWA, native JSON API, and ChatGPT/MCP app.

## Local development

Use Node 22.23.1 and npm 10.9.8. With `nvm`, `nvm use` reads the checked-in
`.nvmrc`. Install the exact locked dependency graph with:

```bash
npm ci
```

The model server reads ignored local configuration from `.env.local`. Copy
`.env.example` when you need to configure it manually; keep
`OPENAI_API_KEY` blank for non-live UI and boundary work.

Run the full stack in two terminals:

```bash
npm run dev:server
```

```bash
npm run dev
```

Open `http://127.0.0.1:5177` (or `http://localhost:5177`). Vite proxies `/api` to the server at
`http://127.0.0.1:8788`; `SPECULAR_DEV_API_ORIGIN` can override that target.
The server rebuilds and restarts when its source changes. Production assets are
built with `npm run build`.

Native development binds both services to loopback by default, so a local API
key is not exposed to the LAN. Set `HOST=0.0.0.0` only in an isolated container
or when remote access is deliberate.

The equivalent container workflow is:

```bash
docker compose --profile development up --build
```

Compose mounts the web and server source directories read-only, so both Vite
and the model server watch live host edits. Published development ports remain
restricted to `127.0.0.1` even though each service listens on the container
interface. Stop the stack with `docker compose --profile development down`.

## Compiled model and MCP server

The native Node server exposes:

- `POST /api/operations/next-question`
- `POST /api/operations/challenge`
- `POST /api/operations/conclusion`
- `POST`, `GET`, `DELETE`, and `OPTIONS /mcp`
- `GET /healthz` and `GET /readyz`

Build and run the compiled server:

```bash
npm ci
npm run chatgpt:server
```

`chatgpt:server` runs `build:server`, loads `.env.local` when present, and then starts `dist-server/index.js`. The default endpoint is `http://localhost:8788/mcp`; set `PORT` to change it.

In a second terminal, inspect the running endpoint with:

```bash
npm run chatgpt:inspect
```

The Inspector command targets `http://localhost:8788/mcp`. It is optional and is not part of the test suite.

### Provider readiness and health checks

Set `OPENAI_API_KEY` in the server environment to enable model-backed operations. The key stays on the server and is never returned in MCP results, resources, logs, or the widget.

The server can start without a key so its boundaries and UI can be developed safely. In that state:

- `/healthz` returns healthy because the process is running.
- `/readyz` returns a typed `provider_unavailable` response with HTTP 503.
- operation and MCP tool calls return a typed, retryable, text-bearing error without attempting a provider request.

Check both endpoints with:

```bash
curl http://localhost:8788/healthz
curl http://localhost:8788/readyz
```

Useful optional configuration includes `HOST`, `OPENAI_MODEL`, `ALLOWED_ORIGINS`, `REQUEST_TIMEOUT_MS`, `REQUEST_BYTES`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, and `CRISIS_REGION`. `HOST` accepts only `127.0.0.1` or `0.0.0.0`; `ALLOWED_ORIGINS` must be a comma-separated list of exact HTTP(S) origins, and wildcard origins are rejected.

### Optional Realtime voice

Voice is disabled by default. Enable the client with `VITE_ENABLE_REALTIME=true` at build time and the credential endpoint with `ENABLE_REALTIME=true` at runtime. The browser requests a short-lived credential from `/api/realtime/session`; `OPENAI_API_KEY` remains server-only. `OPENAI_REALTIME_MODEL` and `REALTIME_CREDENTIAL_TTL_SECONDS` tune the server-created input/transcription session. Provider audio is never played directly: the validated, locally persisted assistant transcript is spoken through the browser's speech synthesizer only while its originating session remains active. Text remains fully usable when voice is disabled, denied, interrupted, or unavailable.

## ChatGPT app / Apps SDK

The MCP server registers three read-only, retry-safe tools:

- `next_question` asks one concise, independent question.
- `challenge` is an explicit opt-in for a blind spot or credible counter-position.
- `draft_conclusion` is an explicit opt-in for a grounded working conclusion. It maps to the shared domain operation `conclusion`.

Every tool accepts `{ context: ThreadContext }`. The complete bounded thread context is supplied on every request and its `operation` must match the selected tool. Every successful result includes shared-schema `structuredContent` and a non-empty text fallback, so clients that do not render the widget still receive the useful result.

The MCP boundary is stateless:

- it stores no transcript, thread, session, or hidden cross-thread memory;
- repeated calls and separate server instances depend only on the context in that request;
- a fresh stateless MCP server and transport are created for every `/mcp` request;
- server logs contain metadata only, never prompts, full transcripts, or raw provider output.

The compact widget is served as `ui://widget/specular.html`. Standard `ui/notifications/tool-result` messages are its primary render path. `window.openai` support is additive and limited to initial tool input/output, calling the three tools, and presentation-only widget state. The only persisted widget preference is whether conclusion details are expanded; conversation content and notes are not stored in widget state.

### Connect from ChatGPT Developer Mode

1. Run the compiled server with `npm run chatgpt:server`.
2. Enable Developer Mode for apps/connectors in ChatGPT.
3. Expose the running server through a public HTTPS tunnel and add that `/mcp` endpoint.
4. Invoke `next_question`, or explicitly request a Challenge or working conclusion.

`http://localhost:8788/mcp` is for the local runtime and MCP Inspector only. ChatGPT Developer Mode requires a publicly reachable HTTPS `/mcp` endpoint with a valid certificate, so local development must use an HTTPS tunnel. Configure the tunnel or deployment's exact allowed origins; do not use `*`. Public distribution also requires the applicable ChatGPT app review and deployment requirements.

## Validation

Run all non-network build and contract gates with:

```bash
npm run typecheck
npm run lint
npm run test -- server/mcp.test.ts server/mcp-http.test.ts server/specular-widget.test.ts server/index.artifact.test.ts
npm run test -- --exclude server/http.test.ts
npm run build
npm run build:server
```

The MCP contract suite uses a real in-memory MCP client/server transport. It needs no API key, microphone, live model, socket listener, or persisted server state.

The complete offline production gate is:

```bash
npm run validate
npm run eval
npm run audit
npm run test:e2e
npm run lighthouse
npm run verify:production
docker build --target production -t specular:production .
```

`npm run eval:live` is an additional authorized model-quality smoke test. It reports an explicit skip when no `OPENAI_API_KEY` is present. The fixed corpus remains the non-billable hard-invariant release gate. Browser compatibility evidence and the physical-device release procedure are recorded in `tests/e2e/browser-compatibility.md`.

`npm run test:e2e` is a two-stage browser gate. It first runs the full 320/375/430px Chromium and WebKit functional matrix, including axe checks across all important UI states and 44px target checks, while excluding performance-marked tests. It then runs the interaction-attributed long-task trace once in Chromium at 375px with one worker and no retries. Lighthouse requires performance at least 90, accessibility 100, and a clean console. PWA installability remains a separate deterministic gate: the E2E suite exercises the installed service worker offline, and `verify:production` requires both the built manifest and service worker from the immutable server.

## Deployment

The production container serves both `dist/` and the stateless `dist-server/` artifact from port 8788, runs as the unprivileged `node` user, has no database or persistent volume, and exposes `/healthz` for container health. The three Compose profiles use separate non-secret environment files. See `deploy/README.md` for HTTPS termination, secret-store injection, digest promotion, health/readiness verification, provider-outage behavior, and rollback to the prior immutable digest.

## Static-only hosting

The PWA output in `dist/` can also be deployed to a static host after `npm run build`. Model, MCP, and Realtime endpoints still require the separate server artifact. Configure the PWA's API origin and exact server origin allowlist together; do not expose a long-lived API key to the static client.
