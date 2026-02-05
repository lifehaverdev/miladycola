#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(__filename, '..', '..');
const contractsDir = path.join(projectRoot, 'contracts');
const libDir = path.join(contractsDir, 'lib', 'forge-std');
const gitDir = path.join(contractsDir, '.git');

try {
  if (!fs.existsSync(gitDir)) {
    console.log('[setup] Initializing git repository for Foundry deps...');
    await run('git', ['init']);
  }
  if (!fs.existsSync(libDir)) {
    console.log('[setup] Installing forge-std...');
    await run('forge', ['install', 'foundry-rs/forge-std']);
  } else {
    console.log('[setup] forge-std already installed, skipping.');
  }
  await run('forge', ['build']);
  console.log('[setup] Contracts ready.');
} catch (error) {
  console.error('[setup] Failed:', error.message);
  process.exit(1);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: contractsDir, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`[setup] Command failed: ${cmd} ${args.join(' ')}`));
      }
    });
  });
}
