import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
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
const baselineCommit = (process.env.UI_BASELINE_COMMIT ?? commitSha).trim();
if (!/^[0-9a-f]{40}$/u.test(baselineCommit)) throw new Error('UI baseline evidence requires an exact Git commit SHA.');
const baselineFiles = [
  'tests/visual/__screenshots__/authoring-desktop.png',
  'tests/visual/__screenshots__/entry-mobile.png',
  'tests/visual/__screenshots__/library-mobile.png',
  'tests/visual/__screenshots__/offline-ready-mobile.png',
  'tests/visual/__screenshots__/published-mobile.png',
  'tests/visual/__screenshots__/update-failure-mobile.png',
  'tests/visual/__screenshots__/update-preparing-mobile.png',
  'tests/visual/__screenshots__/update-ready-mobile.png',
  'tests/visual/__screenshots__/snapshot-mobile.png',
];
for (const path of baselineFiles) await access(resolve(path));
const exceptionRegistry = JSON.parse(await readFile(resolve('.scratch/specular-ui-quality/exceptions.json'), 'utf8'));
if (!Array.isArray(exceptionRegistry.exceptions)) throw new Error('UI exception evidence requires a valid registry.');

const manifest = {
  schemaVersion: 2,
  commitSha,
  generatedAt: new Date().toISOString(),
  lane,
  status: 'passed',
  suites,
  evidenceLevels,
  dataPolicy: 'synthetic-only-no-author-content',
  uiQuality: {
    surfaceManifest: 'docs/design/ui-surface-manifest.json',
    baselineCommit,
    baselines: baselineFiles,
    viewports: [
      { name: 'chromium-desktop', width: 1440, height: 1000, blocking: true },
      { name: 'chromium-mobile', width: 390, height: 844, blocking: true },
      { name: 'webkit-mobile-diagnostic', width: 390, height: 844, blocking: false },
    ],
    accessibilityPolicy: {
      standard: 'WCAG 2.2 AA',
      tags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
      blockingImpacts: ['serious', 'critical'],
    },
    exceptions: {
      registry: '.scratch/specular-ui-quality/exceptions.json',
      activeCount: exceptionRegistry.exceptions.length,
    },
    reviewerEvidence: {
      status: 'owner-approved',
      reference: 'docs/validation/ui-baseline-review.md',
    },
  },
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
