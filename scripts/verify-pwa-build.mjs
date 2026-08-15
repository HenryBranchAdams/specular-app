import { readFile } from 'node:fs/promises';

const serviceWorker = await readFile(new URL('../dist/client/sw.js', import.meta.url), 'utf8');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

for (const hostOwnedRoute of ['signin-with-chatgpt', 'signout-with-chatgpt', 'callback']) {
  invariant(serviceWorker.includes(hostOwnedRoute), `The service worker does not exclude ${hostOwnedRoute}.`);
}

invariant(!/["']use strict["'];self\.skipWaiting\(\)/u.test(serviceWorker), 'The service worker takes over open writing without consent.');
invariant(serviceWorker.includes('SKIP_WAITING') && serviceWorker.includes('addEventListener("message"'),
  'The service worker has no explicit activation message path.');

process.stdout.write(JSON.stringify({
  ok: true,
  checks: ['host-auth-route-exclusion', 'waiting-update', 'explicit-activation'],
}, null, 2) + '\n');
