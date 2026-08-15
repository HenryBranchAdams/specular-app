/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  scripts?: Record<string, string>;
}

describe('UI quality workflow contract', () => {
  it('exposes a headless Storybook interaction and accessibility suite', () => {
    const packageManifest = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as PackageManifest;
    const config = readFileSync(
      join(process.cwd(), 'vitest.storybook.config.ts'),
      'utf8',
    );

    expect(packageManifest.scripts?.['test:ui']).toBe(
      'STORYBOOK=true STORYBOOK_DISABLE_TELEMETRY=1 vitest run --config vitest.storybook.config.ts',
    );
    expect(config).toContain("storybookTest({ configDir:");
    expect(config).toContain("instances: [{ browser: 'chromium' }]");
    expect(config).toContain("json: 'artifacts/ui-quality/storybook.json'");
  });

  it('runs style, inventory, manifest, and story gates in hosted CI', () => {
    const workflow = readFileSync(
      join(process.cwd(), '.github/workflows/ci.yml'),
      'utf8',
    );

    expect(workflow).toContain('- run: npm run lint:styles');
    expect(workflow).toContain('- run: npm run validate:ui-inventory');
    expect(workflow).toContain('- run: npm run ui:manifest:check');
    expect(workflow).toContain('- run: npm run test:ui');
    expect(workflow).toContain('artifacts/ui-quality/');
  });
});
