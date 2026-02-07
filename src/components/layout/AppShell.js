import { Component, h, eventBus } from '@monygroupcorp/microact';
import Header from './Header.js';
import HeroSection from './HeroSection.js';
import Dashboard from './Dashboard.js';
import ChallengeGrid from './ChallengeGrid.js';
import WinnersSection from './WinnersSection.js';
import ModalManager from './ModalManager.js';
import cryptoService from '../../services/CryptoService.js';
import nftMetadataService from '../../services/NftMetadataService.js';
import { getStoredPassphrase, getStoredWinResult, storeWinResult, setRevealSeen } from '../ui/EntryModal.js';

// Load fixtures (used as fallback when contracts not available)
import challengesFixture from '../../fixtures/challenges.json';
import bottlesFixture from '../../fixtures/bottles.json';

class AppShell extends Component {
  constructor(props) {
    super(props);

    const useFixtures = props.useFixtures ?? true;

    this.state = {
      challenges: useFixtures ? challengesFixture : [],
      bottles: useFixtures ? bottlesFixture : [],
      refundableChances: [],
      loading: !useFixtures,
      connectedAddress: null,
      numpadInput: '',
    };

    // Refs for imperative child access
    this.dashboardRef = null;
    this.challengeGridRef = null;
  }

  didMount() {
    const useFixtures = this.props.useFixtures ?? true;

    // Initialize NFT metadata service with provider
    if (this.props.contractService?.provider) {
      nftMetadataService.setProvider(this.props.contractService.provider);
    }

    // Load data from contracts if not using fixtures
    if (!useFixtures && this.props.contractService?.initialized) {
      this.loadContractData();
    }

    // Check if wallet is already connected (auto-reconnect happened before mount)
    // Defer setState to avoid sync update before DOM node is attached
    if (this.props.walletService?.isConnected?.()) {
      const address = this.props.walletService.getAddress?.();
      if (address) {
        console.log('[AppShell] Wallet already connected on mount:', address);
        queueMicrotask(() => {
          this.setState({ connectedAddress: address });
          if (this.challengeGridRef) this.challengeGridRef.setConnectedAddress(address);
          if (!useFixtures) {
            this.loadUserData(address);
            this.loadRefundableChances(address);
          }
        });
      }
    }

    // Listen for wallet connection to load user data
    this.subscribe('wallet:connected', async ({ address }) => {
      this.setState({ connectedAddress: address });
      if (this.challengeGridRef) this.challengeGridRef.setConnectedAddress(address);
      if (!useFixtures) {
        await this.loadUserData(address);
        await this.loadRefundableChances(address);
      }
    });

    this.subscribe('wallet:disconnected', () => {
      this.setState({ connectedAddress: null });
      if (this.challengeGridRef) this.challengeGridRef.setConnectedAddress(null);
      if (!useFixtures) {
        // Clear user-specific data but keep challenges
        this.updateBottles([]);
      }
    });

    // Listen for contract events to refresh data
    this.subscribe('contract:gauntlet', () => {
      this.loadContractData();
    });

    this.subscribe('contract:challengeAccepted', () => {
      // Only refresh challenge data here (reads directly from chain).
      // Bottle list refresh is deferred to indexer:newEvents for ChallengeAccepted,
      // which fires after the indexer has actually indexed the new event.
      this.loadContractData();
    });

    this.subscribe('contract:justice', () => {
      console.log('[AppShell] Refund processed, refreshing data');
      if (this.state.connectedAddress) {
        this.loadUserData(this.state.connectedAddress);
        this.loadRefundableChances(this.state.connectedAddress);
      }
    });

    this.subscribe('challenge:created', (data) => {
      if (useFixtures) {
        // Fixtures mode: add a synthetic challenge
        const newChallenge = {
          id: Date.now(),
          title: `Challenge #${this.state.challenges.length + 1}`,
          lore: '',
          nftContract: data.nftContract,
          tokenId: data.tokenId,
          appraisalEth: String(data.appraisal),
          potEth: '0',
          bottlesSold: 0,
          image: `https://www.miladymaker.net/milady/${data.tokenId}.png`,
          status: 'active',
        };
        this.updateChallenges([...this.state.challenges, newChallenge]);
      } else {
        // Live mode: refresh challenges from chain
        console.log('[AppShell] Challenge created, refreshing challenges');
        this.loadContractData();
      }
    });

    this.subscribe('bottle:purchased', (data) => {
      // Handle bottle purchased (for fixtures mode)
      if (useFixtures) {
        const newBottle = {
          id: Date.now(),
          challengeId: data.challenge.id,
          odds: data.odds,
          purchaseTime: Date.now(),
          refrigerationEnds: Date.now() + 15 * 60 * 1000, // 15 minutes
          status: 'refrigerating',
        };
        this.updateBottles([...this.state.bottles, newBottle]);
      }
    });

    // Handle claim submission from ClaimModal
    this.subscribe('claim:submit', async ({ bottle, passphrase }) => {
      await this.handleClaim(bottle, passphrase);
    });

    // Handle challenge cancellation
    this.subscribe('challenge:cancel', async ({ challengeId }) => {
      await this.handleCancelChallenge(challengeId);
    });

    // Listen for new indexed events to refresh UI in real-time
    this.subscribe('indexer:newEvents', async ({ eventType }) => {
      if (eventType === 'Victor' || eventType === 'Surrender' || eventType === 'Gauntlet') {
        console.log(`[AppShell] ${eventType} event indexed, refreshing data`);
        this.loadContractData();
        if (this.state.connectedAddress) {
          this.loadUserData(this.state.connectedAddress);
          this.loadRefundableChances(this.state.connectedAddress);
        }
      } else if (eventType === 'ChallengeAccepted') {
        // New ticket indexed — refresh challenges first so bottle titles resolve,
        // then refresh bottles
        console.log('[AppShell] ChallengeAccepted indexed, refreshing challenges then bottles');
        await this.loadContractData();
        if (this.state.connectedAddress) {
          this.loadUserData(this.state.connectedAddress);
        }
      }
    });

    // Dashboard manual refresh button
    this.subscribe('dashboard:refresh', () => {
      if (this.state.connectedAddress) {
        this.loadUserData(this.state.connectedAddress);
        this.loadRefundableChances(this.state.connectedAddress);
      }
    });

    // Listen for ColasseumIndexer ready to load data
    // (indexer initializes in background after app mounts)
    this.subscribe('colasseum:indexerReady', () => {
      console.log('[AppShell] ColasseumIndexer ready, loading challenges');
      console.log('[AppShell] Current connectedAddress:', this.state.connectedAddress);
      this.loadContractData();
      if (this.state.connectedAddress) {
        console.log('[AppShell] Loading user data for connected address');
        this.loadRefundableChances(this.state.connectedAddress);
        this.loadUserData(this.state.connectedAddress);
      } else {
        console.log('[AppShell] No connected address yet, skipping user data load');
      }
    });

    // Safety timeout: stop showing spinner after 30s even if indexer never fires
    if (!useFixtures) {
      this._loadingTimeout = setTimeout(() => {
        if (this.state.loading) {
          console.warn('[AppShell] Loading timeout reached, giving up');
          this.setState({ loading: false });
        }
      }, 30000);
    }

    // Parallax background scroll effect
    const parallaxRate = 0.3; // Background scrolls at 30% of content scroll
    const handleParallax = () => {
      const scrollY = window.scrollY || window.pageYOffset;
      document.documentElement.style.setProperty('--parallax-y', `${scrollY * parallaxRate}px`);
    };
    window.addEventListener('scroll', handleParallax, { passive: true });
    handleParallax(); // Initialize
  }

