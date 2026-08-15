import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const policy = JSON.parse(await readFile(resolve(root, 'docs/design/ui-style-ratchet.json'), 'utf8'));
const categoryPatterns = {
  colors: /#[0-9a-f]{3,8}\b|(?:rgb|hsl|oklch|lab|color-mix)\(/giu,
  elevation: /box-shadow:\s*(?!var\()[^;]+;/giu,
  motion: /(?:animation|transition)(?:-[a-z-]+)?:\s*(?!var\()[^;]+;/giu,
  radius: /border-radius:\s*(?!var\()[^;]+;/giu,
  spacing: /(?:gap|inset|margin|padding|top|right|bottom|left|min-(?:width|height)|max-(?:width|height)|width|height):\s*(?!var\()[^;]*(?:\d(?:px|r?em|vh|vw|dvh|dvw|%|in)|clamp\(|min\(|max\(|calc\()[^;]*;/giu,
  zIndex: /z-index:\s*(?!var\()[^;]+;/giu,
};

const violations = [];
const cssFiles = (await readdir(resolve(root, 'src'), { recursive: true }))
  .filter((path) => path.endsWith('.css'))
  .map((path) => `src/${path}`)
  .sort();
for (const path of cssFiles) {
  if (policy.files[path] === undefined) violations.push(`${path}: CSS file is not registered`);
}
for (const [path, limits] of Object.entries(policy.files)) {
  const css = await readFile(resolve(root, path), 'utf8');
  for (const [category, pattern] of Object.entries(categoryPatterns)) {
    const actual = css.match(pattern)?.length ?? 0;
    const maximum = limits[category];
    if (typeof maximum !== 'number') {
      violations.push(`${path}: missing ${category} limit`);
    } else if (actual > maximum) {
      violations.push(`${path}: ${category} increased from ${String(maximum)} to ${String(actual)}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`UI style ratchet failed:\n${violations.join('\n')}`);
}

console.log(`Validated UI style debt did not increase across ${String(Object.keys(policy.files).length)} CSS file${Object.keys(policy.files).length === 1 ? '' : 's'}.`);
