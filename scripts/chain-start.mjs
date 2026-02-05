#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fsSync from 'node:fs';
import { deployColasseum } from './deploy.mjs';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(__filename, '..', '..');
const pidFile = path.join(projectRoot, '.anvil.pid');
const cacheDir = path.join(projectRoot, '.anvil-cache');

ensureDir(cacheDir);

loadEnvFiles();

const cliArgs = parseArgs();
let rpcUrl = cliArgs['rpc-url'] || process.env.RPC_URL || 'http://127.0.0.1:8545';
let port = cliArgs.port || (() => {
  try {
    return new URL(rpcUrl).port || '8545';
  } catch {
    return '8545';
  }
})();
if (cliArgs.port && !cliArgs['rpc-url']) {
  rpcUrl = `http://127.0.0.1:${cliArgs.port}`;
}
process.env.RPC_URL = rpcUrl;

let forkUrl = cliArgs['fork-url'] || process.env.MAINNET_RPC_URL || process.env.FORK_RPC_URL;
const noForkFlag = cliArgs['no-fork'] || forkUrl === 'none' || forkUrl === 'local';
if (noForkFlag) {
  forkUrl = null;
} else if (!forkUrl) {
  console.error('[chain] ERROR: MAINNET_RPC_URL environment variable is required for forking.');
  console.error('[chain] Please set it in .env or .env.local, or export it:');
  console.error('[chain]   export MAINNET_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"');
  console.error('[chain] Or use --no-fork to run without mainnet forking.');
  process.exit(1);
}
const chainId = cliArgs['chain-id'] || process.env.CHAIN_ID || '1337';
const allowForkFallback = !cliArgs['no-fallback'] && process.env.ANVIL_DISABLE_FALLBACK !== '1';
const preferFork = Boolean(forkUrl);

const runInBackground = cliArgs.background || cliArgs.bg;

checkExistingInstance();

console.log(`[chain] RPC URL ${rpcUrl}`);
let chainProcess = null;
let runtimeLabel = 'anvil';
const startupErrors = [];

try {
  const result = await startAnvilInstance({ fork: preferFork });
  chainProcess = result.process;
  runtimeLabel = result.runtime;
} catch (error) {
  startupErrors.push(error);
  if (preferFork && allowForkFallback) {
    console.warn('[chain] Failed to start forked anvil:', error.message);
    console.warn('[chain] Retrying without --fork-url (set ANVIL_DISABLE_FALLBACK=1 to disable this behavior).');
    try {
      const result = await startAnvilInstance({ fork: false });
      chainProcess = result.process;
      runtimeLabel = result.runtime;
    } catch (fallbackError) {
      startupErrors.push(fallbackError);
    }
  }
}

if (!chainProcess) {
  const finalError = startupErrors.pop() || new Error('Unable to start local JSON-RPC chain');
  console.error('[chain] Failed to boot a local chain:', finalError.message);
  process.exitCode = 1;
  throw finalError;
}

if (runInBackground) {
  chainProcess.unref();
} else {
  const shutdown = () => {
    console.log(`\n[chain] Shutting down ${runtimeLabel}...`);
    return killProcess(chainProcess).finally(() => process.exit());
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Force chain ID — Anvil in fork mode may ignore --chain-id
try {
  const setChainRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'anvil_setChainId', params: [parseInt(chainId, 10)], id: 1 }),
  });
  const setChainJson = await setChainRes.json();
  if (setChainJson.error) {
    console.warn('[chain] anvil_setChainId failed:', setChainJson.error.message);
  } else {
    console.log(`[chain] Forced chain ID to ${chainId}`);
  }
} catch (err) {
  console.warn('[chain] Could not set chain ID:', err.message);
}

await deployColasseum({ silent: cliArgs.silent, rpcUrl });
console.log(`[chain] ${runtimeLabel.charAt(0).toUpperCase() + runtimeLabel.slice(1)} is running.`);

if (runInBackground) {
  console.log('[chain] Background mode enabled. Run "npm run chain:stop" to shut it down.');
  process.exit(0);
}

