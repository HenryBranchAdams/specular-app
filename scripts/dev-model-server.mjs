import { spawnSync } from 'node:child_process';

const build = spawnSync('npm', ['run', 'build:server'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

if (build.error) {
  throw build.error;
}
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

await import('../dist-server/index.js');
