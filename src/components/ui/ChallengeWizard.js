import { Component, h, eventBus } from '@monygroupcorp/microact';
import { IpfsImage, IpfsService } from '@monygroupcorp/micro-web3';
import { ethers } from 'ethers';
import knownCollections from '../../fixtures/collections.json';
import nftMetadataService from '../../services/NftMetadataService.js';

const { isIpfsUri } = IpfsService;

const SITE_URL = 'https://miladycola.net';

function shareOnX(text) {
  const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SITE_URL)}`;
  window.open(url, '_blank', 'noopener,width=550,height=420');
}

// Minimal ERC721 ABI for scanning collections
const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

class ChallengeWizard extends Component {
  constructor(props) {
    super(props);
    this.state = {
      stage: 'contract', // contract, tokens, preview, appraisal, review, pending, success
      scanning: false,
      scanningMessage: 'Scanning popular collections...',
      manualContract: '',
      manualTokenId: '',
      holdings: [], // { collection, tokens: [{id, name}] }
      selectedCollection: null,
      selectedToken: null, // { id, title, image, nftContract }
      appraisal: 0.2,
      lore: '',
      walletBalance: '--',
      error: null,
    };
    this.appraisalStepTimeout = null;
    this.appraisalStepInterval = null;
  }

  reset() {
    // Clear any running intervals
    this.handleAppraisalStepStop();

    this.setState({
      stage: 'contract',
      scanning: false,
      manualContract: '',
      manualTokenId: '',
      holdings: [],
      selectedCollection: null,
      selectedToken: null,
      appraisal: 0.2,
      lore: '',
      error: null,
    });
    this.scanCollections();
  }

  didMount() {
    this.scanCollections();
  }

  willUnmount() {
    this.handleAppraisalStepStop();
  }

  async scanCollections() {
    this.setState({ scanning: true, scanningMessage: 'Scanning popular collections...' });

    const holdings = [];

    // If we have contractService, check for dev NFT contract
    if (this.props.contractService?.initialized && this.props.contractService.contracts?.nft) {
      // Get connected address from walletService
      const connectedAddress = this.props.walletService?.connectedAddress;
      console.log('[ChallengeWizard] Scanning with address:', connectedAddress);

      if (connectedAddress) {
        try {
          // Get the NFT contract info from contractService
          const nftAddress = this.props.contractService.contracts.nft.address;
          const nftContract = this.props.contractService.contracts.nft;
          console.log('[ChallengeWizard] NFT contract address:', nftAddress);

          // Create dev collection entry
          const devCollection = {
            name: 'Dev NFT (CoolNFT)',
            address: nftAddress,
            icon: 'D',
          };

          // Query tokens owned by the connected address
          const ownedTokens = [];
          try {
            // Try to get balance
            const balance = await nftContract.balanceOf(connectedAddress);
            const balanceNum = balance.toNumber();
            console.log('[ChallengeWizard] NFT balance:', balanceNum);

            // CoolNFT doesn't have enumerable, so check known token IDs
            // Token IDs start at 1 in CoolNFT (_nextTokenId = 1)
            // Deploy script mints 3 to user, then 1 for genesis trial
            if (balanceNum > 0) {
              // Query tokens in parallel but suppress errors (unminted tokens throw)
              const tokenChecks = [];
              for (let i = 1; i <= 10; i++) {
                tokenChecks.push(
                  nftContract.ownerOf(i)
                    .then(owner => {
                      if (owner.toLowerCase() === connectedAddress.toLowerCase()) {
                        return { id: String(i), name: `CoolNFT #${i}` };
                      }
                      return null;
                    })
                    .catch(() => null) // Token doesn't exist - silently ignore
                );
              }
              const results = await Promise.all(tokenChecks);
              ownedTokens.push(...results.filter(Boolean));
            }
            console.log('[ChallengeWizard] Found tokens:', ownedTokens);
          } catch (err) {
            console.warn('[ChallengeWizard] Failed to enumerate NFTs:', err);
          }

          if (ownedTokens.length > 0) {
            holdings.push({
              collection: devCollection,
              tokens: ownedTokens,
            });
          }
        } catch (err) {
          console.error('[ChallengeWizard] Failed to scan dev NFT contract:', err);
        }
      } else {
        console.log('[ChallengeWizard] No wallet connected, skipping NFT scan');
      }
    } else {
      console.log('[ChallengeWizard] No dev NFT contract, will scan known collections');
    }

    // Scan known collections from collections.json
    const connectedAddress = this.props.walletService?.connectedAddress;
    const provider = this.props.contractService?.provider;

    if (connectedAddress && provider && knownCollections.length > 0) {
      console.log('[ChallengeWizard] Quick-scanning known collections for balances...');

      // Phase 1: Just check balances (fast)
      for (const collection of knownCollections) {
        try {
          const contract = new ethers.Contract(collection.address, ERC721_ABI, provider);
          const balance = await contract.balanceOf(connectedAddress);
          const balanceNum = balance.toNumber();

          console.log(`[ChallengeWizard] ${collection.name}: balance = ${balanceNum}`);

          if (balanceNum > 0) {
            // Just store balance - we'll load actual tokens when they select this collection
            holdings.push({
              collection: collection,
              balance: balanceNum,
              tokens: [], // Will be populated when selected
              tokensLoaded: false,
            });
          }
        } catch (err) {
          console.warn(`[ChallengeWizard] Failed to scan ${collection.name}:`, err.message);
        }
      }
    }

    this.setState({
      scanning: false,
      holdings,
    });
  }

  // Load actual token IDs when user selects a collection (heavy lifting)
  async loadTokensForCollection(holding) {
    const connectedAddress = this.props.walletService?.connectedAddress;
    const provider = this.props.contractService?.provider;

    if (!connectedAddress || !provider) return holding;

    const collection = holding.collection;
    const contract = new ethers.Contract(collection.address, ERC721_ABI, provider);
    const ownedTokens = [];

    console.log(`[ChallengeWizard] Loading tokens for ${collection.name}...`);

    // Try enumerable first (tokenOfOwnerByIndex)
    let enumerable = true;
    try {
      for (let i = 0; i < Math.min(holding.balance, 20); i++) {
        const tokenId = await contract.tokenOfOwnerByIndex(connectedAddress, i);
        ownedTokens.push({
          id: tokenId.toString(),
          name: `${collection.name} #${tokenId.toString()}`,
        });
      }
    } catch (err) {
      // Not enumerable - try querying Transfer events instead
      enumerable = false;
      console.log(`[ChallengeWizard] ${collection.name} not enumerable, trying Transfer events...`);

      try {
        // Query Transfer events TO this address (received tokens)
        const filterTo = contract.filters.Transfer(null, connectedAddress);
        const eventsTo = await contract.queryFilter(filterTo);

        // Get unique token IDs received
        const receivedTokens = new Set(eventsTo.map(e => e.args.tokenId.toString()));

        // Verify ownership with ownerOf (in case they transferred out)
        const verifiedTokens = [];
        for (const tokenId of receivedTokens) {
          try {
            const owner = await contract.ownerOf(tokenId);
            if (owner.toLowerCase() === connectedAddress.toLowerCase()) {
              verifiedTokens.push(tokenId);
            }
          } catch (e) {
            // Token might not exist or was burned
          }
          // Limit to 20 tokens
          if (verifiedTokens.length >= 20) break;
        }

        console.log(`[ChallengeWizard] ${collection.name}: found ${verifiedTokens.length} tokens via events`);

        for (const tokenId of verifiedTokens) {
          ownedTokens.push({
            id: tokenId,
            name: `${collection.name} #${tokenId}`,
          });
        }
      } catch (eventErr) {
        console.warn(`[ChallengeWizard] ${collection.name} event query failed:`, eventErr.message);
      }
    }

    // If still no tokens found but has balance, add placeholder entry
    if (ownedTokens.length === 0 && holding.balance > 0) {
      ownedTokens.push({
        id: '_manual_',
        name: `You own ${holding.balance} - enter token ID manually`,
        requiresManualId: true,
      });
    }

    return {
      ...holding,
      tokens: ownedTokens,
      tokensLoaded: true,
    };
  }

  handleClose = () => {
    eventBus.emit('modal:close');
  };

  handleContractInput = (e) => {
    this.setState({ manualContract: e.target.value });
  };

  handleManualContractSubmit = async () => {
    const { manualContract } = this.state;

    // Basic validation - must be 0x followed by 40 hex chars
    if (!/^0x[a-fA-F0-9]{40}$/.test(manualContract)) {
      this.setState({ error: 'Invalid contract address format' });
      return;
    }

    this.setState({ scanning: true, scanningMessage: 'Finding your tokens...', error: null });

    // Create a manual collection entry
    const manualCollection = {
      name: 'Custom Collection',
      address: manualContract,
      icon: '?',
    };

    const ownedTokens = [];
    let balanceNum = 0;

    // Try to scan for owned tokens if we have contractService and wallet
    const connectedAddress = this.props.walletService?.connectedAddress;
    if (this.props.contractService?.provider && connectedAddress) {
      try {
        const customContract = new ethers.Contract(
          manualContract,
          ERC721_ABI,
          this.props.contractService.provider
        );

        // Try to get collection name
        try {
          const nameAbi = ['function name() view returns (string)'];
          const nameContract = new ethers.Contract(manualContract, nameAbi, this.props.contractService.provider);
          const name = await nameContract.name();
          if (name) manualCollection.name = name;
        } catch (e) {
          // Ignore - name() is optional
        }

        // Check balance
        const balance = await customContract.balanceOf(connectedAddress);
        balanceNum = balance.toNumber();
        console.log('[ChallengeWizard] Custom contract balance:', balanceNum);

        if (balanceNum > 0) {
          // Try enumerable first (tokenOfOwnerByIndex)
          let enumerable = true;
          try {
            for (let i = 0; i < Math.min(balanceNum, 20); i++) {
              const tokenId = await customContract.tokenOfOwnerByIndex(connectedAddress, i);
              ownedTokens.push({
                id: tokenId.toString(),
                name: `${manualCollection.name} #${tokenId.toString()}`,
              });
            }
            console.log('[ChallengeWizard] Custom contract is enumerable, found', ownedTokens.length, 'tokens');
          } catch (enumErr) {
            // Not enumerable - try Transfer events
            enumerable = false;
            console.log('[ChallengeWizard] Custom contract not enumerable, trying Transfer events...');

            try {
              // Query Transfer events TO this address (received tokens)
              const filterTo = customContract.filters.Transfer(null, connectedAddress);
              const eventsTo = await customContract.queryFilter(filterTo);

              // Get unique token IDs received
              const receivedTokens = new Set(eventsTo.map(e => e.args.tokenId.toString()));
              console.log('[ChallengeWizard] Found', receivedTokens.size, 'Transfer events to address');

              // Verify ownership with ownerOf (in case they transferred out)
              const verifiedTokens = [];
              for (const tokenId of receivedTokens) {
                try {
                  const owner = await customContract.ownerOf(tokenId);
                  if (owner.toLowerCase() === connectedAddress.toLowerCase()) {
                    verifiedTokens.push(tokenId);
                  }
                } catch (e) {
                  // Token might not exist or was burned
                }
                // Limit to 20 tokens
                if (verifiedTokens.length >= 20) break;
              }

              console.log('[ChallengeWizard] Verified', verifiedTokens.length, 'tokens via events');

              for (const tokenId of verifiedTokens) {
                ownedTokens.push({
                  id: tokenId,
                  name: `${manualCollection.name} #${tokenId}`,
                });
              }
            } catch (eventErr) {
              console.warn('[ChallengeWizard] Event query failed:', eventErr.message);
            }
          }
        }
      } catch (err) {
        console.warn('[ChallengeWizard] Failed to scan custom contract:', err);
        // Continue with empty tokens - user can enter manually
      }
    }

    // If still no tokens found but has balance, add placeholder for manual entry
    if (ownedTokens.length === 0 && balanceNum > 0) {
      ownedTokens.push({
        id: '_manual_',
        name: `You own ${balanceNum} - enter token ID manually`,
        requiresManualId: true,
      });
    }

    const manualHolding = {
      collection: manualCollection,
      tokens: ownedTokens,
      balance: balanceNum,
      tokensLoaded: true,
    };

    this.setState({
      scanning: false,
      holdings: [...this.state.holdings, manualHolding],
      selectedCollection: manualHolding,
      stage: 'tokens',
      error: null,
    });
  };

  handleCollectionSelect = async (address) => {
    let holding = this.state.holdings.find(h => h.collection.address === address);
    if (!holding) return;

    // If tokens not loaded yet, load them now
    if (!holding.tokensLoaded) {
      this.setState({ scanning: true, scanningMessage: 'Finding your tokens...' });
      holding = await this.loadTokensForCollection(holding);

      // Update holdings with loaded tokens
      const updatedHoldings = this.state.holdings.map(h =>
        h.collection.address === address ? holding : h
      );

      this.setState({
        holdings: updatedHoldings,
        selectedCollection: holding,
        stage: 'tokens',
        scanning: false,
      });
    } else {
      this.setState({
        selectedCollection: holding,
        stage: 'tokens',
      });
    }
  };

  handleChangeCollection = () => {
    this.setState({
      selectedCollection: null,
      selectedToken: null,
      manualTokenId: '',
      stage: 'contract',
    });
  };

  handleManualTokenInput = (e) => {
    this.setState({ manualTokenId: e.target.value });
  };

  handleManualTokenSubmit = () => {
    const { manualTokenId, selectedCollection } = this.state;

    if (!manualTokenId || !selectedCollection) return;

    // Use the manual token ID with the selected collection
    this.handleTokenSelect(manualTokenId.trim());
  };

  handleTokenSelect = async (tokenId) => {
    const { selectedCollection } = this.state;

    if (!selectedCollection) return;

    const contractAddress = selectedCollection.collection.address;
    const collectionName = selectedCollection.collection.name;

    // Show loading state
    this.setState({ scanning: true, scanningMessage: 'Fetching token metadata...' });

    // Initialize metadata service with provider if needed
    if (this.props.contractService?.provider && !nftMetadataService.provider) {
      nftMetadataService.setProvider(this.props.contractService.provider);
    }

    // Fetch real metadata
    let metadata = null;
    try {
      metadata = await nftMetadataService.getMetadata(contractAddress, tokenId);
      console.log('[ChallengeWizard] Fetched metadata:', metadata);
    } catch (err) {
      console.warn('[ChallengeWizard] Failed to fetch metadata:', err.message);
    }

    const selectedToken = {
      id: tokenId,
      title: metadata?.name || `${collectionName} #${tokenId}`,
      nftContract: contractAddress,
      image: metadata?.image || '',
      description: metadata?.description || '',
      attributes: metadata?.attributes || [],
      metadata, // Store full metadata for later use
    };

    this.setState({
      selectedToken,
      stage: 'preview',
      scanning: false,
    });
  };

  handleCancelToken = () => {
    this.setState({
      selectedToken: null,
      stage: 'tokens',
    });
  };

  handleConfirmToken = () => {
    this.setState({ stage: 'appraisal' });
  };

  handleChangeToken = () => {
    this.setState({
      selectedToken: null,
      stage: 'tokens',
    });
  };

  handleAppraisalStepStart = (step) => {
    // Immediate first step
    this.applyAppraisalStep(step);

    // Start continuous increment after initial delay
    this.appraisalStepTimeout = setTimeout(() => {
      this.appraisalStepInterval = setInterval(() => {
        this.applyAppraisalStep(step);
      }, 80); // Fast repeat rate
    }, 400); // Initial delay before repeat starts
  };

  handleAppraisalStepStop = () => {
    if (this.appraisalStepTimeout) {
      clearTimeout(this.appraisalStepTimeout);
      this.appraisalStepTimeout = null;
    }
    if (this.appraisalStepInterval) {
      clearInterval(this.appraisalStepInterval);
      this.appraisalStepInterval = null;
    }
  };

  applyAppraisalStep(step) {
    const newValue = Math.max(0, this.state.appraisal + step);
    this.setState({ appraisal: Math.round(newValue * 100) / 100 });
  }

  handleAppraisalInput = (e) => {
    const value = parseFloat(e.target.value) || 0;
    this.setState({ appraisal: value });
  };

  handleLoreInput = (e) => {
    this.setState({ lore: e.target.value });
  };

  handleGoToReview = () => {
    this.setState({ stage: 'review' });
  };

  handleBackToAppraisal = () => {
    this.setState({ stage: 'appraisal' });
  };

  handleCreate = async () => {
    this.setState({ stage: 'pending', error: null });

    const nftContract = this.state.selectedToken?.nftContract || this.state.manualContract;
    const tokenId = this.state.selectedToken?.id;
    const appraisal = this.state.appraisal;
    const lore = this.state.lore.trim();

    // If contractService is available, use real transactions
    if (this.props.contractService?.initialized) {
      try {
        // First approve the NFT transfer
        const isApproved = await this.props.contractService.isNftApproved(nftContract, tokenId);
        if (!isApproved) {
          await this.props.contractService.approveNft(nftContract, tokenId);
        }

        // Create the trial (challenge)
        const { trialId } = await this.props.contractService.challenge(
          nftContract,
          tokenId,
          String(appraisal),
          lore
        );

        this.setState({ stage: 'success', createdTrialId: trialId });
        eventBus.emit('challenge:created', { trialId, nftContract, tokenId, appraisal, lore });
      } catch (error) {
        console.error('[ChallengeWizard] Failed to create challenge:', error);
        this.setState({
          stage: 'review',
          error: error.reason || error.message || 'Transaction failed',
        });
      }
    } else {
      // Fixture mode - simulate with timeout
      setTimeout(() => {
        eventBus.emit('modal:close');
        eventBus.emit('challenge:created', { nftContract, tokenId, appraisal });
      }, 2000);
    }
  };

  getDepositAmount() {
    return (this.state.appraisal * 0.05).toFixed(4);
  }

  /**
   * Render an NFT image with IPFS support.
   * Uses IpfsImage component for IPFS URLs for automatic gateway rotation.
   */
  renderNftImage(src, alt, className = '') {
    if (!src) {
      return h('div', { className: `nft-image-placeholder ${className}` }, '?');
    }

    // Use IpfsImage for IPFS URLs to get gateway rotation
    if (isIpfsUri(src)) {
      return h(IpfsImage, { src, alt, className });
    }

    // Regular img for HTTP URLs
    return h('img', { src, alt, className });
  }

  // Render collection icon - supports image URLs/paths or single character fallback
  renderCollectionIcon(icon) {
    if (!icon) {
      return h('span', { className: 'known-collection-card__icon' }, '?');
    }
    // If it looks like an image path or URL, render as image
    if (icon.startsWith('http') || icon.startsWith('ipfs://') || icon.startsWith('data:') || icon.startsWith('/')) {
      return h('span', { className: 'known-collection-card__icon known-collection-card__icon--img' },
        h('img', { src: icon, alt: 'Collection icon', className: 'collection-icon-img' })
      );
    }
    // Otherwise render as text (single character)
    return h('span', { className: 'known-collection-card__icon' }, icon);
  }

  // Stage: contract - show collection picker and manual entry
  renderContractStage() {
    const { scanning, scanningMessage, holdings, manualContract } = this.state;

    return h('section', { className: 'wizard-stage' },
      h('h3', { className: 'form-subheading' }, 'Choose your collection'),
      h('p', { className: 'muted small-text' }, 'We scan popular collections automatically.'),

      h('div', { className: 'collection-picker' },
        scanning
          ? h('p', { className: 'muted' }, scanningMessage)
          : holdings.length === 0
            ? h('p', { className: 'muted' }, 'No popular collections found in your wallet.')
            : holdings.map(holding =>
                h('div', { key: holding.collection.address, className: 'known-collection-card' },
                  h('button', {
                    className: 'known-collection-card__head collection-header-btn',
                    type: 'button',
                    onClick: () => this.handleCollectionSelect(holding.collection.address),
                  },
                    this.renderCollectionIcon(holding.collection.icon),
                    h('div', null,
                      h('strong', null, holding.collection.name),
                      h('p', { className: 'muted small-text' }, `${holding.balance || holding.tokens.length} token${(holding.balance || holding.tokens.length) !== 1 ? 's' : ''} owned`)
                    )
                  )
                )
              )
      ),

      h('div', { className: 'manual-entry' },
        h('p', { className: 'muted small-text manual-entry__intro' }, "Don't see your collection? Paste the NFT contract address:"),
        h('label', null,
          'NFT Contract Address',
          h('input', {
            type: 'text',
            value: manualContract,
            placeholder: '0x...',
            onInput: this.handleContractInput,
            disabled: scanning,
          })
        ),
        h('button', {
          className: 'btn primary',
          type: 'button',
          disabled: !manualContract || scanning,
          onClick: this.handleManualContractSubmit,
        }, scanning ? 'Scanning...' : 'Use This Contract')
      )
    );
  }

  // Stage: tokens - show selected collection summary + token picker
  renderTokensStage() {
    const { selectedCollection, selectedToken, manualTokenId } = this.state;

    if (!selectedCollection) return null;

    const hasTokens = selectedCollection.tokens.length > 0;

    return h('section', { className: 'wizard-stage' },
      h('div', { className: 'stage-selection-summary' },
        h('div', { className: 'selection-info' },
          this.renderCollectionIcon(selectedCollection.collection.icon),
          h('div', null,
            h('strong', null, selectedCollection.collection.name),
            h('p', { className: 'muted small-text' }, hasTokens ? `${selectedCollection.tokens.length} tokens` : 'Custom contract')
          )
        ),
        h('button', {
          className: 'btn ghost small',
          type: 'button',
          onClick: this.handleChangeCollection,
        }, 'Change')
      ),

      // Filter out manual placeholder tokens for display
      (() => {
        const realTokens = selectedCollection.tokens.filter(t => !t.requiresManualId);
        const manualToken = selectedCollection.tokens.find(t => t.requiresManualId);
        const hasRealTokens = realTokens.length > 0;

        return [
          h('h3', { className: 'form-subheading' }, hasRealTokens ? 'Select a token' : 'Enter token ID'),
          h('p', { className: 'muted small-text' }, hasRealTokens
            ? `Found ${realTokens.length} token${realTokens.length > 1 ? 's' : ''} in your wallet. Choose which to use as your prize:`
            : manualToken
              ? manualToken.name
              : 'No tokens found in the 0-99 range. Enter the token ID you own:'),

          hasRealTokens
            ? h('div', { className: 'token-grid' },
                realTokens.map(t =>
                  h('button', {
                    key: t.id,
                    className: `collection-token-btn ${selectedToken?.id === t.id ? 'selected' : ''}`,
                    type: 'button',
                    onClick: () => this.handleTokenSelect(t.id),
                  }, `#${t.id}`)
                )
              )
            : null
        ];
      })(),

      // Always show manual entry for non-enumerable or when no tokens found
      (!hasTokens || selectedCollection.tokens.some(t => t.requiresManualId))
        ? h('div', { className: 'manual-token-entry' },
            h('label', null,
              'Token ID',
              h('input', {
                type: 'text',
                value: manualTokenId,
                placeholder: 'e.g. 1337',
                onInput: this.handleManualTokenInput,
              })
            ),
            h('button', {
              className: 'btn primary',
              type: 'button',
              disabled: !manualTokenId,
              onClick: this.handleManualTokenSubmit,
            }, 'Use This Token')
          )
        : null
    );
  }

  // Stage: preview - show token preview with confirm/cancel
  renderPreviewStage() {
    const { selectedCollection, selectedToken } = this.state;

    if (!selectedToken) return null;

    const shortContract = selectedToken.nftContract
      ? `${selectedToken.nftContract.slice(0, 6)}...${selectedToken.nftContract.slice(-4)}`
      : '--';

    return h('section', { className: 'wizard-stage' },
      h('div', { className: 'stage-selection-summary' },
        h('div', { className: 'selection-info' },
          this.renderCollectionIcon(selectedCollection.collection.icon),
          h('strong', null, selectedCollection.collection.name)
        ),
        h('button', {
          className: 'btn ghost small',
          type: 'button',
          onClick: this.handleChangeCollection,
        }, 'Change')
      ),

      h('h3', { className: 'form-subheading' }, 'Confirm your prize'),

      h('div', { className: 'token-preview-inline' },
        h('div', { className: 'token-preview-image' },
          selectedToken.image
            ? this.renderNftImage(selectedToken.image, selectedToken.title)
            : h('div', { className: 'token-preview-placeholder' }, '?')
        ),
        h('div', { className: 'token-preview-info' },
          h('h4', null, selectedToken.title),
          h('p', { className: 'muted small-text' }, `Contract: ${shortContract}`),
          h('p', { className: 'muted small-text' }, `Token ID: #${selectedToken.id}`),
          selectedToken.description && h('p', { className: 'token-preview-description muted small-text' },
            selectedToken.description.length > 100
              ? selectedToken.description.slice(0, 100) + '...'
              : selectedToken.description
          )
        ),
        h('div', { className: 'token-preview-actions' },
          h('button', {
            className: 'btn ghost',
            type: 'button',
            onClick: this.handleCancelToken,
          }, 'Back'),
          h('button', {
            className: 'btn primary',
            type: 'button',
            onClick: this.handleConfirmToken,
          }, 'Use This Token')
        )
      )
    );
  }

  // Stage: appraisal - show token summary + appraisal inputs
  renderAppraisalStage() {
    const { selectedToken, appraisal, walletBalance } = this.state;
    const deposit = this.getDepositAmount();
    const canProceed = selectedToken && appraisal > 0;

    if (!selectedToken) return null;

    return h('section', { className: 'wizard-stage' },
      h('div', { className: 'stage-selection-summary' },
        h('div', { className: 'selection-info' },
          this.renderNftImage(selectedToken.image, selectedToken.title, 'selection-thumb'),
          h('strong', null, selectedToken.title)
        ),
        h('button', {
          className: 'btn ghost small',
          type: 'button',
          onClick: this.handleChangeToken,
        }, 'Change')
      ),

      h('h3', { className: 'form-subheading' }, 'Set your appraisal'),
      h('p', { className: 'muted small-text appraisal-hint' }, "Consider pricing above floor\u2014players can aim for high odds to chase discounts. You'll deposit 5% of this appraisal when you launch, and that escrow returns to you alongside the prize pot when someone wins."),

      h('label', { className: 'appraisal-input-group' },
        h('span', null, 'Appraisal Value (ETH)'),
        h('div', { className: 'appraisal-input' },
          h('button', {
            className: 'appraisal-step-btn',
            type: 'button',
            'aria-label': 'Decrease appraisal',
            onPointerDown: () => this.handleAppraisalStepStart(-0.01),
            onPointerUp: this.handleAppraisalStepStop,
            onPointerLeave: this.handleAppraisalStepStop,
          }, '-'),
          h('input', {
            type: 'number',
            value: appraisal,
            step: '0.01',
            min: '0',
            onInput: this.handleAppraisalInput,
          }),
          h('button', {
            className: 'appraisal-step-btn',
            type: 'button',
            'aria-label': 'Increase appraisal',
            onPointerDown: () => this.handleAppraisalStepStart(0.01),
            onPointerUp: this.handleAppraisalStepStop,
            onPointerLeave: this.handleAppraisalStepStop,
          }, '+')
        )
      ),

      h('div', { className: 'appraisal-meta' },
        h('p', { className: 'muted small-text' }, 'Wallet balance: ', h('strong', null, walletBalance)),
        h('p', { className: 'muted small-text' }, 'Deposit (5%): ', h('strong', null, `${deposit} ETH`))
      ),

      h('label', { className: 'lore-input-group' },
        h('span', null, 'Lore (optional)'),
        h('p', { className: 'muted small-text' }, 'Taunt the crowd or tell your story.'),
        h('textarea', {
          className: 'lore-textarea',
          value: this.state.lore,
          placeholder: 'e.g. "Only the boldest cola fans deserve this one..."',
          maxLength: 280,
          rows: 3,
          onInput: this.handleLoreInput,
        })
      ),

      h('button', {
        className: 'btn primary full',
        type: 'button',
        disabled: !canProceed,
        onClick: this.handleGoToReview,
      }, 'Review Challenge')
    );
  }

  // Stage: review - final confirmation
  renderReviewStage() {
    const { selectedToken, appraisal, lore } = this.state;
    const deposit = this.getDepositAmount();

    if (!selectedToken) return null;

    return h('section', { className: 'wizard-stage' },
      h('h3', { className: 'form-subheading' }, 'Review Your Challenge'),

      h('div', { className: 'review-summary' },
        h('div', { className: 'review-item' },
          h('span', { className: 'muted' }, 'Prize'),
          h('strong', null, selectedToken.title)
        ),
        h('div', { className: 'review-item' },
          h('span', { className: 'muted' }, 'Appraisal'),
          h('strong', null, `${appraisal} ETH`)
        ),
        h('div', { className: 'review-item' },
          h('span', { className: 'muted' }, 'Your Deposit (5%)'),
          h('strong', null, `${deposit} ETH`)
        ),
        lore && h('div', { className: 'review-item review-item--lore' },
          h('span', { className: 'muted' }, 'Lore'),
          h('p', { className: 'review-lore-text' }, lore)
        )
      ),

      h('p', { className: 'muted small-text review-note' }, `By creating this challenge, you'll escrow ${deposit} ETH. This returns to you when someone wins, along with any accumulated prize pot.`),

      h('div', { className: 'review-actions' },
        h('button', {
          className: 'btn ghost',
          type: 'button',
          onClick: this.handleBackToAppraisal,
        }, 'Back'),
        h('button', {
          className: 'btn primary',
          type: 'button',
          onClick: this.handleCreate,
        }, 'Create Challenge')
      )
    );
  }

  // Stage: pending - loader
  renderPendingStage() {
    return h('section', { className: 'wizard-stage' },
      h('div', { className: 'challenge-pending-content' },
        h('div', { className: 'modal-loader active', 'aria-hidden': 'false' }),
        h('div', null,
          h('h4', null, 'Submitting your challenge...'),
          h('p', { className: 'muted small-text' }, "Confirm the wallet prompts to escrow your deposit. We'll keep this modal open until the transaction finalizes.")
        )
      )
    );
  }

  // Stage: success - share prompt
  renderSuccessStage() {
    const { selectedToken, appraisal } = this.state;
    const tokenTitle = selectedToken?.title || 'NFT';

    return h('section', { className: 'wizard-stage wizard-stage--success' },
      h('div', { className: 'success-content' },
        h('div', { className: 'success-icon' }, '🍾'),
        h('h3', null, 'Challenge Created!'),
        h('p', { className: 'muted' }, `Your ${tokenTitle} is now up for grabs at ${appraisal} ETH appraisal.`),
        h('div', { className: 'success-actions' },
          h('button', {
            className: 'btn primary full share-btn',
            type: 'button',
            onClick: () => shareOnX(`Just stocked a prize on @miladycola! 🍾\n\nCan you win my ${tokenTitle}?\n\nZK-powered provably fair NFT challenge`),
          }, '𝕏 Share Your Challenge'),
          h('button', {
            className: 'btn ghost full',
            type: 'button',
            onClick: this.handleClose,
          }, 'Done')
        )
      )
    );
  }

  render() {
    const { stage, error } = this.state;

    let stageContent = null;
    switch (stage) {
      case 'contract':
        stageContent = this.renderContractStage();
        break;
      case 'tokens':
        stageContent = this.renderTokensStage();
        break;
      case 'preview':
        stageContent = this.renderPreviewStage();
        break;
      case 'appraisal':
        stageContent = this.renderAppraisalStage();
        break;
      case 'review':
        stageContent = this.renderReviewStage();
        break;
      case 'pending':
        stageContent = this.renderPendingStage();
        break;
      case 'success':
        stageContent = this.renderSuccessStage();
        break;
    }

    return h('div', { className: 'challenge-wizard__panel' },
      h('div', { className: 'wizard-header' },
        h('div', { className: 'wizard-header__copy' },
          h('h2', null, 'Create Your Challenge'),
          h('p', { className: 'caption' }, 'Bring your collectible, set an appraisal, and let fate decide the victor.')
        ),
        h('button', {
          className: 'icon-btn wizard-header__close',
          type: 'button',
          onClick: this.handleClose,
        }, 'Close')
      ),
      h('div', { className: 'wizard-content' },
        stageContent,
        error && h('p', { className: 'form-error' }, error)
      )
    );
  }
}

export default ChallengeWizard;
