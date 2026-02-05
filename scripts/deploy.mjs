#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { execSync } from 'node:child_process';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(__filename, '..', '..');
const contractsDir = path.join(projectRoot, 'contracts');
const generatedDir = path.join(projectRoot, 'src', 'generated');

// Constants matching start-colasseum-betatype.mjs
const DEFAULT_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEFAULT_USER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // anvil account #0
const CHARITY_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; // anvil account #1
const WITNESS_ADDRESS = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'; // anvil account #2
const CHARITY_GENEROSITY_BPS = 500; // 5%
const APPRAISAL_VALUE = ethers.utils.parseEther('0.2');
const FIXED_CHANCE_PRICE = ethers.utils.parseUnits('1', 'gwei');
const DEFAULT_LORE = 'Genesis Trial';
const NFT_METADATA_BASE_URI = 'http://localhost:5173/milady/'; // Local milady metadata

// Get user address from env or use default
function getUserAddress() {
  // Check env variable first
  if (process.env.USER_ADDRESS) {
    return process.env.USER_ADDRESS;
  }
  // Check command line args (--user-address 0x...)
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--user-address' && args[i + 1]) {
      return args[i + 1];
    }
  }
  return DEFAULT_USER_ADDRESS;
}

loadEnvFiles();
defaultEnv('RPC_URL', 'http://127.0.0.1:8545');
defaultEnv('CHAIN_ID', '1337');