  /**
   * Handle claim submission - generate ZK proof and claim prize
   * @param {Object} bottle - Bottle data
   * @param {string} passphrase - User's passphrase from ClaimModal
   */
  async handleClaim(bottle, passphrase) {
    if (!this.props.contractService?.initialized) {
      console.error('[AppShell] Contract service not initialized');
      eventBus.emit('claim:status', { status: '', error: 'Contract service not available' });
      return;
    }

    const ownerAddress = this.state.connectedAddress;
    if (!ownerAddress) {
      console.error('[AppShell] No wallet connected');
      eventBus.emit('claim:status', { status: '', error: 'Please connect your wallet' });
      return;
    }

    if (!passphrase) {
      eventBus.emit('claim:status', { status: '', error: 'Passphrase is required' });
      return;
    }

    try {
      console.log('[AppShell] Starting claim for bottle', bottle.id, bottle);

      // STEP 1: Verify passphrase matches commitment (fast fail for wrong passphrase)
      eventBus.emit('claim:status', { status: 'verifying' });
      const expectedCommitment = await cryptoService.generateCommitment(passphrase, ownerAddress);
      if (expectedCommitment !== bottle.commitment) {
        console.error('[AppShell] Passphrase does not match commitment');
        eventBus.emit('claim:status', {
          status: '',
          error: 'Passphrase does not match this bottle. Please check and try again.',
        });
        return;
      }
      console.log('[AppShell] Passphrase verified - commitment matches');

      // STEP 2: Get beacon root using slot-search algorithm (matches contract's _findCanonicalBeaconRoot)
      eventBus.emit('claim:status', { status: 'generating' });
      console.log('[AppShell] Finding canonical beacon root for timestamp:', bottle.targetTimestamp);

      let beaconRoot;
      let canonicalTimestamp;
      if (this.props.devService?.isEnabled() && this.props.devService.oracleSeed) {
        // DEV MODE with seed: Use DevService to warp time and derive root locally
        console.log('[AppShell] Using DevService for beacon root (dev mode with seed)');
        canonicalTimestamp = bottle.targetTimestamp;
        beaconRoot = await this.props.devService.prepareForClaim(
          bottle.targetTimestamp,
          768, // SAFETY_DELAY
          async () => {
            const result = await this.props.contractService.findCanonicalBeaconRoot(bottle.targetTimestamp);
            canonicalTimestamp = result.timestamp;
            return result.root;
          }
        );
      } else {
        // PRODUCTION or dev without seed: Find canonical beacon root by searching blocks
        console.log('[AppShell] Finding canonical beacon root from real blocks');
        const result = await this.props.contractService.findCanonicalBeaconRoot(bottle.targetTimestamp);
        beaconRoot = result.root;
        canonicalTimestamp = result.timestamp;
      }

      console.log('[AppShell] Canonical beacon root:', beaconRoot, 'at timestamp:', canonicalTimestamp);
      if (!beaconRoot || beaconRoot === '0x' + '0'.repeat(64)) {
        console.error('[AppShell] No beacon root available');
        eventBus.emit('claim:status', { status: '', error: 'Randomness not available yet. Please wait for cooldown.' });
        return;
      }

      // STEP 3: Generate ZK proof
      console.log('[AppShell] Generating ZK proof with inputs:', {
        passphrase: '(hidden)',
        ownerAddress,
        beaconRoot,
        commitment: bottle.commitment,
        difficulty: bottle.difficulty,
        numChances: bottle.numChances,
      });

      const { solidityProof } = await cryptoService.generateProof(
        passphrase,
        ownerAddress,
        beaconRoot,
        bottle.commitment,
        bottle.difficulty,
        bottle.numChances
      );

      console.log('[AppShell] Proof generated:', solidityProof);

      // STEP 4: Submit claim transaction (victory)
      eventBus.emit('claim:status', { status: 'claiming' });
      const receipt = await this.props.contractService.victory(bottle.id, canonicalTimestamp, solidityProof);

      console.log('[AppShell] Claim successful:', receipt);
      eventBus.emit('claim:status', { status: 'success' });

      // Refresh user data
      await this.loadUserData(ownerAddress);

    } catch (error) {
      console.error('[AppShell] Claim failed:', error);
      eventBus.emit('claim:status', { status: '', error: error.message });
    }
  }

