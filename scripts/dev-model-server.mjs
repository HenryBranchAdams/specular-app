import { spawn, spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const build = spawnSync(npmCommand, ['run', 'build:server'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

if (build.error) {
  throw build.error;
}
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const server = spawn(process.execPath, ['--watch', 'dist-server/index.js'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});
const builder = spawn(npmCommand, ['run', 'build:server', '--', '--watch'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});
const children = [server, builder];
let stopping = false;

function stop(signal, exitCode) {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
  process.exitCode = exitCode;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { stop(signal, 0); });
}

for (const child of children) {
  child.once('error', (error) => {
    console.error(error);
    stop('SIGTERM', 1);
  });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(`Development process stopped (${signal ?? String(code)}).`);
      stop('SIGTERM', code ?? 1);
    }
  });
}
