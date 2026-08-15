import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const clientRoot = resolve(fileURLToPath(new URL('../dist/client/', import.meta.url)));
const host = '127.0.0.1';
const port = Number(process.env.LIGHTHOUSE_PORT ?? '4173');
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);
const compressibleExtensions = new Set(['.css', '.html', '.js', '.json', '.svg', '.webmanifest']);

function respond(response, status, body, headers = {}) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': String(body.byteLength),
    ...headers,
  });
  response.end(body);
}

async function staticFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const candidate = resolve(clientRoot, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (candidate !== clientRoot && !candidate.startsWith(`${clientRoot}${sep}`)) return null;
  try {
    if (!(await stat(candidate)).isFile()) return null;
    return candidate;
  } catch {
    return null;
  }
}

const server = createServer((request, response) => {
  void (async () => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      respond(response, 405, Buffer.from('Method not allowed.'));
      return;
    }
    const url = new URL(request.url ?? '/', `http://${host}:${String(port)}`);
    if (url.pathname === '/api/session') {
      const body = Buffer.from(JSON.stringify({
        authenticated: false,
        signInUrl: '/signin-with-chatgpt?return_to=%2F',
      }));
      respond(response, 200, request.method === 'HEAD' ? Buffer.alloc(0) : body, {
        'content-type': 'application/json; charset=utf-8',
      });
      return;
    }
    const file = await staticFile(url.pathname);
    if (file === null) {
      respond(response, 404, Buffer.from('Not found.'));
      return;
    }
    const body = await readFile(file);
    const extension = extname(file);
    const acceptsGzip = request.headers['accept-encoding']?.includes('gzip') === true;
    const shouldCompress = acceptsGzip && compressibleExtensions.has(extension);
    const representation = shouldCompress ? gzipSync(body) : body;
    respond(response, 200, request.method === 'HEAD' ? Buffer.alloc(0) : representation, {
      'content-type': mimeTypes.get(extension) ?? 'application/octet-stream',
      ...(shouldCompress ? { 'content-encoding': 'gzip' } : {}),
    });
  })().catch(() => {
    if (!response.headersSent) respond(response, 500, Buffer.from('Fixture server failed.'));
    else response.destroy();
  });
});

server.listen(port, host, () => {
  console.log(`Lighthouse fixture ready on http://${host}:${String(port)}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(() => { process.exit(0); }); });
}