  /**
   * Handle challenge cancellation
   * @param {number} challengeId - Challenge/Draw ID to cancel
   */
  async handleCancelChallenge(challengeId) {
    if (!this.props.contractService?.initialized) {
      console.error('[AppShell] Contract service not initialized');
      return;
    }

    try {
      console.log('[AppShell] Cancelling challenge', challengeId);
      await this.props.contractService.cowardice(challengeId);
      console.log('[AppShell] Challenge cancelled successfully');

      // Refresh challenges to update UI
      await this.loadContractData();

      // Emit event for any listeners (e.g., to reset cancel confirm state)
      eventBus.emit('challenge:cancelled', { challengeId });
    } catch (error) {
      console.error('[AppShell] Failed to cancel challenge:', error);
      eventBus.emit('challenge:cancelError', { challengeId, error: error.message });
    }
  }

  async loadContractData() {
    if (!this.props.colasseumIndexer?.initialized || !this.props.contractService?.initialized) {
      // Services not ready yet — keep loading spinner visible.
      // Data will load when 'colasseum:indexerReady' fires.
      return;
    }

    try {
      this.setState({ loading: true });

      // Get active trials from indexer (event-based)
      const activeTrialEvents = await this.props.colasseumIndexer.getActiveTrials();

      // Fetch current on-chain state for each trial (for ethPool, etc.)
      const trialIds = activeTrialEvents.map(e =>
        typeof e.trialId === 'object' ? e.trialId.toNumber() : Number(e.trialId)
      );
      const trials = await this.props.contractService.getTrials(trialIds);

      // Count entries (ChallengeAccepted events) per trial
      const entryCountByTrial = new Map();
      try {
        const allEntries = await this.props.colasseumIndexer.indexer.events.query('ChallengeAccepted', { limit: 10000 });
        for (const event of allEntries.events) {
          const trialId = String(event.indexed?.trialId || event.data?.trialId);
          entryCountByTrial.set(trialId, (entryCountByTrial.get(trialId) || 0) + 1);
        }
      } catch (err) {
        console.warn('[AppShell] Could not count entries:', err.message);
      }

      // Transform to UI format and fetch NFT images
      const challenges = await Promise.all(trials.map(async trial => {
        const numEntries = entryCountByTrial.get(String(trial.id)) || 0;

        // Fetch NFT metadata for image and title
        let image = '';
        let nftTitle = `Challenge #${trial.id}`;
        try {
          const metadata = await nftMetadataService.getMetadata(trial.nftContract, trial.nftId);
          if (metadata?.image) {
            image = metadata.image;
          }
          if (metadata?.name) {
            nftTitle = metadata.name;
          }
        } catch (err) {
          console.warn('[AppShell] Could not fetch NFT metadata for trial', trial.id, err.message);
        }

        return {
          id: trial.id,
          title: nftTitle,
          lore: trial.lore || '',
          nftContract: trial.nftContract,
          tokenId: trial.nftId,
          appraisalEth: this.calculateAppraisalFromDifficulty(trial.difficulty),
          difficulty: trial.difficulty,
          potEth: trial.ethPool,
          bottlesSold: numEntries,
          image,
          creator: trial.creator,
          creationTime: trial.creationTime,
          status: trial.active ? 'active' : (trial.cancelled ? 'cancelled' : 'ended'),
        };
      }));

      this.updateChallenges(challenges);
      if (this._loadingTimeout) clearTimeout(this._loadingTimeout);
      this.setState({ loading: false });
    } catch (error) {
      console.error('[AppShell] Failed to load contract data:', error);
      if (this._loadingTimeout) clearTimeout(this._loadingTimeout);
      this.setState({ loading: false });
    }
  }

