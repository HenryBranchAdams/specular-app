import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const policy = JSON.parse(await readFile(resolve(root, 'docs/design/ui-style-ratchet.json'), 'utf8'));
const categoryPatterns = {
  colors: /#[0-9a-f]{3,8}\b|(?:rgb|hsl|oklch|lab|color-mix)\([^;{}]*\)/giu,
  elevation: /(?:^|[;{])\s*box-shadow:(?!\s*var\()[^;{}]+;/gimu,
  motion: /(?:^|[;{])\s*(?:animation|transition)(?:-[a-z-]+)?:(?!\s*var\()[^;{}]+;/gimu,
  radius: /(?:^|[;{])\s*border-radius:(?!\s*var\()[^;{}]+;/gimu,
  spacing: /(?:^|[;{])\s*(?:gap|inset|margin|padding|top|right|bottom|left|min-(?:width|height)|max-(?:width|height)|width|height):(?!\s*var\()[^;{}]*(?:\d(?:px|r?em|vh|vw|dvh|dvw|%|in)|clamp\(|min\(|max\(|calc\()[^;{}]*;/gimu,
  zIndex: /(?:^|[;{])\s*z-index:(?!\s*var\()[^;{}]+;/gimu,
};
const normalizedMatches = (css, pattern) => (css.match(pattern) ?? [])
  .map((value) => value.toLowerCase().replace(/^[;{]\s*/u, '').replace(/\s+/gu, ' ').trim());

const violations = [];
const cssFiles = (await readdir(resolve(root, 'src'), { recursive: true }))
  .filter((path) => path.endsWith('.css'))
  .map((path) => `src/${path}`)
  .sort();
if (process.argv.includes('--print-baseline')) {
  const files = {};
  for (const path of cssFiles) {
    const css = await readFile(resolve(root, path), 'utf8');
    files[path] = {};
    for (const [category, pattern] of Object.entries(categoryPatterns)) {
      const matches = normalizedMatches(css, pattern);
      files[path][category] = {
        maximum: matches.length,
        allowedValues: [...new Set(matches)].sort(),
      };
    }
  }
  console.log(JSON.stringify({ ...policy, schemaVersion: 2, files }, null, 2));
  process.exit(0);
}
if (policy.schemaVersion !== 2) violations.push('unsupported policy schema version');
for (const path of cssFiles) {
  if (policy.files[path] === undefined) violations.push(`${path}: CSS file is not registered`);
}
for (const [path, limits] of Object.entries(policy.files)) {
  const css = await readFile(resolve(root, path), 'utf8');
  for (const [category, pattern] of Object.entries(categoryPatterns)) {
    const matches = normalizedMatches(css, pattern);
    const categoryPolicy = limits[category];
    if (typeof categoryPolicy?.maximum !== 'number' || !Array.isArray(categoryPolicy.allowedValues)) {
      violations.push(`${path}: missing ${category} policy`);
      continue;
    }
    if (matches.length > categoryPolicy.maximum) {
      violations.push(`${path}: ${category} increased from ${String(categoryPolicy.maximum)} to ${String(matches.length)}`);
    }
    const allowedValues = new Set(categoryPolicy.allowedValues);
    const introducedValues = [...new Set(matches)].filter((value) => !allowedValues.has(value));
    if (introducedValues.length > 0) {
      violations.push(`${path}: ${category} introduced unapproved raw values: ${introducedValues.join(', ')}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`UI style ratchet failed:\n${violations.join('\n')}`);
}

console.log(`Validated UI style debt did not increase across ${String(Object.keys(policy.files).length)} CSS file${Object.keys(policy.files).length === 1 ? '' : 's'}.`);
