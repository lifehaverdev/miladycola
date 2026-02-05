import { Component, h, eventBus } from '@monygroupcorp/microact';
import { IpfsImage, IpfsService } from '@monygroupcorp/micro-web3';

const { isIpfsUri } = IpfsService;

/**
 * WinnerPill - Glassmorphic compact pill showing a winner.
 *
 * Features:
 * - Compact by default (~90px), expands on hover (~160px)
 * - Shows NFT thumbnail, winner address, entry cost
 * - Click opens win details modal
 */
class WinnerPill extends Component {
  constructor(props) {
    super(props);
    this.state = {};
  }

  handleClick = () => {
    eventBus.emit('modal:open', { modal: 'winDetails', winner: this.props.winner });
  };

  formatAddress(address) {
    if (!address) return '???';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  formatEntryValue(valueWei) {
    if (!valueWei) return '0 ETH';
    try {
      // Entry value stored as wei string, convert to ETH
      const eth = Number(valueWei) / 1e18;
      if (eth < 0.0001) {
        return '<0.0001 ETH';
      }
      return `${eth.toFixed(4)} ETH`;
    } catch {
      return '0 ETH';
    }
  }

  render() {
    const { winner } = this.props;
    const { metadata } = winner;

    // Use metadata image or fallback
    const imageUrl = metadata?.image || '/bottle.svg';
    const altText = metadata?.name || `NFT #${winner.nftId}`;

    const imageElement = isIpfsUri(imageUrl)
      ? h(IpfsImage, { src: imageUrl, alt: altText, loading: 'lazy' })
      : h('img', { src: imageUrl, alt: altText, loading: 'lazy' });

    return h('button', {
      className: 'winner-pill',
      type: 'button',
      title: 'View win details',
      onClick: this.handleClick,
    },
      h('div', { className: 'winner-pill__thumb' }, imageElement),
      h('div', { className: 'winner-pill__info' },
        h('span', { className: 'winner-pill__address' }, this.formatAddress(winner.winner)),
        h('span', { className: 'winner-pill__value' }, this.formatEntryValue(winner.entryValue))
      )
    );
  }
}

export default WinnerPill;
