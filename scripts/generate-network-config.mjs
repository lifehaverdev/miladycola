#!/usr/bin/env node
/**
 * Generate network-specific contract config for frontend
 *
 * Usage:
 *   node scripts/generate-network-config.mjs sepolia \
 *     --colasseum 0x... --verifier 0x... --oracle 0x... \
 *     --rpc-url https://eth-sepolia.g.alchemy.com/v2/... \
 *     [--nft 0x...] [--charity 0x...] [--witness 0x...]
 *
 *   node scripts/generate-network-config.mjs mainnet \
 *     --colasseum 0x... --verifier 0x... --oracle 0x... \
 *     --rpc-url https://eth-mainnet.g.alchemy.com/v2/...
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(__filename, '..', '..');
const contractsDir = path.join(projectRoot, 'contracts');
const generatedDir = path.join(projectRoot, 'src', 'generated');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: generate-network-config.mjs <network> --colasseum 0x... --verifier 0x... --oracle 0x... --rpc-url URL');
    console.error('Networks: sepolia, mainnet');
    process.exit(1);
  }

  const network = args[0];
  if (!['sepolia', 'mainnet'].includes(network)) {
    console.error('Network must be "sepolia" or "mainnet"');
    process.exit(1);
  }

  const params = {};
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    params[key] = value;
  }

  // Validate required params
  const required = ['colasseum', 'verifier', 'oracle', 'rpc-url'];
  for (const key of required) {
    if (!params[key]) {
      console.error(`Missing required argument: --${key}`);
      process.exit(1);
    }
  }

  return { network, params };
}

async function loadArtifact(name, contractName) {
  const artifactPath = path.join(contractsDir, 'out', name, `${contractName}.json`);
  const content = await fs.readFile(artifactPath, 'utf8');
  return JSON.parse(content);
}

async function main() {
  const { network, params } = parseArgs();

  console.log(`Generating config for ${network}...`);

  // Load ABIs from compiled artifacts
  const colasseumArtifact = await loadArtifact('miladycola4.sol', 'Colasseum');
  const verifierArtifact = await loadArtifact('Verifier.sol', 'Groth16Verifier');
  const oracleArtifact = await loadArtifact('ranmilio.sol', 'BeaconRandomnessOracle');

  // Chain IDs
  const chainIds = {
    sepolia: 11155111,
    mainnet: 1,
  };

  const config = {
    chainId: chainIds[network],
    rpcUrl: params['rpc-url'],
    network,
    deployedAt: new Date().toISOString(),
    contracts: {
      colasseum: {
        address: params.colasseum,
        abi: colasseumArtifact.abi,
      },
      verifier: {
        address: params.verifier,
        abi: verifierArtifact.abi,
      },
      oracle: {
        address: params.oracle,
        abi: oracleArtifact.abi,
      },
    },
  };

  // Optional: NFT contract (for testing with a specific collection)
  if (params.nft) {
    // Load CoolNFT ABI for testing, or use minimal ERC721 ABI for production
    try {
      const nftArtifact = await loadArtifact('MockNFT.sol', 'CoolNFT');
      config.contracts.nft = {
        address: params.nft,
        abi: nftArtifact.abi,
      };
    } catch {
      // Use minimal ERC721 ABI
      config.contracts.nft = {
        address: params.nft,
        abi: [
          'function balanceOf(address owner) view returns (uint256)',
          'function ownerOf(uint256 tokenId) view returns (address)',
          'function tokenURI(uint256 tokenId) view returns (string)',
          'function approve(address to, uint256 tokenId)',
          'function getApproved(uint256 tokenId) view returns (address)',
        ],
      };
    }
  }

  // Optional metadata
  if (params.charity) config.charityAddress = params.charity;
  if (params.witness) config.witnessAddress = params.witness;

  // Write config
  await fs.mkdir(generatedDir, { recursive: true });
  const outputPath = path.join(generatedDir, `contracts-${network}.json`);
  await fs.writeFile(outputPath, JSON.stringify(config, null, 2));

  console.log(`Config written to: ${path.relative(projectRoot, outputPath)}`);
  console.log('');
  console.log('To run frontend with this config:');
  console.log(`  npm run ${network}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
