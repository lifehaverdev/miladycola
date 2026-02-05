import { Component, h, eventBus } from '@monygroupcorp/microact';
import { IpfsImage, IpfsService } from '@monygroupcorp/micro-web3';
import WinnerPill from '../ui/WinnerPill.js';
import nftMetadataService from '../../services/NftMetadataService.js';

const { isIpfsUri } = IpfsService;

/**
 * WinnersSection - Glassmorphic marquee of recent prize winners.
 *
 * Displays:
 * - Hidden: Until data is loaded
 * - Placeholder: When 0 winners ("Who will be the FIRST miladycola champion")
 * - Static row: 1-3 winners (no animation)
 * - Marquee: 4+ winners (auto-scroll right-to-left, pause on hover)
 */
class WinnersSection extends Component {
  constructor(props) {
    super(props);
    this.state = {
      winners: [],
      loading: true,
      ready: false, // True when metadata is loaded and ready to display
      error: null,
      paused: false,
    };
    this._loadingStarted = false;
  }

  didMount() {
    // Initialize metadata service with provider if available
    if (this.props.contractService?.provider) {
      nftMetadataService.setProvider(this.props.contractService.provider);
    }

    // Listen for higher-priority data to finish loading before we start
    this.subscribe('app:dataReady', () => {
      this.startLoading();
    });

    // If indexer is already initialized and no priority data pending, load now
    if (this.props.colasseumIndexer?.initialized) {
      // Delay slightly to let challenges/bottles load first
      setTimeout(() => this.startLoading(), 500);
    }

    // Listen for ColasseumIndexer ready
    this.subscribe('colasseum:indexerReady', () => {
      // Delay to let other data load first
      setTimeout(() => this.startLoading(), 500);
    });

    // Listen for new Victor events to refresh
    this.subscribe('indexer:syncComplete', () => {
      if (this.state.ready) {
        this.loadWinners();
      }
    });
  }

  startLoading() {
    if (this.state.ready || this._loadingStarted) return;
    this._loadingStarted = true;

    // Subscribe to new Victor events
    if (this.props.colasseumIndexer?.initialized && !this._victorUnsub) {
      this._victorUnsub = this.props.colasseumIndexer.subscribe('Victor', () => {
        this.loadWinners();
      });
    }

    this.loadWinners();
  }

  willUnmount() {
    if (this._victorUnsub) {
      this._victorUnsub();
      this._victorUnsub = null;
    }
  }

  async loadWinners() {
    if (!this.props.colasseumIndexer?.initialized) {
      this.setState({ loading: false, winners: [], ready: false });
      return;
    }

    try {
      const result = await this.props.colasseumIndexer.getWinners({ limit: 20 });

      // Filter by challengeId if provided
      let filteredWinners = result.winners;
      if (this.props.challengeId !== undefined) {
        filteredWinners = result.winners.filter(
          w => String(w.trialId) === String(this.props.challengeId)
        );
      }

      if (filteredWinners.length === 0) {
        // No winners - show placeholder
        this.setState({
          winners: [],
          loading: false,
          ready: true,
          error: null,
        });
        return;
      }

      // Fetch NFT metadata for all winners (null metadata is OK — WinnerPill has fallbacks)
      const winnersWithMetadata = await this.enrichWinnersWithMetadata(filteredWinners);

      this.setState({
        winners: winnersWithMetadata,
        loading: false,
        ready: true,
        error: null,
      });
    } catch (error) {
      console.error('[WinnersSection] Failed to load winners:', error);
      this.setState({
        loading: false,
        ready: false,
        error: error.message,
      });
    }
  }

  async enrichWinnersWithMetadata(winners) {
    // We need to get the draw info for each winner to get the NFT details
    const enriched = await Promise.all(
      winners.map(async (winner) => {
        try {
          // Get trial data to find NFT contract/id
          const trial = await this.props.contractService?.getTrial(winner.trialId);
          if (!trial) return { ...winner, metadata: null };

          const nftContract = trial.nftContract;
          const nftId = trial.nftId;

          // Fetch NFT metadata
          const metadata = await nftMetadataService.getMetadata(nftContract, nftId);

          // Get entry price from chance data (numChances * 1 gwei)
          let entryValue = '0';
          try {
            const chanceId = Number(winner.chanceId);
            const chance = await this.props.contractService?.getChance(chanceId);
            if (chance) {
              entryValue = String(chance.numChances * 1000000000); // 1 gwei per chance
            }
          } catch (err) {
            console.warn('[WinnersSection] Could not fetch chance price:', err.message);
          }

          // Get block timestamp from the block number
          let blockTimestamp = null;
          try {
            if (winner.blockNumber && this.props.contractService?.provider) {
              const block = await this.props.contractService.provider.getBlock(winner.blockNumber);
              blockTimestamp = block?.timestamp || null;
            }
          } catch (err) {
            console.warn('[WinnersSection] Could not fetch block timestamp:', err.message);
          }

          return {
            ...winner,
            nftContract,
            nftId,
            lore: trial.lore || '',
            metadata,
            entryValue,
            timestamp: blockTimestamp,
          };
        } catch (error) {
          console.warn('[WinnersSection] Failed to enrich winner:', winner.trialId, error);
          return { ...winner, metadata: null };
        }
      })
    );

    return enriched;
  }