  /**
   * Load refundable chances for a user using the event indexer.
   * @param {string} address - User's wallet address
   */
  async loadRefundableChances(address) {
    if (!this.props.colasseumIndexer?.initialized) return;

    try {
      const refundable = await this.props.colasseumIndexer.getRefundableChances(address);
      this.setState({ refundableChances: refundable });

      if (refundable.length > 0) {
        console.log(`[AppShell] Found ${refundable.length} refundable chances for ${address}`);
        // Emit event for UI notification
        eventBus.emit('refundable:found', { count: refundable.length, chances: refundable });
      }
    } catch (error) {
      console.error('[AppShell] Failed to load refundable chances:', error);
    }
  }

  async loadUserData(address) {
    if (!this.props.colasseumIndexer?.initialized || !this.props.contractService?.initialized) {
      console.log('[AppShell] loadUserData skipped - services not ready', {
        indexerReady: this.props.colasseumIndexer?.initialized,
        contractReady: this.props.contractService?.initialized
      });
      return;
    }

    try {
      console.log('[AppShell] loadUserData starting for:', address);
      // Get user's chances from indexer (event-based), including claimed ones
      const chanceEvents = await this.props.colasseumIndexer.getUserChances(address, { includeClaimed: true });
      console.log('[AppShell] getUserChances returned:', chanceEvents.length, 'events');

      // Fetch current on-chain state for each chance
      const chanceIds = chanceEvents.map(e =>
        typeof e.chanceId === 'object' ? e.chanceId.toNumber() : Number(e.chanceId)
      );
      const chances = await this.props.contractService.getChances(chanceIds);

      // Transform chances to bottles format
      const bottles = await Promise.all(
        chances
          .filter(c => !c.refunded)
          .map(async chance => {
            // Get trial data to calculate odds correctly
            const trial = await this.props.contractService.getTrial(chance.trialId);
            const challenge = this.state.challenges.find(c => c.id === chance.trialId);

            // Resolve title: prefer challenge state, fall back to NFT metadata
            let challengeTitle = challenge?.title;
            if (!challengeTitle) {
              try {
                const metadata = await nftMetadataService.getMetadata(trial.nftContract, trial.nftId);
                challengeTitle = metadata?.name || `Challenge #${chance.trialId}`;
              } catch {
                challengeTitle = `Challenge #${chance.trialId}`;
              }
            }

            // Calculate odds: (numChances * difficulty / MAX_HASH) * 100
            const odds = this.calculateOddsFromChancesAndDifficulty(
              chance.numChances,
              trial.difficulty
            );

            // Calculate price paid
            const FIXED_CHANCE_PRICE = 0.000000001; // 1 gwei in ETH
            const priceEth = (chance.numChances * FIXED_CHANCE_PRICE).toFixed(4);

            // Calculate cooldown remaining
            const now = Math.floor(Date.now() / 1000);
            const safetyDelay = 768;
            const cooldownEnd = chance.targetTimestamp + safetyDelay;
            const cooldownRemaining = Math.max(0, cooldownEnd - now);

            // Check if we already have a stored result
            let result = null;
            const storedResult = getStoredWinResult(chance.id);
            if (chance.claimed) {
              // Claimed chances are always wins
              result = 'win';
            } else if (storedResult !== null) {
              result = storedResult ? 'win' : 'loss';
            }
            // Evaluate win condition for cooled bottles that don't have a stored result
            else if (cooldownRemaining <= 0) {
              try {
                const evaluated = await this.evaluateChanceOutcome(chance, trial, address);
                if (evaluated !== null) {
                  result = evaluated ? 'win' : 'loss';
                  storeWinResult(chance.id, evaluated);
                  setRevealSeen(chance.id);
                }
              } catch (evalError) {
                console.warn('[AppShell] Could not evaluate chance outcome:', evalError.message);
              }
            }

            return {
              id: chance.id,
              challengeId: chance.trialId,
              challengeTitle,
              odds,
              priceEth,
              prizeEth: challenge?.appraisalEth || '0',
              purchaseTime: 0, // Not stored on chain, would need events
              refrigerationEnds: cooldownEnd * 1000,
              cooldownRemaining,
              status: this.getBottleStatus(chance),
              commitment: chance.commitment,
              targetTimestamp: chance.targetTimestamp,
              numChances: chance.numChances,
              claimed: chance.claimed,
              difficulty: trial.difficulty.toString(),
              result, // Pre-evaluated result if available
            };
          })
      );

      console.log('[AppShell] Updating bottles, count:', bottles.length);
      this.updateBottles(bottles);
    } catch (error) {
      console.error('[AppShell] Failed to load user data:', error);
    }
  }

