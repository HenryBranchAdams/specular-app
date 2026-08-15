import { readFile } from 'node:fs/promises';

const inventoryPath = new URL('../docs/design/specular-component-library-inventory.json', import.meta.url);
const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));

const expectedEntryCount = 44;
const expectedTierCounts = {
  foundation: 7,
  core: 15,
  conditional: 15,
  excluded: 7,
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(inventory.catalog.entryCount === expectedEntryCount, 'Catalog entryCount must remain 44 until an intentional source refresh.');
assert(inventory.entries.length === expectedEntryCount, `Expected ${String(expectedEntryCount)} entries, received ${String(inventory.entries.length)}.`);

const ids = inventory.entries.map((entry) => entry.id);
const sources = inventory.entries.map((entry) => entry.source);
assert(new Set(ids).size === ids.length, 'Component inventory IDs must be unique.');
assert(new Set(sources).size === sources.length, 'Component inventory source URLs must be unique.');

const actualTierCounts = Object.fromEntries(
  Object.keys(expectedTierCounts).map((tier) => [tier, inventory.entries.filter((entry) => entry.tier === tier).length]),
);

for (const [tier, expected] of Object.entries(expectedTierCounts)) {
  assert(inventory.catalog.tierCounts[tier] === expected, `Declared ${tier} count must be ${String(expected)}.`);
  assert(actualTierCounts[tier] === expected, `Actual ${tier} count must be ${String(expected)}; received ${String(actualTierCounts[tier])}.`);
}

for (const entry of inventory.entries) {
  if (entry.tier === 'excluded') {
    assert(entry.specularEntry === null, `Excluded entry ${entry.id} must have a null specularEntry.`);
  } else {
    assert(typeof entry.specularEntry === 'string' && entry.specularEntry.length > 0, `Non-excluded entry ${entry.id} must name a Specular entry.`);
  }
}

console.log(`Component library inventory valid: ${String(expectedEntryCount)} unique entries (${Object.entries(actualTierCounts).map(([tier, count]) => `${tier}=${String(count)}`).join(', ')}).`);
