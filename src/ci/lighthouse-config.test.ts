/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface LighthouseConfig {
  ci?: {
    collect?: {
      startServerCommand?: string;
      startServerReadyPattern?: string;
      settings?: {
        chromeFlags?: string;
      };
      url?: string[];
    };
  };
}

describe('Lighthouse CI runner contract', () => {
  it('keeps the explicit no-sandbox launch flag required by the hosted Linux runner', () => {
    const config = JSON.parse(
      readFileSync(join(process.cwd(), 'lighthouserc.json'), 'utf8'),
    ) as LighthouseConfig;
    const flags = config.ci?.collect?.settings?.chromeFlags?.split(/\s+/u) ?? [];

    expect(flags).toContain('--no-sandbox');
  });

  it('serves the emitted browser build instead of the server bundle root', () => {
    const config = JSON.parse(
      readFileSync(join(process.cwd(), 'lighthouserc.json'), 'utf8'),
    ) as LighthouseConfig;

    const serverSource = readFileSync(
      join(process.cwd(), 'scripts/lighthouse-server.mjs'),
      'utf8',
    );

    expect(config.ci?.collect).toMatchObject({
      startServerCommand: 'node scripts/lighthouse-server.mjs',
      startServerReadyPattern: 'Lighthouse fixture ready',
      url: ['http://127.0.0.1:4173/'],
    });
    expect(serverSource).toContain("new URL('../dist/client/'");
    expect(serverSource).toContain("url.pathname === '/api/session'");
    expect(serverSource).toContain("gzipSync");
    expect(serverSource).toContain("'content-encoding': 'gzip'");
  });
});
