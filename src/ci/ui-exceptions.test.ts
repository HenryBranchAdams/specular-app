/// <reference types="node" />

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const fixtures: string[] = [];

interface ExceptionOverrides {
  expiresAt?: string;
  issue?: string;
}

function fixture(overrides: ExceptionOverrides = {}, referenced = true): string {
  const root = mkdtempSync(join(tmpdir(), 'specular-ui-exceptions-'));
  fixtures.push(root);
  mkdirSync(join(root, '.scratch/specular-ui-quality/issues'), { recursive: true });
  mkdirSync(join(root, 'docs/design'), { recursive: true });
  const issue = overrides.issue ?? '.scratch/specular-ui-quality/issues/temporary-copy.md';
  writeFileSync(join(root, issue), '# Temporary copy exception\n', 'utf8');
  writeFileSync(join(root, '.scratch/specular-ui-quality/exceptions.json'), JSON.stringify({
    $schema: '../../docs/validation/ui-quality-exceptions.schema.json',
    schemaVersion: 1,
    exceptions: [{
      id: 'temporary-signed-out-copy',
      owner: 'Specular owner',
      rationale: 'Copy requires one additional review cycle.',
      affectedStates: ['session-boundary:signed-out'],
      issue,
      createdAt: '2026-08-01',
      expiresAt: overrides.expiresAt ?? '2026-09-01',
      removalCondition: 'Remove after the signed-out copy receives owner approval.',
    }],
  }), 'utf8');
  writeFileSync(join(root, 'docs/design/ui-surface-manifest.json'), JSON.stringify({
    surfaces: [{
      id: 'session-boundary',
      requiredStates: ['signed-out'],
      exceptions: referenced ? ['temporary-signed-out-copy'] : [],
    }],
  }), 'utf8');
  writeFileSync(join(root, 'docs/design/ui-style-ratchet.json'), JSON.stringify({
    exceptions: [],
  }), 'utf8');
  return root;
}

function run(root: string): string {
  return execFileSync('node', [
    join(process.cwd(), 'scripts/validate-ui-exceptions.mjs'),
    '--root', root,
    '--today', '2026-08-15',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('UI exception governance', () => {
  it('accepts an owned, exact, tracked, unexpired, and referenced exception', () => {
    expect(run(fixture())).toContain('Validated 1 active UI exception');
  });

  it('rejects expired exceptions', () => {
    expect(() => run(fixture({ expiresAt: '2026-08-14' }))).toThrow(/expired/u);
  });

  it('rejects impossible calendar dates', () => {
    expect(() => run(fixture({ expiresAt: '2026-13-40' }))).toThrow(/valid calendar date/u);
  });

  it('rejects exceptions that no governed surface or style rule references', () => {
    expect(() => run(fixture({}, false))).toThrow(/not referenced/u);
  });

  it('rejects affected states that do not exist in the surface manifest', () => {
    const root = fixture();
    const registryPath = join(root, '.scratch/specular-ui-quality/exceptions.json');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
      exceptions: { affectedStates: string[] }[];
    };
    const firstException = registry.exceptions[0];
    if (firstException === undefined) throw new Error('Fixture exception is missing.');
    firstException.affectedStates = ['session-boundary:unknown'];
    writeFileSync(registryPath, JSON.stringify(registry), 'utf8');

    expect(() => run(root)).toThrow(/unknown affected state/u);
  });
});