  /**
   * Evaluate chance outcome using real ZK crypto
   * @param {Object} chance - Chance data from contract
   * @param {Object} trial - Trial data from contract
   * @param {string} ownerAddress - Owner's wallet address
   * @returns {Promise<boolean|null>} true=win, false=loss, null=can't evaluate
   */
  async evaluateChanceOutcome(chance, trial, ownerAddress) {
    // Get stored passphrase
    const passphrase = getStoredPassphrase(chance.id);
    if (!passphrase) {
      console.log('[AppShell] No passphrase stored for chance', chance.id);
      return null;
    }

    // Check if randomness is available (time-based check)
    const isAvailable = await this.props.contractService.isRandomnessAvailable(chance.targetTimestamp);
    if (!isAvailable) {
      console.log('[AppShell] Randomness not yet available for chance', chance.id);
      return null;
    }

    // Find canonical beacon root by searching actual blocks
    const { root: beaconRoot, timestamp: canonicalTimestamp } =
      await this.props.contractService.findCanonicalBeaconRoot(chance.targetTimestamp);

    if (!beaconRoot || beaconRoot === '0x' + '0'.repeat(64)) {
      console.log('[AppShell] No beacon root for chance', chance.id);
      return null;
    }

    console.log('[AppShell] Found beacon root at timestamp', canonicalTimestamp, 'for chance', chance.id);

    // Evaluate using CryptoService
    const { isWinner, randomnessHash, threshold } = await cryptoService.evaluateWinCondition(
      passphrase,
      beaconRoot,
      trial.difficulty,
      chance.numChances
    );

    console.log('[AppShell] Evaluated chance', chance.id, {
      isWinner,
      randomnessHash,
      threshold,
    });

    return isWinner;
  }

