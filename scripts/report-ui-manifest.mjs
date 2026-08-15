import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const output = resolve('artifacts/ui-quality/manifest.json');
const result = spawnSync(process.execPath, ['scripts/validate-ui-surface-manifest.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
const status = result.status === 0 ? 'passed' : 'failed';
const report = {
  schemaVersion: 1,
  status,
  manifest: 'docs/design/ui-surface-manifest.json',
  stdout: result.stdout.trim(),
  stderr: result.stderr.trim(),
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (result.stdout.length > 0) process.stdout.write(result.stdout);
if (result.stderr.length > 0) process.stderr.write(result.stderr);
if (result.status !== 0) process.exitCode = result.status ?? 1;
