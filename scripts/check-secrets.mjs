#!/usr/bin/env node
/**
 * Runs the same gitleaks scan as CI (full git history, repo .gitleaks.toml) through Docker.
 * GITLEAKS_IMAGE overrides the image, e.g. mirror.gcr.io/zricethezav/gitleaks:v8.28.0 when
 * Docker Hub rate-limits pulls. Exit code: 0 clean, 1 leaks found, 2 Docker unavailable.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const image = process.env.GITLEAKS_IMAGE ?? 'zricethezav/gitleaks:v8.28.0';
const docker = spawnSync('docker', ['info'], { stdio: 'ignore' });
if (docker.status !== 0) {
  console.error('secrets:check needs a running Docker daemon (CI runs this scan on every push).');
  process.exit(2);
}
const uid =
  typeof process.getuid === 'function' ? `${process.getuid()}:${process.getgid?.() ?? 0}` : null;
const args = ['run', '--rm', ...(uid ? ['-u', uid] : []), '-v', `${process.cwd()}:/repo`, image];
const scan = spawnSync(
  'docker',
  [...args, 'git', '/repo', '--redact', '--no-banner', '--exit-code', '1'],
  {
    stdio: 'inherit',
  },
);
process.exit(scan.status ?? 1);
