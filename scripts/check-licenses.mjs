#!/usr/bin/env node
// Fails when any installed npm dependency (prod or dev) uses a license outside the
// allowlist, unless it is listed as a reviewed exception with a recorded reason.
// See docs/security-and-rights.md (dependency license policy).
import { execSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Python-2.0',
  'Unlicense',
  // Data-only (caniuse-lite); attribution travels with the package.
  'CC-BY-4.0',
  // File-level weak copyleft; used unmodified as build/test tooling (lightningcss, axe-core).
  'MPL-2.0',
]);

/** name -> reason. Each exception must be reviewed; never add GPL/AGPL code to this repository. */
const REVIEWED_EXCEPTIONS = new Map([
  [
    '@img/sharp-libvips-linux-x64',
    'LGPL-3.0-or-later libvips binary, dynamically loaded by sharp (optional Next.js image dependency); unmodified.',
  ],
  [
    '@img/sharp-libvips-linuxmusl-x64',
    'LGPL-3.0-or-later libvips binary (musl build) for the Alpine image; dynamically loaded, unmodified.',
  ],
  [
    '@img/sharp-libvips-linux-arm64',
    'LGPL-3.0-or-later libvips binary (arm64); dynamically loaded, unmodified.',
  ],
  [
    '@img/sharp-libvips-linuxmusl-arm64',
    'LGPL-3.0-or-later libvips binary (musl arm64); dynamically loaded, unmodified.',
  ],
  [
    '@img/sharp-libvips-darwin-arm64',
    'LGPL-3.0-or-later libvips binary (macOS); dynamically loaded, unmodified.',
  ],
  [
    '@img/sharp-win32-x64',
    'Apache-2.0 sharp binding bundled with the LGPL-3.0-or-later libvips DLLs (Windows); dynamically loaded, unmodified.',
  ],
]);

// Through a shell so Windows resolves the pnpm.cmd shim (Node will not spawn .cmd files directly).
const raw = execSync('pnpm licenses list --json', {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
/** @type {Record<string, { name: string; versions: string[] }[]>} */
const byLicense = JSON.parse(raw);

const violations = [];
let count = 0;
for (const [license, packages] of Object.entries(byLicense)) {
  for (const pkg of packages) {
    count += 1;
    if (ALLOWED.has(license) || REVIEWED_EXCEPTIONS.has(pkg.name)) {
      continue;
    }
    violations.push(`${pkg.name}@${pkg.versions.join(',')}: ${license}`);
  }
}

if (violations.length > 0) {
  console.error('Dependencies with licenses that need review:');
  for (const line of violations) {
    console.error(`  - ${line}`);
  }
  process.exit(1);
}
console.log(`License check passed for ${count} packages.`);
