import { Component, h, eventBus } from '@monygroupcorp/microact';
import { IpfsImage, IpfsService } from '@monygroupcorp/micro-web3';
import knownCollections from '../../fixtures/collections.json';

const { isIpfsUri } = IpfsService;
const knownAddresses = new Set(knownCollections.map(c => c.address.toLowerCase()));

class ChallengeCard extends Component {
  constructor(props) {
    super(props);
    this.state = {
      showCancelConfirm: false,
      cancelling: false,
    };
  }

  setConnectedAddress(address) {
    this.connectedAddress = address;
    this.update();
  }

  handleMediaClick = () => {
    eventBus.emit('challenge:preview', { challenge: this.props.challenge });
  };

  handleEnterClick = () => {
    eventBus.emit('modal:open', { modal: 'entry', challenge: this.props.challenge });
  };

  handleCancelClick = () => {
    this.setState({ showCancelConfirm: true });
  };

  handleDenyCancel = () => {
    this.setState({ showCancelConfirm: false });
  };

  handleConfirmCancel = () => {
    this.setState({ cancelling: true });
    eventBus.emit('challenge:cancel', { challengeId: this.props.challenge.id });
  };

  isOwner() {
    const connectedAddress = this.props.connectedAddress || this.connectedAddress;
    if (!connectedAddress || !this.props.challenge.creator) return false;
    return connectedAddress.toLowerCase() === this.props.challenge.creator.toLowerCase();
  }

  render() {
    const { id, title, status, nftContract, tokenId, image, appraisalEth, potEth, bottlesSold, lore } = this.props.challenge;
    const { showCancelConfirm, cancelling } = this.state;

    const statusClass = status === 'cancelled' ? 'challenge-card--cancelled' : '';
    const hasImage = !!image;
    const useIpfsImage = hasImage && isIpfsUri(image);

    const contractLink = nftContract
      ? `https://etherscan.io/address/${nftContract}`
      : '#';
    const isVerifiedCollection = nftContract && knownAddresses.has(nftContract.toLowerCase());

    const isActive = status === 'active';
    const isOwner = this.isOwner();
    const showStatus = status !== 'active';

    // Cancel confirmation overlay
    const depositLoss = (parseFloat(appraisalEth) * 0.05).toFixed(4);

    return h('article', { className: `challenge-card ${statusClass}` },
      showCancelConfirm && h('div', { className: 'cancel-confirm-overlay' },
        h('div', { className: 'cancel-confirm' },
          h('h4', null, 'Are you sure?'),
          h('p', { className: 'cancel-confirm__warning cancel-confirm__warning--severe' },
            'This action is irreversible.'
          ),
          h('p', { className: 'cancel-confirm__warning' },
            h('strong', null, `You will permanently lose your ${depositLoss} ETH deposit.`),
            ' This ETH will not be returned to you.'
          ),
          h('p', { className: 'cancel-confirm__warning' },
            `All ${bottlesSold} bottle holder${bottlesSold === 1 ? '' : 's'} will be entitled to full refunds of their entries.`
          ),
          h('div', { className: 'cancel-confirm__actions' },
            h('button', {
              className: 'btn primary small cancel-confirm__no',
              type: 'button',
              disabled: cancelling,
              onClick: this.handleDenyCancel,
            }, 'Keep Challenge'),
            h('button', {
              className: 'btn danger small cancel-confirm__yes',
              type: 'button',
              disabled: cancelling,
              onClick: this.handleConfirmCancel,
            }, cancelling ? 'Cancelling...' : 'Cancel & Forfeit Deposit')
          )
        )
      ),
      h('div', {
        className: `challenge-card__media ${hasImage ? 'has-image' : ''}`,
        onClick: this.handleMediaClick,
      },
        hasImage && (useIpfsImage
          ? h(IpfsImage, { src: image, alt: title, className: 'challenge-card__image' })
          : h('img', { src: image, alt: title, className: 'challenge-card__image' })
        ),
        showStatus && h('span', { className: 'challenge-card__status' }, status)
      ),
      h('div', { className: 'challenge-card__body' },
        h('div', { className: 'challenge-card__title' },
          h('div', { className: 'challenge-card__title-left' },
            h('h3', null, title),
            h('a', {
              className: `ghost-link contract-link${isVerifiedCollection ? ' verified' : ''}`,
              href: contractLink,
              target: '_blank',
              rel: 'noreferrer',
            },
              nftContract ? `${nftContract.slice(0, 6)}...${nftContract.slice(-4)}` : `#${tokenId}`,
              isVerifiedCollection && h('span', { className: 'verified-check', title: 'Known collection' }, '\u2713')
            )
          ),
          h('span', { className: 'challenge-card__badge' }, `Challenge #${id}`)
        ),
        h('p', { className: 'challenge-card__lore' }, lore),
        h('div', { className: 'challenge-card__stats' },
          h('div', null,
            h('span', null, 'Appraisal'),
            h('strong', null, `${parseFloat(appraisalEth).toFixed(2)} ETH`)
          ),
          h('div', null,
            h('span', null, 'Prize Pot'),
            h('strong', null, `${parseFloat(potEth).toFixed(2)} ETH`)
          ),
          h('div', null,
            h('span', null, 'Bottles Sold'),
            h('strong', null, bottlesSold)
          )
        ),
        h('div', { className: 'challenge-card__actions' },
          isActive
            ? h('button', {
                className: 'btn primary challenge-card__enter-btn',
                type: 'button',
                onClick: this.handleEnterClick,
              }, 'Get Bottles')
            : h('button', {
                className: 'btn ghost',
                type: 'button',
                disabled: true,
              }, status),
          isActive && isOwner && h('button', {
            className: 'btn ghost small challenge-card__cancel-btn',
            type: 'button',
            onClick: this.handleCancelClick,
          }, 'Cancel')
        )
      )
    );
  }
}

export default ChallengeCard;
