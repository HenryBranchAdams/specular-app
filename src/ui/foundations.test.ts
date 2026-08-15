/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');
const viteConfig = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');

describe('Specular visual foundations', () => {
  it('loads only the approved Noto Sans and Playfair Display 400 faces', () => {
    expect(styles).toContain('@fontsource/noto-sans/400.css');
    expect(styles).toContain('@fontsource/playfair-display/400.css');
    expect(styles).not.toContain('@fontsource-variable/geist');
    expect(styles).toMatch(/--font-ui:\s*"Noto Sans"/u);
    expect(styles).toMatch(/--font-authored:\s*"Playfair Display"/u);
    expect(styles).toMatch(/font-synthesis:\s*none/u);
    expect(styles).not.toMatch(/font-weight:\s*(?:[5-9][0-9]{2}|bold|bolder)/u);
    expect(readFileSync(join(process.cwd(), 'src/components/ui/button.tsx'), 'utf8')).not.toContain('font-medium');
  });

  it('uses white neutral surfaces and reserves blue for focus or selected emphasis', () => {
    expect(styles).toMatch(/--color-canvas:\s*#fff(?:fff)?;/iu);
    expect(styles).toMatch(/--color-surface:\s*#fff(?:fff)?;/iu);
    expect(styles).toMatch(/--color-surface-subtle:\s*#f4f4f4;/iu);
    expect(styles).toMatch(/--color-focus:\s*#0274b6;/iu);
    expect(viteConfig).toMatch(/background_color:\s*'#ffffff'/iu);
    expect(viteConfig).toMatch(/theme_color:\s*'#ffffff'/iu);
  });

  it('defines dark tokens, safe-area utilities, dynamic viewport sizing, and reduced motion', () => {
    expect(styles).toContain('[data-theme="dark"]');
    expect(styles).toContain('env(safe-area-inset-bottom');
    expect(styles).toContain('100dvh');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('uses one focus-visible contract without a decorative glow', () => {
    expect(styles).toMatch(/:focus-visible[\s\S]*outline:\s*2px solid var\(--color-focus\)/u);
    expect(styles).toMatch(/outline-offset:\s*2px/u);
    expect(styles).not.toMatch(/focus-visible[^{}]*box-shadow:[^;]*(?:blur|color-mix)/u);
  });
});