  handleMouseEnter = () => {
    this.setState({ paused: true });
  };

  handleMouseLeave = () => {
    this.setState({ paused: false });
  };

  formatEntryValue(valueWei) {
    if (!valueWei) return '0 ETH';
    try {
      const eth = Number(valueWei) / 1e18;
      if (eth < 0.0001) {
        return '<0.0001 ETH';
      }
      return `${eth.toFixed(4)} ETH`;
    } catch {
      return '0 ETH';
    }
  }

  renderImage(src, alt, className = '') {
    if (!src) return null;
    if (isIpfsUri(src)) {
      return h(IpfsImage, { src, alt, className, loading: 'lazy' });
    }
    return h('img', { src, alt, className, loading: 'lazy' });
  }

  renderStaticPill(winner) {
    const imageUrl = winner.metadata?.image || '/bottle.svg';
    const altText = winner.metadata?.name || `NFT #${winner.nftId}`;
    const address = winner.winner
      ? `${winner.winner.slice(0, 6)}...${winner.winner.slice(-4)}`
      : '???';
    const entryValue = this.formatEntryValue(winner.entryValue);

    return h('div', { className: 'winner-pill-wrapper' },
      h('div', { className: 'winner-pill winner-pill--static' },
        h('div', { className: 'winner-pill__thumb' },
          this.renderImage(imageUrl, altText)
        ),
        h('div', { className: 'winner-pill__info' },
          h('span', { className: 'winner-pill__address' }, address),
          h('span', { className: 'winner-pill__value' }, entryValue)
        )
      )
    );
  }

  handleStickerClick = (winner) => {
    eventBus.emit('modal:open', { modal: 'winDetails', winner });
  };

  renderSticker(winner, index) {
    const imageUrl = winner.metadata?.image || '/bottle.svg';
    const address = winner.winner
      ? `${winner.winner.slice(0, 6)}...${winner.winner.slice(-4)}`
      : '???';

    return h('button', {
      className: `sticker sticker--${(index % 5) + 1}`,
      type: 'button',
      title: 'View win details',
      onClick: () => this.handleStickerClick(winner),
    },
      h('div', { className: 'sticker__thumb' },
        this.renderImage(imageUrl, 'Winner NFT')
      ),
      h('div', { className: 'sticker__content sticker__content--winner' },
        `${address}`
      )
    );
  }

  render() {
    const { winners, loading, ready, error, paused } = this.state;

    // Sticker mode for vending machine
    if (this.props.asStickers) {
      if (!ready || loading || error || winners.length === 0) {
        return h('div', { className: 'stickers-container stickers-container--empty' });
      }
      // Only show up to 5 stickers
      const stickersToShow = winners.slice(0, 5);
      return h('div', { className: 'stickers-container' },
        stickersToShow.map((winner, i) => this.renderSticker(winner, i))
      );
    }

    // Hidden until ready
    if (!ready || loading) {
      return h('div', { className: 'winners-section winners-section--hidden' });
    }

    // Error state - hide
    if (error) {
      return h('div', { className: 'winners-section winners-section--hidden' });
    }

    // Placeholder for 0 winners
    if (winners.length === 0) {
      return h('div', { className: 'winners-section winners-section--placeholder' },
        h('p', { className: 'winners-placeholder-text' }, 'Who will be the FIRST miladycola champion?')
      );
    }

    // Static display for 1-3 winners
    if (winners.length < 4) {
      return h('div', { className: 'winners-section winners-section--static' },
        h('h3', { className: 'winners-section__heading' }, 'Real Miladycola Winners'),
        h('div', { className: 'winners-static-row' },
          winners.map((winner, i) =>
            h(WinnerPill, { key: i, winner })
          )
        )
      );
    }

    // Marquee for 4+ winners
    const pausedClass = paused ? 'winners-marquee--paused' : '';

    // First set: interactive pills
    // Second set: static duplicates for seamless loop
    return h('div', { className: 'winners-section winners-section--marquee' },
      h('h3', { className: 'winners-section__heading' }, 'Real Miladycola Winners'),
      h('div', { className: `winners-marquee ${pausedClass}` },
        h('div', {
          className: 'winners-marquee-track',
          onMouseEnter: this.handleMouseEnter,
          onMouseLeave: this.handleMouseLeave,
        },
          winners.map((winner, i) =>
            h(WinnerPill, { key: `pill-${i}`, winner })
          ),
          winners.map((winner, i) =>
            h('div', { key: `static-${i}` }, this.renderStaticPill(winner))
          )
        )
      )
    );
  }
}

export default WinnersSection;
