import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const issuePattern = /^\.scratch\/specular-ui-quality\/issues\/[a-z0-9-]+\.md$/u;
const exceptionKeys = [
  'affectedStates',
  'createdAt',
  'expiresAt',
  'id',
  'issue',
  'owner',
  'rationale',
  'removalCondition',
];

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing --${name} value.`);
  return value;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new Error(`${label} has unknown fields: ${extra.join(', ')}.`);
}

function nonEmptyString(value, label, minimum = 1) {
  if (typeof value !== 'string' || value.trim().length < minimum) {
    throw new Error(`${label} must contain at least ${String(minimum)} characters.`);
  }
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be a non-empty string array.`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} must contain unique values.`);
  return value;
}

function validDate(value) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

const root = resolve(argument('root', process.cwd()));
const today = argument('today', new Date().toISOString().slice(0, 10));
if (!validDate(today)) throw new Error('--today must be a valid calendar date in YYYY-MM-DD form.');

const registry = object(readJson(
  resolve(root, '.scratch/specular-ui-quality/exceptions.json'),
  'UI exception registry',
), 'UI exception registry');
exactKeys(registry, ['$schema', 'schemaVersion', 'exceptions'], 'UI exception registry');
if (registry.$schema !== '../../docs/validation/ui-quality-exceptions.schema.json') {
  throw new Error('UI exception registry must reference its versioned schema.');
}
if (registry.schemaVersion !== 1) throw new Error('Unsupported UI exception registry schema version.');
if (!Array.isArray(registry.exceptions)) throw new Error('UI exception registry exceptions must be an array.');

const manifest = object(readJson(
  resolve(root, 'docs/design/ui-surface-manifest.json'),
  'UI surface manifest',
), 'UI surface manifest');
if (!Array.isArray(manifest.surfaces)) throw new Error('UI surface manifest surfaces must be an array.');
const ratchet = object(readJson(
  resolve(root, 'docs/design/ui-style-ratchet.json'),
  'UI style ratchet',
), 'UI style ratchet');
if (!Array.isArray(ratchet.exceptions)) throw new Error('UI style ratchet exceptions must be an array.');

const surfaces = new Map();
const references = new Set();
for (const [index, rawSurface] of manifest.surfaces.entries()) {
  const surface = object(rawSurface, `surface ${String(index)}`);
  const id = nonEmptyString(surface.id, `surface ${String(index)} id`);
  const states = stringArray(surface.requiredStates, `surface ${id} requiredStates`);
  if (!Array.isArray(surface.exceptions) || surface.exceptions.some((item) => typeof item !== 'string')) {
    throw new Error(`surface ${id} exceptions must be a string array.`);
  }
  surfaces.set(id, new Set(states));
  for (const exceptionId of surface.exceptions) references.add(exceptionId);
}
for (const exceptionId of ratchet.exceptions) {
  if (typeof exceptionId !== 'string') throw new Error('UI style ratchet exceptions must contain IDs.');
  references.add(exceptionId);
}

const exceptions = new Map();
for (const [index, rawException] of registry.exceptions.entries()) {
  const exception = object(rawException, `exception ${String(index)}`);
  exactKeys(exception, exceptionKeys, `exception ${String(index)}`);
  const id = nonEmptyString(exception.id, `exception ${String(index)} id`);
  if (!idPattern.test(id)) throw new Error(`exception ${id} has an invalid ID.`);
  if (exceptions.has(id)) throw new Error(`Duplicate UI exception ID: ${id}.`);
  nonEmptyString(exception.owner, `exception ${id} owner`);
  nonEmptyString(exception.rationale, `exception ${id} rationale`, 10);
  nonEmptyString(exception.removalCondition, `exception ${id} removalCondition`, 10);
  const affectedStates = stringArray(exception.affectedStates, `exception ${id} affectedStates`);
  for (const affectedState of affectedStates) {
    const parts = affectedState.split(':');
    const surfaceId = parts[0];
    const state = parts[1];
    if (parts.length !== 2 || surfaceId === undefined || state === undefined
      || surfaces.get(surfaceId)?.has(state) !== true) {
      throw new Error(`exception ${id} names unknown affected state: ${affectedState}.`);
    }
  }
  const issue = nonEmptyString(exception.issue, `exception ${id} issue`);
  if (!issuePattern.test(issue)) throw new Error(`exception ${id} issue must reference the local UI issue tracker.`);
  const issuePath = resolve(root, issue);
  if (!issuePath.startsWith(`${root}${sep}`) || !existsSync(issuePath) || !statSync(issuePath).isFile()) {
    throw new Error(`exception ${id} issue does not exist: ${issue}.`);
  }
  const createdAt = nonEmptyString(exception.createdAt, `exception ${id} createdAt`);
  const expiresAt = nonEmptyString(exception.expiresAt, `exception ${id} expiresAt`);
  if (!validDate(createdAt) || !validDate(expiresAt)) {
    throw new Error(`exception ${id} dates must be valid calendar dates in YYYY-MM-DD form.`);
  }
  if (createdAt > expiresAt) throw new Error(`exception ${id} expires before it was created.`);
  if (expiresAt < today) throw new Error(`exception ${id} expired on ${expiresAt}.`);
  exceptions.set(id, exception);
}

for (const id of references) {
  if (!exceptions.has(id)) throw new Error(`UI quality policy references unknown exception: ${id}.`);
}
for (const id of exceptions.keys()) {
  if (!references.has(id)) throw new Error(`UI exception ${id} is not referenced by a governed surface or style rule.`);
}

console.log(`Validated ${String(exceptions.size)} active UI exception${exceptions.size === 1 ? '' : 's'}.`);
