/// <reference types="node" />

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('versioned UI release evidence', () => {
  it('records the surface manifest, immutable baselines, viewports, accessibility, exceptions, and owner review', () => {
    const schema = JSON.parse(readFileSync(
      join(process.cwd(), 'docs/validation/release-evidence.schema.json'),
      'utf8',
    )) as { properties?: { schemaVersion?: { const?: number }; uiQuality?: unknown }; required?: string[] };
    const writer = readFileSync(join(process.cwd(), 'scripts/write-release-evidence.mjs'), 'utf8');

    expect(schema.properties?.schemaVersion?.const).toBe(2);
    expect(schema.required).toContain('uiQuality');
    for (const field of ['surfaceManifest', 'baselineCommit', 'baselines', 'viewports', 'accessibilityPolicy', 'exceptions', 'reviewerEvidence']) {
      expect(writer).toContain(field);
    }
    for (const baseline of [
      'authoring-desktop',
      'entry-mobile',
      'library-mobile',
      'offline-ready-mobile',
      'snapshot-mobile',
      'published-mobile',
      'update-failure-mobile',
      'update-preparing-mobile',
      'update-ready-mobile',
    ]) {
      expect(existsSync(join(process.cwd(), `tests/visual/__screenshots__/${baseline}.png`))).toBe(true);
    }
    expect(readFileSync(join(process.cwd(), 'docs/validation/ui-baseline-review.md'), 'utf8')).toContain('Status: owner-approved');
  });
});
