import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const manifest = await readJson('docs/design/ui-surface-manifest.json');
const inventory = await readJson(manifest.componentInventory);
const registry = await readJson('src/ui/surface-registry.json');
const surfaceAttributePattern = /data-ui-surface=["']([a-z0-9-]+)["']/gu;
const partAttributePattern = /data-ui-part=["']([a-z0-9-]+)["']/gu;
const candidateRootPattern = /<(?:main|dialog)\b[^>]*>|<(?:aside|article|section)\b(?=[^>]*\baria-label=)[^>]*>|<[a-z][a-z0-9-]*\b(?=[^>]*\brole=["'](?:dialog|alertdialog)["'])[^>]*>/gisu;

const fail = (message) => { throw new Error(`UI surface manifest: ${message}`); };
const unique = (values, label) => {
  if (new Set(values).size !== values.length) fail(`${label} contains duplicates.`);
};
const ensureFiles = async (paths, label) => {
  for (const path of new Set(paths)) {
    try { await access(resolve(root, path)); } catch { fail(`${label} references missing file ${path}.`); }
  }
};

if (manifest.schemaVersion !== 1) fail('unsupported schema version.');
if (manifest.dataPolicy !== 'synthetic-only-no-author-content') fail('stories must use synthetic-only data.');

const manifestIds = manifest.surfaces.map(({ id }) => id).sort();
const registryIds = registry.surfaces.map(({ id }) => id).sort();
const partIds = manifest.surfaceParts.map(({ id }) => id).sort();
unique(manifestIds, 'surface IDs');
unique(registryIds, 'registry IDs');
unique(partIds, 'surface-part IDs');
if (JSON.stringify(manifestIds) !== JSON.stringify(registryIds)) {
  fail(`manifest and registry differ (${manifestIds.join(', ')} vs ${registryIds.join(', ')}).`);
}

const inventoryIds = new Set(inventory.entries.map(({ id }) => id));
for (const surface of manifest.surfaces) {
  if (surface.storyIds.length + surface.routeScenarios.length === 0) fail(`${surface.id} has no review harness.`);
  for (const patternId of surface.patternIds) {
    if (!inventoryIds.has(patternId)) fail(`${surface.id} uses unknown inventory pattern ${patternId}.`);
  }
  for (const storyId of surface.storyIds) {
    if (manifest.storyCatalog[storyId] === undefined) fail(`${surface.id} uses unknown story ${storyId}.`);
  }
  for (const scenario of surface.routeScenarios) {
    if (manifest.routeCatalog[scenario] === undefined) fail(`${surface.id} uses unknown route scenario ${scenario}.`);
  }
  const productionSource = await readFile(resolve(root, surface.productionEntry), 'utf8');
  const ownedSurfaceIds = [...productionSource.matchAll(surfaceAttributePattern)].map((match) => match[1]);
  if (!ownedSurfaceIds.includes(surface.id)) {
    fail(`${surface.productionEntry} does not mark the ${surface.id} production root.`);
  }
}

for (const part of manifest.surfaceParts) {
  for (const ownerSurfaceId of part.ownerSurfaceIds) {
    if (!registryIds.includes(ownerSurfaceId)) fail(`${part.id} uses unknown owner surface ${ownerSurfaceId}.`);
  }
  const productionSource = await readFile(resolve(root, part.productionEntry), 'utf8');
  const ownedPartIds = [...productionSource.matchAll(partAttributePattern)].map((match) => match[1]);
  if (!ownedPartIds.includes(part.id)) {
    fail(`${part.productionEntry} does not mark the ${part.id} governed surface part.`);
  }
}

const productionTsxFiles = (await readdir(resolve(root, 'src'), { recursive: true }))
  .filter((path) => path.endsWith('.tsx') && !path.endsWith('.test.tsx') && !path.endsWith('.stories.tsx'))
  .map((path) => `src/${path}`)
  .sort();
const annotatedIds = [];
const annotatedPartIds = [];
const unclassifiedCandidates = [];
let candidateCount = 0;
for (const path of productionTsxFiles) {
  const source = await readFile(resolve(root, path), 'utf8');
  annotatedIds.push(...[...source.matchAll(surfaceAttributePattern)].map((match) => match[1]));
  annotatedPartIds.push(...[...source.matchAll(partAttributePattern)].map((match) => match[1]));
  for (const candidate of source.match(candidateRootPattern) ?? []) {
    candidateCount += 1;
    const surfaceMarkers = [...candidate.matchAll(surfaceAttributePattern)].map((match) => match[1]);
    const partMarkers = [...candidate.matchAll(partAttributePattern)].map((match) => match[1]);
    if (surfaceMarkers.length + partMarkers.length !== 1) {
      unclassifiedCandidates.push(`${path}: ${candidate.replace(/\s+/gu, ' ').slice(0, 140)}`);
    }
  }
}
if (unclassifiedCandidates.length > 0) {
  fail(`discoverable surface-like roots require exactly one data-ui-surface or data-ui-part marker:\n${unclassifiedCandidates.join('\n')}`);
}
const unknownAnnotatedIds = [...new Set(annotatedIds)].filter((id) => !registryIds.includes(id));
if (unknownAnnotatedIds.length > 0) {
  fail(`production roots use unregistered surface IDs: ${unknownAnnotatedIds.join(', ')}.`);
}
const unknownAnnotatedPartIds = [...new Set(annotatedPartIds)].filter((id) => !partIds.includes(id));
if (unknownAnnotatedPartIds.length > 0) {
  fail(`production roots use unregistered surface-part IDs: ${unknownAnnotatedPartIds.join(', ')}.`);
}

const widget = manifest.legacyCompatibility.find(({ id }) => id === 'mcp-widget');
if (widget?.coverage !== 'excluded' || registryIds.includes('mcp-widget')) {
  fail('the legacy MCP widget boundary is missing or active.');
}

await ensureFiles([
  ...manifest.surfaces.map(({ productionEntry }) => productionEntry),
  ...manifest.surfaceParts.map(({ productionEntry }) => productionEntry),
  ...Object.values(manifest.storyCatalog),
  ...Object.values(manifest.routeCatalog),
  ...registry.surfaces.map(({ module }) => module),
  widget.source,
], 'catalog');

console.log(`Validated ${String(manifest.surfaces.length)} active surfaces, ${String(manifest.surfaceParts.length)} governed parts, and ${String(candidateCount)} discoverable production roots.`);