console.log('Press Ctrl+C to stop.');
await new Promise((resolve) => chainProcess.on('exit', resolve));
removePidFile();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRpc(url, attempts = 20) {
  const body = JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 });
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
      });
      if (res.ok) {
        return true;
      }
    } catch (error) {
      // ignore
    }
    await sleep(1500);
  }
  const error = new Error(`Timed out waiting for RPC at ${url}`);
  error.code = 'RPC_TIMEOUT';
  throw error;
}

function buildAnvilArgs({ fork }) {
  const args = [
    '--chain-id', chainId,
    '--port', port,
    '--block-time', process.env.ANVIL_BLOCK_TIME || '1',
    '--cache-path', cacheDir
  ];
  if (fork) {
    if (!forkUrl) {
      throw new Error('Fork URL requested but not provided');
    }
    args.unshift(forkUrl);
    args.unshift('--fork-url');
  }
  return args;
}

async function startAnvilInstance({ fork }) {
  const args = buildAnvilArgs({ fork });
  const spawnOptions = runInBackground
    ? { stdio: 'ignore', detached: true }
    : { stdio: 'inherit' };

  console.log(`[chain] Spawning anvil${fork ? ' (fork)' : ''} with args:`, args.join(' '));
  let child;
  try {
    child = spawn('anvil', args, spawnOptions);
  } catch (error) {
    throw new Error(`Unable to spawn anvil: ${error.message}`);
  }
  writePid(child.pid);

  try {
    await waitForRpcOrExit(child, rpcUrl, 'anvil');
    return { process: child, runtime: 'anvil' };
  } catch (error) {
    await killProcess(child);
    throw error;
  }
}

function waitForRpcOrExit(childProcess, url, runtime = 'anvil') {
  return new Promise((resolve, reject) => {
    const onExit = (code, signal) => {
      cleanup();
      const reason = typeof code === 'number' ? `code ${code}` : `signal ${signal || 'unknown'}`;
      reject(new Error(`${runtime} exited before RPC became ready (${reason})`));
    };

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      childProcess.removeListener('exit', onExit);
    };

    childProcess.once('exit', onExit);
    waitForRpc(url).then(onReady, onError);
  });
}

function loadEnvFiles() {
  const files = ['.env', '.env.local'];
  for (const file of files) {
    const full = path.join(projectRoot, file);
    if (!fsSync.existsSync(full)) continue;
    const content = fsSync.readFileSync(full, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
      const [rawKey, ...rest] = line.split('=');
      const key = rawKey.trim();
      const value = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.replace(/^--/, '');
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
    } else {
      result[key] = next;
      i++;
    }
  }
  return result;
}

function checkExistingInstance() {
  if (!fsSync.existsSync(pidFile)) return;
  const pid = Number(fsSync.readFileSync(pidFile, 'utf8'));
  if (pid && Number.isFinite(pid)) {
    try {
      process.kill(pid, 0);
      console.log(`[chain] Found active anvil process (pid ${pid}). Sending SIGINT...`);
      try {
        process.kill(pid, 'SIGINT');
      } catch {}
      setTimeout(() => {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
        removePidFile();
      }, 1500);
    } catch {
      removePidFile();
    }
    return;
  }
  removePidFile();
}

function writePid(pid) {
  try {
    fsSync.writeFileSync(pidFile, String(pid));
  } catch (error) {
    console.warn('[chain] Unable to write PID file:', error.message);
  }
}

function removePidFile() {
  if (fsSync.existsSync(pidFile)) {
    try {
      fsSync.unlinkSync(pidFile);
    } catch {}
  }
}

function ensureDir(dir) {
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
}

function killProcess(childProcess) {
  if (!childProcess) {
    removePidFile();
    return Promise.resolve();
  }

  if (childProcess.exitCode !== null || childProcess.killed) {
    removePidFile();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const pid = childProcess.pid;
    const timer = setTimeout(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }, 2000);
    childProcess.once('exit', () => {
      clearTimeout(timer);
      removePidFile();
      resolve();
    });
    try {
      process.kill(pid, 'SIGINT');
    } catch {
      clearTimeout(timer);
      removePidFile();
      resolve();
    }
  });
}
