#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const stationAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(stationAppRoot, '../../../..');

const rustTargets = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' };
const archs = process.argv.length > 2 ? process.argv.slice(2) : [process.arch];
for (const arch of archs) {
  if (!(arch in rustTargets)) {
    console.error(`unknown arch '${arch}', expected one of: ${Object.keys(rustTargets).join(', ')}`);
    process.exit(1);
  }
}

for (const arch of archs) {
  const args = ['build', '--release', '--package=station'];
  let builtDir = path.join(workspaceRoot, 'target', 'release');
  if (arch !== process.arch) {
    args.push(`--target=${rustTargets[arch]}`);
    builtDir = path.join(workspaceRoot, 'target', rustTargets[arch], 'release');
  }
  execFileSync('cargo', args, { cwd: workspaceRoot, stdio: 'inherit' });

  const stagedDir = path.join(stationAppRoot, 'build', 'station', arch);
  mkdirSync(stagedDir, { recursive: true });
  copyFileSync(path.join(builtDir, 'station'), path.join(stagedDir, 'station'));
  console.log(`Staged ${arch} station binary at ${path.relative(stationAppRoot, stagedDir)}/station`);
}
