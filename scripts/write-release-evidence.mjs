import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const allowedEvidenceLevels = new Set([
  'unit',
  'synthetic-ui',
  'worker-d1',
  'integrated-browser',
  'pwa-chromium',
  'webkit-simulation',
  'live-sites',
  'physical-ios',
]);

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing --${name} value.`);
  return value;
}

function commaList(name) {
  const values = argument(name).split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || new Set(values).size !== values.length) throw new Error(`--${name} must contain unique values.`);
  return values;
}

const lane = argument('lane');
const output = resolve(argument('output'));
const suites = commaList('suites');
const evidenceLevels = commaList('evidence-levels');
for (const level of evidenceLevels) {
  if (!allowedEvidenceLevels.has(level)) throw new Error(`Unknown evidence level: ${level}`);
}
const commitSha = (process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })).trim();
if (!/^[0-9a-f]{40}$/u.test(commitSha)) throw new Error('Release evidence requires an exact Git commit SHA.');

const manifest = {
  schemaVersion: 1,
  commitSha,
  generatedAt: new Date().toISOString(),
  lane,
  status: 'passed',
  suites,
  evidenceLevels,
  dataPolicy: 'synthetic-only-no-author-content',
  liveQualification: {
    completed: false,
    checklist: 'docs/validation/multitenancy-live-checklist.md',
  },
  deferredDecisionRegister: 'docs/validation/deferred-test-infrastructure.md',
  excludedPlatforms: ['android-chrome'],
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${output}`);
