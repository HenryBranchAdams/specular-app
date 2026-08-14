import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 18_788;
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;
const ALLOWED_ORIGIN = 'https://preview.specular.example';
const SENTINEL = 'SPECULAR_PRIVATE_SENTINEL_7f419b';
const logs = [];

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(path, init = {}) {
  return await fetch(`${BASE_URL}${path}`, init);
}

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Production server exited with ${String(child.exitCode)}.\n${logs.join('')}`);
    }
    try {
      const response = await request('/healthz');
      if (response.status === 200) return;
    } catch {
      // The immutable artifact is still starting.
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for the immutable server artifact.');
}

const understanding = {
  claims: [], observations: [], stakeholders: [], contexts: [], distinctions: [],
  tensions: [], exploredBlindSpots: [], unexploredBlindSpots: [],
};

function operationContext(operation) {
  return {
    thread: { id: 'verify-thread' },
    turns: [{
      id: 'verify-turn', ownerScope: 'local', threadId: 'verify-thread', role: 'user',
      content: SENTINEL, modality: 'text', createdAt: 1, position: 0, deliveryState: 'accepted',
    }],
    understanding,
    operation,
  };
}

await Promise.all([
  access(new URL('../dist/client/index.html', import.meta.url)),
  access(new URL('../dist-server/index.js', import.meta.url)),
  access(new URL('../dist-server/specular-widget.html', import.meta.url)),
]);

const child = spawn(process.execPath, ['dist-server/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    REQUEST_BYTES: '4096',
    ENABLE_REALTIME: 'false',
    OPENAI_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
child.stderr.on('data', (chunk) => logs.push(chunk.toString()));

try {
  await waitForHealth(child);

  const health = await request('/healthz');
  invariant(health.status === 200, 'Health endpoint did not report process health.');
  invariant(health.headers.get('content-security-policy')?.includes("default-src 'none'") === true,
    'API CSP is missing or permissive.');
  invariant(health.headers.get('x-content-type-options') === 'nosniff', 'nosniff header is missing.');
  invariant(health.headers.get('referrer-policy') === 'no-referrer', 'Referrer-Policy is missing.');
  invariant(health.headers.get('permissions-policy')?.includes('camera=()') === true,
    'Permissions-Policy is missing.');

  const readiness = await request('/readyz');
  const readinessBody = await readiness.json();
  invariant(readiness.status === 503 && readinessBody?.error?.code === 'provider_unavailable',
    'Readiness did not expose a typed provider-unavailable state without a key.');

  const app = await request('/');
  const appHtml = await app.text();
  invariant(app.status === 200 && appHtml.includes('<div id="root"></div>'),
    'The PWA is unavailable while the provider is unavailable.');
  invariant(app.headers.get('content-security-policy')?.includes("default-src 'self'") === true,
    'The PWA CSP is missing.');
  const manifestMatch = appHtml.match(/href="([^"]+\.webmanifest)"/u);
  invariant(manifestMatch !== null, 'The built app does not reference an installable manifest.');
  const manifest = await request(`/${manifestMatch[1].replace(/^\//u, '')}`);
  invariant(manifest.status === 200, 'The immutable server does not serve the PWA manifest.');
  const serviceWorker = await request('/sw.js');
  invariant(serviceWorker.status === 200, 'The immutable server does not serve its service worker.');
  const staticAssetPaths = [...appHtml.matchAll(/(?:href|src)="([^"]+\.(?:css|js))"/gu)]
    .map((match) => match[1]);
  invariant(staticAssetPaths.length >= 2, 'The built app does not reference its static assets.');
  const staticAssets = await Promise.all(staticAssetPaths.map(async (path) => (
    await request(path, { headers: { origin: BASE_URL } })
  )));
  invariant(staticAssets.every((asset) => asset.status === 200),
    'The immutable server blocks its own static assets through the API origin policy.');

  const rejectedOrigin = await request('/api/operations/next-question', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
    body: '{}',
  });
  invariant(rejectedOrigin.status === 403, 'A disallowed origin was not rejected.');

  const oversized = await request('/api/operations/next-question', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
    body: JSON.stringify({ padding: 'x'.repeat(5_000) }),
  });
  invariant(oversized.status === 413, 'An oversized request was not rejected.');

  const unavailable = await request('/api/operations/next-question', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
    body: JSON.stringify({ context: operationContext('next_question') }),
  });
  const unavailableBody = await unavailable.json();
  invariant(unavailable.status === 503 && unavailableBody?.error?.code === 'provider_unavailable',
    'Operation failure without a provider was not typed and recoverable.');

  const mcp = await request('/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      origin: ALLOWED_ORIGIN,
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'next_question', arguments: { context: operationContext('next_question') } },
    }),
  });
  const mcpBody = await mcp.json();
  const textFallback = mcpBody?.result?.content?.find?.((item) => item?.type === 'text')?.text;
  invariant(mcp.status === 200 && typeof textFallback === 'string' && textFallback.length > 0,
    `MCP did not preserve a non-empty text compatibility fallback: ${String(mcp.status)} ${JSON.stringify(mcpBody)}`);

  await delay(100);
  invariant(!logs.join('').includes(SENTINEL), 'Server logs leaked seeded user-authored content.');
  invariant(!(await readFile(new URL('../dist/client/index.html', import.meta.url), 'utf8')).includes(SENTINEL),
    'A private sentinel leaked into the immutable static artifact.');

  process.stdout.write(JSON.stringify({
    ok: true,
    checks: [
      'immutable-artifacts', 'static-assets', 'health-readiness', 'secure-headers', 'origin-rejection',
      'request-size', 'typed-provider-failure', 'pwa-degradation', 'mcp-text-fallback',
      'privacy-log-sentinel',
    ],
  }, null, 2) + '\n');
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2_000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
