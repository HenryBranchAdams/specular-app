import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'vite';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(directories.map(async (directory) => {
    await rm(directory, { force: true, recursive: true });
  }));
});

describe('compiled server artifact', () => {
  it('loads its widget from an isolated immutable artifact directory', async () => {
    const artifactDirectory = await mkdtemp(join(tmpdir(), 'specular-server-artifact-'));
    temporaryDirectories.push(artifactDirectory);
    await build({
      configFile: resolve(process.cwd(), 'vite.server.config.ts'),
      build: {
        emptyOutDir: true,
        outDir: artifactDirectory,
      },
    });

    const entryPath = join(artifactDirectory, 'index.js');
    const entrySource = await readFile(entryPath, 'utf8');
    const widgetReference = /new URL\(["']([^"']*specular-widget\.html)["'],\s*import\.meta\.url\)/u
      .exec(entrySource)?.[1];
    expect(widgetReference).toBeTypeOf('string');

    const widgetUrl = new URL(
      widgetReference ?? 'missing-widget-reference',
      pathToFileURL(entryPath),
    );
    const widgetHtml = await readFile(widgetUrl, 'utf8');

    expect(widgetReference).toBe('./specular-widget.html');
    expect(widgetHtml).toContain('data-specular-widget');
    expect(widgetUrl.pathname.startsWith(artifactDirectory)).toBe(true);
  });
});
