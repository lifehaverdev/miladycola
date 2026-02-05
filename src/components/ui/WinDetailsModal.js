import { Component, h, eventBus } from '@monygroupcorp/microact';
import { IpfsImage, IpfsService } from '@monygroupcorp/micro-web3';

const { isIpfsUri } = IpfsService;

/**
 * WinDetailsModal - Displays full win information for a winner.
 *
 * Shows:
 * - NFT image (large)
 * - NFT title from metadata
 * - Contract address (Etherscan link)
 * - Challenge lore
 * - Entry cost
 * - Timestamp
 * - Show more: description + traits
 */
class WinDetailsModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      winner: null,
      showMore: false,
    };
  }

  setWinner(winner) {
    this.setState({ winner, showMore: false });
  }

  handleClose = () => {
    eventBus.emit('modal:close');
  };

  toggleShowMore = () => {
    this.setState({ showMore: !this.state.showMore });
  };

  formatAddress(address) {
    if (!address) return '???';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

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

  formatTimestamp(timestamp) {
    if (!timestamp) return 'Unknown';
    try {
      // timestamp might be block timestamp (seconds) or JS timestamp (ms)
      const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
      const date = new Date(ms);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return 'Unknown';
    }
  }

  renderTraits(attributes) {
    if (!attributes || !Array.isArray(attributes) || attributes.length === 0) {
      return h('p', { className: 'muted' }, 'No traits available');
    }

    return h('div', { className: 'win-details-traits' },
      attributes.map((attr, i) =>
        h('div', { key: i, className: 'win-details-trait' },
          h('span', { className: 'trait-type' }, attr.trait_type || 'Property'),
          h('span', { className: 'trait-value' }, attr.value)
        )
      )
    );
  }

  render() {
    const { winner, showMore } = this.state;

    if (!winner) {
      return h('div', { className: 'win-details-panel' },
        h('p', { className: 'muted' }, 'No winner selected')
      );
    }

    const { metadata, nftContract, nftId, lore, entryValue, timestamp, transactionHash } = winner;

    const imageUrl = metadata?.image || '/bottle.svg';
    const title = metadata?.name || `NFT #${nftId}`;
    const description = metadata?.description || 'No description available.';
    const attributes = metadata?.attributes;

    const shortTxHash = transactionHash
      ? `${transactionHash.slice(0, 10)}...${transactionHash.slice(-6)}`
      : '---';

    const etherscanUrl = transactionHash
      ? `https://etherscan.io/tx/${transactionHash}`
      : '#';

    const showMoreText = showMore ? 'Show Less' : 'Show More';

    return h('div', { className: 'win-details-panel' },
      h('button', {
        className: 'modal-close-btn',
        type: 'button',
        'aria-label': 'Close',
        onClick: this.handleClose,
      }, h('span', { 'aria-hidden': 'true' }, '\u00D7')),

      h('div', { className: 'win-details-image' },
        isIpfsUri(imageUrl)
          ? h(IpfsImage, { src: imageUrl, alt: title })
          : h('img', { src: imageUrl, alt: title })
      ),

      h('div', { className: 'win-details-content' },
        h('h3', { className: 'win-details-title' }, title),

        h('a', {
          className: 'win-details-contract ghost-link',
          href: etherscanUrl,
          target: '_blank',
          rel: 'noreferrer',
        },
          h('span', { className: 'contract-icon' }, '\u{1F517}'),
          h('span', null, `tx: ${shortTxHash}`)
        ),

        lore && h('blockquote', { className: 'win-details-lore' }, lore),

        h('div', { className: 'win-details-stats' },
          h('div', { className: 'win-details-stat' },
            h('span', { className: 'stat-label' }, 'Entry Cost'),
            h('span', { className: 'stat-value' }, this.formatEntryValue(entryValue))
          ),
          h('div', { className: 'win-details-stat' },
            h('span', { className: 'stat-label' }, 'Won On'),
            h('span', { className: 'stat-value' }, this.formatTimestamp(timestamp))
          )
        ),

        h('div', { className: 'win-details-more', 'data-open': showMore ? 'true' : 'false' },
          h('button', {
            className: 'btn ghost smaller',
            type: 'button',
            onClick: this.toggleShowMore,
          }, showMoreText),
          h('div', { className: 'win-details-more-content' },
            h('div', { className: 'win-details-description' },
              h('h4', null, 'Description'),
              h('p', null, description)
            ),
            h('div', { className: 'win-details-traits-section' },
              h('h4', null, 'Traits'),
              this.renderTraits(attributes)
            )
          )
        )
      )
    );
  }
}

export default WinDetailsModal;
