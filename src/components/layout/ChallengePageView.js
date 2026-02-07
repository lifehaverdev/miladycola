import { Component, h, eventBus } from '@monygroupcorp/microact';
import ChallengeHeader from './ChallengeHeader.js';
import ModalManager from './ModalManager.js';
import Dashboard from './Dashboard.js';
import WinnersSection from './WinnersSection.js';
import ChallengeCard from '../ui/ChallengeCard.js';
import cryptoService from '../../services/CryptoService.js';
import nftMetadataService from '../../services/NftMetadataService.js';
import { getStoredPassphrase, getStoredWinResult, storeWinResult, setRevealSeen } from '../ui/EntryModal.js';

class ChallengePageView extends Component {
  constructor(props) {
    super(props);
    this.state = {
      challenge: null,
      bottles: [],
      loading: true,
      error: null,
      connectedAddress: null,
    };
    this.dashboardRef = null;
  }

  didMount() {
    // Initialize NFT metadata service
    if (this.props.contractService?.provider) {
      nftMetadataService.setProvider(this.props.contractService.provider);
    }

    // Check if wallet already connected
    if (this.props.walletService?.isConnected?.()) {
      const address = this.props.walletService.getAddress?.();
      if (address) {
        queueMicrotask(() => {
          this.setState({ connectedAddress: address });
          this.loadUserBottles(address);
        });
      }
    }

    // Listen for wallet events
    this.subscribe('wallet:connected', async ({ address }) => {
      this.setState({ connectedAddress: address });
      await this.loadUserBottles(address);
    });

    this.subscribe('wallet:disconnected', () => {
      this.setState({ connectedAddress: null, bottles: [] });
    });

    // Handle claim submission
    this.subscribe('claim:submit', async ({ bottle, passphrase }) => {
      await this.handleClaim(bottle, passphrase);
    });

    // Listen for new indexed events
    this.subscribe('indexer:newEvents', async ({ eventType }) => {
      if (eventType === 'ChallengeAccepted' || eventType === 'Victor' || eventType === 'Surrender') {
        await this.loadChallenge();
        if (this.state.connectedAddress) {
          await this.loadUserBottles(this.state.connectedAddress);
        }
      }
    });

    // Listen for ColasseumIndexer ready
    this.subscribe('colasseum:indexerReady', () => {
      this.loadChallenge();
      if (this.state.connectedAddress) {
        this.loadUserBottles(this.state.connectedAddress);
      }
    });

    // Load challenge data
    this.loadChallenge();
  }

