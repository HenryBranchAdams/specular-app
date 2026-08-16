/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');
const viteConfig = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
const styleRatchet = JSON.parse(
  readFileSync(join(process.cwd(), 'docs/design/ui-style-ratchet.json'), 'utf8'),
) as {
  schemaVersion: number;
  files: Record<string, Record<string, { maximum: number; allowedValues: string[] }>>;
};
const styleRatchetValidator = readFileSync(
  join(process.cwd(), 'scripts/validate-ui-style-ratchet.mjs'),
  'utf8',
);

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
    expect(styles).toMatch(/--color-surface-subtle:\s*#f2f3f4;/iu);
    expect(styles).toMatch(/--color-focus:\s*#0274b6;/iu);
    expect(viteConfig).toMatch(/background_color:\s*'#ffffff'/iu);
    expect(viteConfig).toMatch(/theme_color:\s*'#ffffff'/iu);
  });

  it('keeps editable boundaries, placeholders, native selection, and source links explicit', () => {
    expect(styles).toMatch(/--color-control-border:\s*var\(--color-text-muted\);/u);
    expect(styles).toMatch(/\.snapshot-title-field input\s*\{[\s\S]*?border:\s*1px solid var\(--color-control-border\)/u);
    expect(styles).toMatch(/\.calibration textarea\s*\{[\s\S]*?border:\s*1px solid var\(--color-control-border\)/u);
    expect(styles).toMatch(/input::placeholder,[\s\S]*?textarea::placeholder\s*\{[\s\S]*?color:\s*var\(--color-text-muted\);[\s\S]*?opacity:\s*1;/u);
    expect(styles).toMatch(/input\[type="checkbox"\],[\s\S]*?input\[type="radio"\]\s*\{[\s\S]*?accent-color:\s*var\(--color-focus\);/u);
    expect(styles).toMatch(/\.published-references a\s*\{[\s\S]*?color:\s*inherit;[\s\S]*?text-decoration:\s*underline;/u);
    expect(styles).toMatch(/\.reflection-sources a\s*\{[\s\S]*?color:\s*inherit;[\s\S]*?text-decoration:\s*underline;/u);
    expect(styles).toMatch(/\.library-drawer h2\s*\{[\s\S]*?font-family:\s*var\(--font-ui\);/u);
  });

  it('defines dark tokens, safe-area utilities, dynamic viewport sizing, and reduced motion', () => {
    expect(styles).toContain('[data-theme="dark"]');
    expect(styles).toContain('env(safe-area-inset-bottom');
    expect(styles).toContain('100dvh');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('isolates the printable snapshot from the interactive workspace layout', () => {
    expect(styles).toMatch(/@media print\s*\{[\s\S]*?\.specular-shell\s*>\s*:not\(\.snapshot-overlay\)\s*\{[\s\S]*?display:\s*none\s*!important;/u);
    expect(styles).toMatch(/@media print\s*\{[\s\S]*?\.snapshot-panel\s*>\s*header,[\s\S]*?\.snapshot-layout\s*>\s*aside\s*\{[\s\S]*?display:\s*none\s*!important;/u);
    expect(styles).toMatch(/@media print\s*\{[\s\S]*?\.snapshot-preview\s*\{[\s\S]*?position:\s*static;/u);
  });

  it('uses one focus-visible contract without a decorative glow', () => {
    expect(styles).toMatch(/:focus-visible[\s\S]*outline:\s*2px solid var\(--color-focus\)/u);
    expect(styles).toMatch(/outline-offset:\s*2px/u);
    expect(styles).not.toMatch(/focus-visible[^{}]*box-shadow:[^;]*(?:blur|color-mix)/u);
  });

  it('ratchets exact raw style values instead of allowing same-count substitutions', () => {
    expect(styleRatchet.schemaVersion).toBe(2);
    expect(styleRatchet.files['src/styles.css']).toBeDefined();

    for (const categories of Object.values(styleRatchet.files)) {
      for (const policy of Object.values(categories)) {
        expect(policy.maximum).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(policy.allowedValues)).toBe(true);
      }
    }

    expect(styleRatchetValidator).toContain('introducedValues');
    expect(styleRatchetValidator).toContain('--print-baseline');
  });
});
