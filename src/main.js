import './style/main.css';
import { render, h, eventBus, Router } from '@monygroupcorp/microact';
import { WalletService } from '@monygroupcorp/micro-web3';
import { ethers } from 'ethers';
import ContractService from './services/ContractService.js';
import ColasseumIndexer from './services/ColasseumIndexer.js';
import DevService from './services/DevService.js';
import App from './components/App.js';
import ChallengePageView from './components/layout/ChallengePageView.js';

const createIconDataUri = (label, background, textColor = '#ffffff') => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="12" fill="${background}" />
      <text x="50%" y="55%" font-size="20" font-family="Inter, system-ui" text-anchor="middle" fill="${textColor}">
        ${label}
      </text>
    </svg>
  `;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const INLINE_WALLET_ICONS = {
  rabby: createIconDataUri('RB', '#7c5dff'),
  rainbow: createIconDataUri('RB', '#ff8f70'),
  phantom: createIconDataUri('PH', '#6a5acd'),
  metamask: createIconDataUri('MM', '#f6851b'),
};

/**
 * Load contract configuration
 *
 * Loads config based on VITE_NETWORK environment variable:
 * - 'sepolia' -> contracts-sepolia.json
 * - 'mainnet' -> contracts-mainnet.json
 * - default   -> contracts.json (local anvil)
 *
 * Falls back to null (fixture mode) if config not found.
 */
async function loadContractConfig() {
  const network = import.meta.env.VITE_NETWORK || 'local';

  try {
    let config;
    if (network === 'mainnet') {
      config = (await import('./generated/contracts-mainnet.json')).default;
    } else if (network === 'sepolia') {
      config = (await import('./generated/contracts-sepolia.json')).default;
    } else {
      config = (await import('./generated/contracts.json')).default;
    }
    console.log(`[main] Loaded contract config for network: ${network}`);
    return config;
  } catch (error) {
    console.warn(`[main] No contract config found for ${network}, using fixture mode:`, error.message);
    return null;
  }
}

async function main() {
  // 1. Initialize services
  const walletService = new WalletService(eventBus);
  const contractService = new ContractService(eventBus);
  const colasseumIndexer = new ColasseumIndexer(eventBus);

  // Load contract configuration
  const contractConfig = await loadContractConfig();

  // 2. Initialize DevService
  const devService = contractConfig
    ? new DevService({
        oracleAddress: contractConfig.contracts?.oracle?.address,
        timeWarpUrl: contractConfig.timeWarpUrl || null,
        oracleSeed: contractConfig.oracleSeed || null,
      })
    : null;

  // Wire wallet events BEFORE initializing services (to catch auto-connect)
  eventBus.on('wallet:connected', async ({ address, provider, signer, ethersProvider }) => {
    console.log('[main] Wallet connected:', address);
    if (contractService.initialized) {
      try {
        const expectedChainId = contractConfig?.chainId;
        if (expectedChainId && provider) {
          const rawProvider = provider;
          const walletChainId = await rawProvider.request({ method: 'eth_chainId' });
          const walletChainDecimal = parseInt(walletChainId, 16);
          console.log('[main] Wallet chain:', walletChainDecimal, 'Expected:', expectedChainId);

          if (walletChainDecimal !== expectedChainId) {
            const hexChainId = '0x' + expectedChainId.toString(16);
            try {
              await rawProvider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: hexChainId }],
              });
              console.log('[main] Switched wallet to chain', expectedChainId);
            } catch (switchError) {
              if (switchError.code === 4902) {
                await rawProvider.request({
                  method: 'wallet_addEthereumChain',
                  params: [{
                    chainId: hexChainId,
                    chainName: `Local Anvil (${expectedChainId})`,
                    rpcUrls: [contractConfig.rpcUrl || 'http://127.0.0.1:8545'],
                    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                  }],
                });
                console.log('[main] Added and switched to chain', expectedChainId);
              } else {
                console.error('[main] Failed to switch chain:', switchError);
              }
            }
          }
        }

        if (provider) {
          const web3Provider = new ethers.providers.Web3Provider(provider);
          const freshSigner = web3Provider.getSigner();
          contractService.setSigner(freshSigner);
          console.log('[main] ContractService signer set after chain validation');
        } else if (signer) {
          contractService.setSigner(signer);
          console.log('[main] ContractService signer set from WalletService');
        }
        const network = await contractService.provider.getNetwork();
        console.log('[main] Contract network chainId:', network.chainId);
      } catch (error) {
        console.error('[main] Failed to set signer:', error);
      }
    }
  });

  eventBus.on('wallet:disconnected', () => {
    console.log('[main] Wallet disconnected');
    contractService.clearSigner();
  });

  eventBus.on('wallet:chainChanged', async ({ chainId }) => {
    console.log('[main] Chain changed:', chainId);
  });

  // Initialize ContractService BEFORE wallet
  if (contractConfig) {
    try {
      await contractService.initialize(contractConfig);
    } catch (error) {
      console.error('Failed to initialize ContractService:', error);
    }

    colasseumIndexer.initialize(contractConfig)
      .then(() => console.log('[main] ColasseumIndexer initialized'))
      .catch(error => console.error('Failed to initialize ColasseumIndexer:', error));
  }

  // Initialize WalletService AFTER ContractService
  try {
    await walletService.initialize();
    walletService.walletIcons = INLINE_WALLET_ICONS;
  } catch (error) {
    console.error('Failed to initialize WalletService:', error);
  }

  // 3. Set up Router
  const router = new Router();
  const appRoot = document.getElementById('app');

  if (!appRoot) {
    console.error('Root element #app not found');
    return;
  }

  // Track current cleanup function
  let currentCleanup = null;

  // Route handler for main app
  const renderMainApp = () => {
    if (currentCleanup) currentCleanup();
    render(
      h(App, {
        walletService,
        contractService,
        colasseumIndexer,
        devService,
        useFixtures: !contractConfig,
      }),
      appRoot
    );
    return { cleanup: () => {} };
  };

  // Route handler for challenge page
  const renderChallengePage = ({ challengeId }) => {
    if (currentCleanup) currentCleanup();
    render(
      h(ChallengePageView, {
        challengeId,
        walletService,
        contractService,
        colasseumIndexer,
        devService,
        router,
        useFixtures: !contractConfig,
      }),
      appRoot
    );
    return { cleanup: () => {} };
  };

  // Register routes
  // Dev routes (no base path)
  router.on('/', renderMainApp);
  router.on('/:challengeId', renderChallengePage);

  // Production routes (with /miladycolav4/ base)
  router.on('/miladycolav4', renderMainApp);
  router.on('/miladycolav4/', renderMainApp);
  router.on('/miladycolav4/:challengeId', renderChallengePage);

  // 404 handler - show main app
  router.notFound((path) => {
    console.warn('[main] No route matched for:', path);
    renderMainApp();
  });

  // Start router
  await router.start();

  // 4. Global error handling
  eventBus.on('wallet:error', (error) => {
    console.error('A wallet error occurred:', error);
  });

  // 5. Expose services for debugging
  window.__services = { walletService, contractService, colasseumIndexer, devService, eventBus, router };
  console.log('[main] Services exposed on window.__services');
}

main().catch(console.error);