  calculateAppraisalFromDifficulty(difficulty) {
    // Reverse the formula: difficulty = (MAX_HASH / appraisal) * FIXED_TICKET_PRICE
    // appraisal = (MAX_HASH * FIXED_TICKET_PRICE) / difficulty
    const MAX_HASH = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
    const FIXED_TICKET_PRICE = BigInt('1000000000'); // 0.000000001 ETH in wei

    try {
      const diffBigInt = BigInt(difficulty);
      if (diffBigInt === 0n) return '0';

      const appraisalWei = (MAX_HASH * FIXED_TICKET_PRICE) / diffBigInt;
      // Convert wei to ETH (divide by 10^18)
      const appraisalEth = Number(appraisalWei) / 1e18;
      return appraisalEth.toFixed(4);
    } catch {
      return '0';
    }
  }

  calculateOddsFromChancesAndDifficulty(numChances, difficulty) {
    // odds = (numChances * difficulty / MAX_HASH) * 100
    const MAX_HASH = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

    try {
      const chancesBigInt = BigInt(numChances);
      const diffBigInt = BigInt(difficulty);

      // Calculate (numChances * difficulty * 100) / MAX_HASH
      const oddsNumerator = chancesBigInt * diffBigInt * 100n;
      const oddsBigInt = oddsNumerator / MAX_HASH;

      // Cap at 99% for display
      const odds = Number(oddsBigInt);
      return Math.min(odds, 99);
    } catch {
      return 1;
    }
  }

  getBottleStatus(ticket) {
    const now = Math.floor(Date.now() / 1000);
    const safetyDelay = 768; // ~12.8 minutes

    if (ticket.claimed) return 'claimed';
    if (ticket.refunded) return 'refunded';

    if (now < ticket.targetTimestamp + safetyDelay) {
      return 'cooling'; // BottleCard expects 'cooling' not 'refrigerating'
    }

    return 'ready';
  }

