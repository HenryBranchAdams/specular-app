import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const manifest = await readJson('docs/design/ui-surface-manifest.json');
const inventory = await readJson(manifest.componentInventory);
const registry = await readJson('src/ui/surface-registry.json');

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
unique(manifestIds, 'surface IDs');
unique(registryIds, 'registry IDs');
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
}

const widget = manifest.legacyCompatibility.find(({ id }) => id === 'mcp-widget');
if (widget?.coverage !== 'excluded' || registryIds.includes('mcp-widget')) {
  fail('the legacy MCP widget boundary is missing or active.');
}

await ensureFiles([
  ...manifest.surfaces.map(({ productionEntry }) => productionEntry),
  ...Object.values(manifest.storyCatalog),
  ...Object.values(manifest.routeCatalog),
  ...registry.surfaces.map(({ module }) => module),
  widget.source,
], 'catalog');

console.log(`Validated ${String(manifest.surfaces.length)} active UI surfaces and ${String(manifest.legacyCompatibility.length)} legacy boundary.`);
