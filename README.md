# Specular

A shareable web prototype and ChatGPT Apps SDK/MCP implementation for Specular: a general thinking tool that helps people sharpen rough thoughts, refine ideas, clarify assumptions, and turn vague intuitions into better questions.

## Standalone web app

```bash
npm install
npm run dev
```

Open the printed local URL.

## ChatGPT app / Apps SDK implementation

This repo includes a no-auth MCP server for ChatGPT Apps SDK Developer Mode.

### Run the MCP server

```bash
npm install
npm run chatgpt:server
```

The server listens at:

```text
http://localhost:8787/mcp
```

### Connect from ChatGPT Developer Mode

1. Open ChatGPT.
2. Enable Developer Mode for apps/connectors.
3. Add a local MCP server with this URL:

```text
http://localhost:8787/mcp
```

4. Ask ChatGPT something like:

```text
Use Specular to sharpen this thought: I think this argument is right, but I cannot tell which assumption is carrying it.
```

The app exposes two tools:

- `sharpen_thought`: data-first tool. Inputs `{ thought, mode }`, where mode is `clarify`, `invert`, or `distill`.
- `open_specular`: render tool. Opens the embedded Specular widget in ChatGPT using `ui://widget/specular.html`.

The widget is in `public/specular-widget.html` and uses the ChatGPT `window.openai` bridge to:

- read tool input/output
- persist a local note with `setWidgetState`
- call `sharpen_thought` directly when switching modes

## Share publicly

Standalone web app:

- Vercel: import this folder as a project, build command `npm run build`, output `dist`.
- Netlify: drag the `dist/` folder after running `npm run build`.
- Any static host: upload `dist/`.

ChatGPT app:

- Host the MCP server on a public HTTPS URL.
- Configure ChatGPT Developer Mode to point at `https://your-domain.example/mcp`.
- Keep `securitySchemes: [{ type: "noauth" }]` unless you add accounts/auth.
- Submit for OpenAI review when public app submissions are available/appropriate.

This version is intentionally credential-free: no login, no backend persistence, no saved server data.