// Require MAINNET_RPC_URL for forking/metadata
if (!process.env.MAINNET_RPC_URL) {
  console.error('[deploy] ERROR: MAINNET_RPC_URL environment variable is required.');
  console.error('[deploy] Please set it in .env or .env.local, or export it:');
  console.error('[deploy]   export MAINNET_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"');
  process.exit(1);
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

function defaultEnv(key, value) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

async function loadArtifact(name, contractName) {
  const artifactPath = path.join(contractsDir, 'out', name, `${contractName}.json`);
  const content = await fs.readFile(artifactPath, 'utf8');
  return JSON.parse(content);
}

export async function deployColasseum({ silent = false, rpcUrl } = {}) {
  const effectiveRpcUrl = rpcUrl || process.env.RPC_URL;
  const chainId = parseInt(process.env.CHAIN_ID, 10);

  if (!silent) {
    console.log('\n[deploy] Building contracts with Foundry...');
  }

  // Build contracts first
  execSync('forge build', { cwd: contractsDir, stdio: silent ? 'ignore' : 'inherit' });

  if (!silent) {
    console.log('[deploy] Deploying contracts via ethers.js...');
    console.log(`[deploy] RPC URL: ${effectiveRpcUrl}`);
  }

  const provider = new ethers.providers.JsonRpcProvider(effectiveRpcUrl);
  const deployer = new ethers.Wallet(DEFAULT_PRIVATE_KEY, provider);
  let nonce = await deployer.getTransactionCount();

  // Get user address (from env, CLI arg, or default)
  const userAddress = getUserAddress();

  // Fund the user wallet with some ETH
  await provider.send('anvil_setBalance', [userAddress, '0x56BC75E2D63100000']); // 100 ETH
  if (!silent) console.log(`[deploy] Funded ${userAddress} with 100 ETH`);

  // Load artifacts
  const oracleArtifact = await loadArtifact('ranmilio.sol', 'MockBeaconOracle');
  const verifierArtifact = await loadArtifact('Verifier.sol', 'Groth16Verifier');
  const colasseumArtifact = await loadArtifact('miladycola4.sol', 'Colasseum');
  const nftArtifact = await loadArtifact('MockNFT.sol', 'CoolNFT');

  // Deploy MockBeaconOracle
  const OracleFactory = new ethers.ContractFactory(oracleArtifact.abi, oracleArtifact.bytecode, deployer);
  const oracle = await OracleFactory.deploy({ nonce: nonce++ });
  await oracle.deployed();
  const oracleAddress = oracle.address;
  if (!silent) console.log(`[deploy] MockBeaconOracle: ${oracleAddress}`);

  // Deploy Groth16Verifier
  const VerifierFactory = new ethers.ContractFactory(verifierArtifact.abi, verifierArtifact.bytecode, deployer);
  const verifier = await VerifierFactory.deploy({ nonce: nonce++ });
  await verifier.deployed();
  const verifierAddress = verifier.address;
  if (!silent) console.log(`[deploy] Groth16Verifier: ${verifierAddress}`);

  // Deploy Colasseum
  const ColasseumFactory = new ethers.ContractFactory(colasseumArtifact.abi, colasseumArtifact.bytecode, deployer);
  const colasseum = await ColasseumFactory.deploy(oracleAddress, verifierAddress, CHARITY_ADDRESS, CHARITY_GENEROSITY_BPS, WITNESS_ADDRESS, { nonce: nonce++ });
  await colasseum.deployed();
  const colasseumAddress = colasseum.address;
  const deployBlock = await provider.getBlockNumber();
  if (!silent) console.log(`[deploy] Colasseum: ${colasseumAddress} (block ${deployBlock})`);
  if (!silent) console.log(`[deploy] Witness: ${WITNESS_ADDRESS}`);

  // Deploy CoolNFT (Milady mock)
  const NftFactory = new ethers.ContractFactory(nftArtifact.abi, nftArtifact.bytecode, deployer);
  const nft = await NftFactory.deploy({ nonce: nonce++ });
  await nft.deployed();
  const nftAddress = nft.address;
  if (!silent) console.log(`[deploy] Milady (mock): ${nftAddress}`);

  // Set base URI to local milady metadata
  await (await nft.setBaseURI(NFT_METADATA_BASE_URI, { nonce: nonce++ })).wait();
  if (!silent) console.log(`[deploy] NFT base URI set to: ${NFT_METADATA_BASE_URI}`);

  // Initialize oracle with seed
  const latestBlock = await provider.getBlock('latest');
  const oracleSeed = ethers.utils.keccak256(
    ethers.utils.solidityPack(
      ['string', 'uint256'],
      ['miladycolav4-local', latestBlock.timestamp]
    )
  );
  await (await oracle.setSeed(oracleSeed, { nonce: nonce++ })).wait();
  if (!silent) console.log(`[deploy] Oracle seed set: ${oracleSeed}`);

  // Mint NFTs to user wallet (tokens 1, 2, 3)
  const mintedIds = [];
  for (let i = 0; i < 3; i++) {
    const id = await nft.previewNextId();
    await (await nft.mint(userAddress, { nonce: nonce++ })).wait();
    mintedIds.push(id.toNumber());
  }
  if (!silent) console.log(`[deploy] Minted NFTs #${mintedIds.join(', #')} to ${userAddress}`);

  // Create genesis trial with a new NFT
  const trialNftId = await nft.previewNextId();
  await (await nft.mint(deployer.address, { nonce: nonce++ })).wait();
  await (await nft.approve(colasseumAddress, trialNftId, { nonce: nonce++ })).wait();
  mintedIds.push(trialNftId.toNumber());

  // Write local metadata JSON files for all minted tokens so the Vite dev
  // server can serve them at /milady/{id}.json (matching the NFT baseURI).
  const miladyDir = path.join(projectRoot, 'public', 'milady');
  await fs.mkdir(miladyDir, { recursive: true });
  for (const tokenId of mintedIds) {
    const metadata = {
      name: `Milady #${tokenId}`,
      description: 'A Milady for the Colasseum.',
      image: `https://www.miladymaker.net/milady/${tokenId}.png`,
    };
    await fs.writeFile(
      path.join(miladyDir, `${tokenId}.json`),
      JSON.stringify(metadata, null, 2)
    );
  }
  if (!silent) console.log(`[deploy] Wrote metadata for tokens #${mintedIds.join(', #')} to public/milady/`);

  const depositAmount = APPRAISAL_VALUE.mul(5).div(100);
  const challengeTx = await colasseum.challenge(
    nftAddress,
    trialNftId,
    APPRAISAL_VALUE,
    DEFAULT_LORE,
    { value: depositAmount, nonce: nonce++ }
  );
  await challengeTx.wait();
  const nextId = await colasseum.nextTrialId();
  const genesisTrialId = nextId.toNumber() - 1;
  if (!silent) console.log(`[deploy] Genesis trial #${genesisTrialId} created with lore "${DEFAULT_LORE}"`);

  // Prepare output payload
  // timeWarpUrl is for the dev sidecar server (optional - DevService handles missing URL)
  const timeWarpUrl = process.env.TIME_WARP_URL || 'http://127.0.0.1:8788/colasseum-warp';

  const payload = {
    chainId,
    rpcUrl: effectiveRpcUrl,
    deployedAt: new Date().toISOString(),
    deployBlock, // Block number when Colasseum was deployed (for event indexing)
    genesisTrialId,
    lore: DEFAULT_LORE,
    appraisalWei: APPRAISAL_VALUE.toString(),
    ticketPriceWei: FIXED_CHANCE_PRICE.toString(),
    oracleSeed,
    timeWarpUrl, // DEV ONLY: URL for time warp sidecar (remove for production)
    userWallet: userAddress,
    charityAddress: CHARITY_ADDRESS,
    witnessAddress: WITNESS_ADDRESS,
    contracts: {
      colasseum: {
        address: colasseumAddress,
        abi: colasseumArtifact.abi,
      },
      nft: {
        address: nftAddress,
        abi: nftArtifact.abi,
      },
      oracle: {
        address: oracleAddress,
        abi: oracleArtifact.abi,
      },
      verifier: {
        address: verifierAddress,
        abi: verifierArtifact.abi,
      },
    },
  };

  // Write to generated directory
  await fs.mkdir(generatedDir, { recursive: true });
  const outputPath = path.join(generatedDir, 'contracts.json');
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));

  if (!silent) {
    console.log('\n[deploy] --- Deployment Complete ---');
    console.log(`[deploy] Wrote ${path.relative(projectRoot, outputPath)}`);
  }

  return payload;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  deployColasseum().catch((error) => {
    console.error('[deploy] Failed to deploy:', error.message);
    process.exit(1);
  });
}