  updateChallenges(challenges) {
    this.setState({ challenges });
    if (this.challengeGridRef) this.challengeGridRef.setChallenges(challenges);
  }

  updateBottles(bottles) {
    this.setState({ bottles });
    if (this.dashboardRef) this.dashboardRef.setBottles(bottles);
  }

  render() {
    const connectedAddress = this.state.connectedAddress;
    const displayAddress = connectedAddress
      ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`
      : 'NOT CONNECTED';

    return h('div', { className: 'app-shell' },
      h('div', { className: 'vending-machine' },
        // Brand panel (logo) with winner stickers
        h('div', { className: 'machine-brand-panel' },
          h('h1', { 'data-text': 'MILADYCOLA' }, 'MILADYCOLA'),
          h('p', { className: 'tagline' }, 'Insert coin • Select prize • Test your luck'),
          // Winner stickers (vandalism on the brand panel)
          h(WinnersSection, {
            colasseumIndexer: this.props.colasseumIndexer,
            contractService: this.props.contractService,
            asStickers: true,
          })
        ),

        // Display window (products behind glass)
        h('div', { className: 'machine-display' },
          this.state.loading && h('div', { className: 'machine-loading' },
            h('div', { className: 'machine-loading__spinner' }),
            h('span', null, 'Loading prizes...')
          ),
          h(ChallengeGrid, {
            ref: (inst) => { this.challengeGridRef = inst; },
            challenges: this.state.challenges,
            contractService: this.props.contractService,
            asProductGrid: true,
            loading: this.state.loading,
          })
        ),

        // Control panel
        h('div', { className: 'machine-controls' },
          // Numpad
          h('div', { className: 'numpad' },
            h('div', { className: 'numpad__display' },
              h('span', { className: `numpad__display-text ${this.state.numpadInput ? 'numpad__display-text--input' : ''}` },
                this.state.numpadInput
                  ? `SELECT: ${this.state.numpadInput.toUpperCase()}_`
                  : (connectedAddress
                      ? `WALLET: ${connectedAddress}`
                      : '>>> CONNECT WALLET TO PLAY <<<')
              )
            ),
            h('div', { className: 'numpad__letters' },
              ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((keyVal) =>
                h('button', {
                  className: 'numpad__btn numpad__btn--letter',
                  onClick: () => this.handleNumpadPress(keyVal),
                }, keyVal)
              )
            ),
            h('div', { className: 'numpad__numbers' },
              ['1', '2', '3', '4', '5', '6', '7', '8', '9', '✕', '0', '✓'].map((keyVal) =>
                h('button', {
                  className: `numpad__btn ${keyVal === '✓' ? 'numpad__btn--action' : ''} ${keyVal === '✕' ? 'numpad__btn--clear' : ''}`,
                  onClick: () => this.handleNumpadPress(keyVal),
                }, keyVal)
              )
            )
          ),

          // Info panel
          h('div', { className: 'machine-info' },
            h(Header, { walletService: this.props.walletService, compact: true }),
            h('div', { className: 'machine-info__actions' },
              h('button', {
                className: 'btn primary small',
                type: 'button',
                disabled: !connectedAddress,
                onClick: () => eventBus.emit('modal:open', { modal: 'challengeWizard' }),
              }, '+ Stock Prize'),
              h('button', {
                className: 'btn ghost small',
                type: 'button',
                onClick: () => window.open('/docs.html', '_blank', 'noopener'),
              }, '? Docs')
            ),
            h('div', { className: 'machine-info__stats' },
              h('div', { className: 'machine-info__stat' },
                h('span', { className: 'machine-info__stat-label' }, 'Your Total'),
                h('span', { className: 'machine-info__stat-value' }, this.state.bottles.length)
              ),
              h('div', { className: 'machine-info__stat' },
                h('span', { className: 'machine-info__stat-label' }, 'Your Live'),
                h('span', { className: 'machine-info__stat-value' }, this.state.bottles.filter(b => b.status === 'active').length)
              ),
              h('div', { className: 'machine-info__stat' },
                h('span', { className: 'machine-info__stat-label' }, 'Your Wins'),
                h('span', { className: 'machine-info__stat-value' }, this.state.bottles.filter(b => b.status === 'won').length)
              ),
              h('div', { className: 'machine-info__stat' },
                h('span', { className: 'machine-info__stat-label' }, 'Total Prizes'),
                h('span', { className: 'machine-info__stat-value' }, this.state.challenges.length)
              )
            )
          )
        ),

        // Dispense slot (your bottles)
        h('div', { className: 'dispense-slot' },
          h('div', { className: 'dispense-slot__header' },
            h('div', { className: 'dispense-slot__label' }, '▼ Dispense Tray ▼'),
            h('button', {
              className: 'btn ghost small dispense-slot__refresh',
              type: 'button',
              onClick: () => eventBus.emit('dashboard:refresh'),
            }, 'Refresh')
          ),
          h(Dashboard, {
            ref: (inst) => { this.dashboardRef = inst; },
            bottles: this.state.bottles,
            contractService: this.props.contractService,
            compact: true,
          })
        ),

        // Footer
        h('footer', { className: 'machine-footer' },
          h('a', {
            className: 'social-pill',
            href: 'https://x.com/miladycola',
            target: '_blank',
            rel: 'noreferrer',
            'aria-label': 'MiladyCola on X',
          },
            h('span', null, '𝕏')
          ),
          h('a', {
            className: 'social-pill',
            href: 'https://github.com/lifehaverdev/miladycola',
            target: '_blank',
            rel: 'noreferrer',
            'aria-label': 'MiladyCola on GitHub',
          },
            h('span', { className: 'github-icon', 'aria-hidden': 'true' })
          )
        )
      ),

      h(ModalManager, {
        walletService: this.props.walletService,
        contractService: this.props.contractService,
        challenges: this.state.challenges,
      })
    );
  }

  // Convert slot code (e.g., "A1") to challenge index
  slotCodeToIndex(code) {
    if (!code || code.length < 2) return -1;
    const letter = code[0].toUpperCase();
    const number = parseInt(code.slice(1), 10);
    if (letter < 'A' || letter > 'J' || isNaN(number) || number < 1 || number > 3) {
      return -1;
    }
    const row = letter.charCodeAt(0) - 65; // A=0, B=1, etc.
    const col = number - 1; // 1->0, 2->1, etc.
    return row * 3 + col;
  }

  // Get challenges sorted by highest ETH pot (same order as display)
  getSortedChallenges() {
    return [...this.state.challenges].sort((a, b) => {
      const aEth = parseFloat(a.appraisalEth) || 0;
      const bEth = parseFloat(b.appraisalEth) || 0;
      return bEth - aEth;
    });
  }

  handleNumpadPress(key) {
    const { numpadInput, challenges } = this.state;

    if (key === '✓') {
      // Confirm selection - find challenge and open modal
      if (numpadInput.length >= 2) {
        const sortedChallenges = this.getSortedChallenges();
        const index = this.slotCodeToIndex(numpadInput);
        if (index >= 0 && index < sortedChallenges.length) {
          const challenge = sortedChallenges[index];
          if (challenge.status === 'active') {
            eventBus.emit('modal:open', {
              modal: 'entry',
              challenge,
              slotIndex: numpadInput.toUpperCase(),
            });
          }
        }
      }
      // Clear input after confirm attempt
      this.setState({ numpadInput: '' });
    } else if (key === '✕') {
      // Clear selection
      this.setState({ numpadInput: '' });
    } else {
      // Build selection - max 3 chars (e.g., "A12" for future expansion)
      if (numpadInput.length < 3) {
        this.setState({ numpadInput: numpadInput + key });
      }
    }
  }
}

export default AppShell;
