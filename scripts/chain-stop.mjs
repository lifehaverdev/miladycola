#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(__filename, '..', '..');
const pidFile = path.join(projectRoot, '.anvil.pid');

if (!fs.existsSync(pidFile)) {
  console.log('[chain] No PID file found. Is Anvil running?');
  process.exit(0);
}

const pid = Number(fs.readFileSync(pidFile, 'utf8'));
if (!pid || !Number.isFinite(pid)) {
  console.log('[chain] PID file is invalid. Removing it.');
  fs.unlinkSync(pidFile);
  process.exit(0);
}

try {
  process.kill(pid, 'SIGINT');
  console.log(`[chain] Sent SIGINT to Anvil (pid ${pid}).`);
} catch (error) {
  if (error.code === 'ESRCH') {
    console.log('[chain] Anvil process already stopped.');
  } else {
    console.error('[chain] Failed to send SIGINT:', error.message);
  }
}

fs.unlinkSync(pidFile);
console.log('[chain] PID file removed.');