  async loadChallenge() {
    const { challengeId, contractService, colasseumIndexer } = this.props;

    if (!contractService?.initialized) {
      this.setState({ loading: false, error: 'Contract service not available' });
      return;
    }

    try {
      this.setState({ loading: true, error: null });

      const trial = await contractService.getTrial(parseInt(challengeId, 10));
      if (!trial) {
        this.setState({ loading: false, error: 'Challenge not found' });
        return;
      }

      // Count entries for this trial
      let numEntries = 0;
      if (colasseumIndexer?.initialized) {
        try {
          const entries = await colasseumIndexer.indexer.events.query('ChallengeAccepted', {
            where: { trialId: challengeId },
            limit: 10000,
          });
          numEntries = entries.events.length;
        } catch (err) {
          console.warn('[ChallengePageView] Could not count entries:', err.message);
        }
      }

      // Fetch NFT metadata
      let image = '';
      let nftTitle = `Challenge #${trial.id}`;
      try {
        const metadata = await nftMetadataService.getMetadata(trial.nftContract, trial.nftId);
        if (metadata?.image) image = metadata.image;
        if (metadata?.name) nftTitle = metadata.name;
      } catch (err) {
        console.warn('[ChallengePageView] Could not fetch NFT metadata:', err.message);
      }

      const challenge = {
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

      this.setState({ challenge, loading: false });
    } catch (error) {
      console.error('[ChallengePageView] Failed to load challenge:', error);
      this.setState({ loading: false, error: error.message });
    }
  }

  async loadUserBottles(address) {
    const { challengeId, contractService, colasseumIndexer } = this.props;

    if (!colasseumIndexer?.initialized || !contractService?.initialized) return;

    try {
      // Get user's chances for this challenge only
      const chanceEvents = await colasseumIndexer.getUserChances(address, { includeClaimed: true });
      const chanceIds = chanceEvents
        .filter(e => String(e.trialId) === String(challengeId))
        .map(e => typeof e.chanceId === 'object' ? e.chanceId.toNumber() : Number(e.chanceId));

      if (chanceIds.length === 0) {
        this.setState({ bottles: [] });
        return;
      }

      const chances = await contractService.getChances(chanceIds);
      const trial = await contractService.getTrial(parseInt(challengeId, 10));

      const bottles = await Promise.all(
        chances
          .filter(c => !c.refunded)
          .map(async chance => {
            const odds = this.calculateOddsFromChancesAndDifficulty(chance.numChances, trial.difficulty);
            const FIXED_CHANCE_PRICE = 0.000000001;
            const priceEth = (chance.numChances * FIXED_CHANCE_PRICE).toFixed(4);

            const now = Math.floor(Date.now() / 1000);
            const safetyDelay = 768;
            const cooldownEnd = chance.targetTimestamp + safetyDelay;
            const cooldownRemaining = Math.max(0, cooldownEnd - now);

            let result = null;
            const storedResult = getStoredWinResult(chance.id);
            if (chance.claimed) {
              result = 'win';
            } else if (storedResult !== null) {
              result = storedResult ? 'win' : 'loss';
            } else if (cooldownRemaining <= 0) {
              try {
                const evaluated = await this.evaluateChanceOutcome(chance, trial, address);
                if (evaluated !== null) {
                  result = evaluated ? 'win' : 'loss';
                  storeWinResult(chance.id, evaluated);
                  setRevealSeen(chance.id);
                }
              } catch (evalError) {
                console.warn('[ChallengePageView] Could not evaluate chance:', evalError.message);
              }
            }

            return {
              id: chance.id,
              challengeId: chance.trialId,
              challengeTitle: this.state.challenge?.title || `Challenge #${chance.trialId}`,
              odds,
              priceEth,
              purchaseTime: 0,
              refrigerationEnds: cooldownEnd * 1000,
              cooldownRemaining,
              status: this.getBottleStatus(chance),
              commitment: chance.commitment,
              targetTimestamp: chance.targetTimestamp,
              numChances: chance.numChances,
              claimed: chance.claimed,
              difficulty: trial.difficulty.toString(),
              result,
            };
          })
      );

      this.setState({ bottles });
      if (this.dashboardRef) this.dashboardRef.setBottles(bottles);
    } catch (error) {
      console.error('[ChallengePageView] Failed to load user bottles:', error);
    }
  }

  async evaluateChanceOutcome(chance, trial, ownerAddress) {
    const passphrase = getStoredPassphrase(chance.id);
    if (!passphrase) return null;

    const isAvailable = await this.props.contractService.isRandomnessAvailable(chance.targetTimestamp);
    if (!isAvailable) return null;

    // Find canonical beacon root by searching actual blocks
    const { root: beaconRoot } = await this.props.contractService.findCanonicalBeaconRoot(chance.targetTimestamp);
    if (!beaconRoot || beaconRoot === '0x' + '0'.repeat(64)) return null;

    const { isWinner } = await cryptoService.evaluateWinCondition(
      passphrase,
      beaconRoot,
      trial.difficulty,
      chance.numChances
    );

    return isWinner;
  }

  async handleClaim(bottle, passphrase) {
    const { contractService, devService } = this.props;
    const ownerAddress = this.state.connectedAddress;

    if (!contractService?.initialized) {
      eventBus.emit('claim:status', { status: '', error: 'Contract service not available' });
      return;
    }

    if (!ownerAddress) {
      eventBus.emit('claim:status', { status: '', error: 'Please connect your wallet' });
      return;
    }

    if (!passphrase) {
      eventBus.emit('claim:status', { status: '', error: 'Passphrase is required' });
      return;
    }

    try {
      eventBus.emit('claim:status', { status: 'verifying' });
      const expectedCommitment = await cryptoService.generateCommitment(passphrase, ownerAddress);
      if (expectedCommitment !== bottle.commitment) {
        eventBus.emit('claim:status', { status: '', error: 'Passphrase does not match this bottle.' });
        return;
      }

      eventBus.emit('claim:status', { status: 'generating' });

      // Find canonical beacon root by searching actual blocks
      let beaconRoot;
      let beaconTimestamp;
      if (devService?.isEnabled() && devService.oracleSeed) {
        // Dev mode with seed: mock oracle accepts any timestamp
        console.log('[ChallengePageView] Using DevService for beacon root (dev mode with seed)');
        beaconTimestamp = bottle.targetTimestamp;
        beaconRoot = await devService.prepareForClaim(
          bottle.targetTimestamp,
          768,
          async () => {
            const result = await contractService.findCanonicalBeaconRoot(bottle.targetTimestamp);
            beaconTimestamp = result.timestamp;
            return result.root;
          }
        );
      } else {
        // Production or dev without seed: search for real block timestamps
        console.log('[ChallengePageView] Finding canonical beacon root from real blocks');
        const result = await contractService.findCanonicalBeaconRoot(bottle.targetTimestamp);
        beaconRoot = result.root;
        beaconTimestamp = result.timestamp;
        console.log('[ChallengePageView] Found canonical beacon root at timestamp:', beaconTimestamp);
      }

      if (!beaconRoot || beaconRoot === '0x' + '0'.repeat(64)) {
        eventBus.emit('claim:status', { status: '', error: 'Randomness not available yet.' });
        return;
      }

      const { solidityProof } = await cryptoService.generateProof(
        passphrase,
        ownerAddress,
        beaconRoot,
        bottle.commitment,
        bottle.difficulty,
        bottle.numChances
      );

      eventBus.emit('claim:status', { status: 'claiming' });
      await contractService.victory(bottle.id, beaconTimestamp, solidityProof);

      eventBus.emit('claim:status', { status: 'success' });
      await this.loadUserBottles(ownerAddress);
    } catch (error) {
      console.error('[ChallengePageView] Claim failed:', error);
      eventBus.emit('claim:status', { status: '', error: error.message });
    }
  }

  calculateAppraisalFromDifficulty(difficulty) {
    const MAX_HASH = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
    const FIXED_TICKET_PRICE = BigInt('1000000000');
    try {
      const diffBigInt = BigInt(difficulty);
      if (diffBigInt === 0n) return '0';
      const appraisalWei = (MAX_HASH * FIXED_TICKET_PRICE) / diffBigInt;
      const appraisalEth = Number(appraisalWei) / 1e18;
      return appraisalEth.toFixed(4);
    } catch {
      return '0';
    }
  }

  calculateOddsFromChancesAndDifficulty(numChances, difficulty) {
    const MAX_HASH = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
    try {
      const chancesBigInt = BigInt(numChances);
      const diffBigInt = BigInt(difficulty);
      const oddsNumerator = chancesBigInt * diffBigInt * 100n;
      const oddsBigInt = oddsNumerator / MAX_HASH;
      const odds = Number(oddsBigInt);
      return Math.min(odds, 99);
    } catch {
      return 1;
    }
  }

  getBottleStatus(ticket) {
    const now = Math.floor(Date.now() / 1000);
    const safetyDelay = 768;
    if (ticket.claimed) return 'claimed';
    if (ticket.refunded) return 'refunded';
    if (now < ticket.targetTimestamp + safetyDelay) return 'cooling';
    return 'ready';
  }

  render() {
    const { challenge, bottles, loading, error, connectedAddress } = this.state;
    const { walletService, contractService, router } = this.props;

    const handleHomeClick = () => {
      const base = window.location.pathname.startsWith('/miladycolav4') ? '/miladycolav4/' : '/';
      router.navigate(base);
    };

    if (loading) {
      return h('div', { className: 'app-shell challenge-page' },
        h(ChallengeHeader, { walletService, onHomeClick: handleHomeClick }),
        h('main', { className: 'app-main challenge-page__main' },
          h('div', { className: 'challenge-page__loading' },
            h('p', { className: 'muted' }, 'Loading challenge...')
          )
        )
      );
    }

    if (error || !challenge) {
      return h('div', { className: 'app-shell challenge-page' },
        h(ChallengeHeader, { walletService, onHomeClick: handleHomeClick }),
        h('main', { className: 'app-main challenge-page__main' },
          h('div', { className: 'challenge-page__error' },
            h('h2', null, 'Challenge Not Found'),
            h('p', { className: 'muted' }, error || 'This challenge does not exist.'),
            h('button', {
              className: 'btn primary',
              type: 'button',
              onClick: handleHomeClick,
            }, 'Back to Home')
          )
        )
      );
    }

    const userBottlesForChallenge = bottles.filter(b => String(b.challengeId) === String(challenge.id));

    return h('div', { className: 'app-shell challenge-page' },
      h(ChallengeHeader, { walletService, onHomeClick: handleHomeClick }),
      h('main', { className: 'app-main challenge-page__main' },
        h('section', { className: 'challenge-page__hero' },
          h(ChallengeCard, { challenge, connectedAddress })
        ),
        h(WinnersSection, {
          colasseumIndexer: this.props.colasseumIndexer,
          contractService,
          challengeId: challenge.id,
        }),
        h(Dashboard, {
          ref: (inst) => { this.dashboardRef = inst; },
          bottles: userBottlesForChallenge,
          contractService,
        }),
        h('footer', { className: 'footer-note' },
          h('p', null, 'Thanks for playing!'),
          h('div', { className: 'social-links' },
            h('a', {
              className: 'social-pill',
              href: 'https://x.com/miladycola',
              target: '_blank',
              rel: 'noreferrer',
              'aria-label': 'MiladyCola on X',
            },
              h('span', { className: 'social-pill__icon' }, '\uD835\uDD4F')
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
        )
      ),
      h(ModalManager, {
        walletService,
        contractService,
        challenges: [challenge],
      })
    );
  }
}

export default ChallengePageView;
