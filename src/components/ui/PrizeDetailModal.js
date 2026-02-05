import { Component, h, eventBus } from '@monygroupcorp/microact';

class PrizeDetailModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      challenge: null,
      traitsOpen: false,
      mode: 'view', // 'view' or 'confirm'
    };
  }

  setChallenge(challenge, mode = 'view') {
    this.setState({ challenge, traitsOpen: false, mode });
  }

  handleClose = () => {
    eventBus.emit('modal:close');
  };

  handleCancel = () => {
    eventBus.emit('modal:close');
  };

  handleConfirm = () => {
    eventBus.emit('prize:confirmed', { challenge: this.state.challenge });
    eventBus.emit('modal:close');
  };

  toggleTraits = () => {
    this.setState({ traitsOpen: !this.state.traitsOpen });
  };

  render() {
    const { challenge, traitsOpen, mode } = this.state;

    if (!challenge) {
      return h('div', { className: 'prize-detail-panel' },
        h('p', { className: 'muted' }, 'No prize selected')
      );
    }

    const { title, image, lore, nftContract, tokenId, appraisalEth, potEth, bottlesSold, creatorAddress } = challenge;

    const toggleText = traitsOpen ? 'Hide Details' : 'Show Details';

    const shortContract = nftContract
      ? `${nftContract.slice(0, 6)}...${nftContract.slice(-4)}`
      : '—';
    const shortCreator = creatorAddress
      ? `${creatorAddress.slice(0, 6)}...${creatorAddress.slice(-4)}`
      : '—';

    const isViewMode = mode === 'view';

    return h('div', { className: 'prize-detail-panel' },
      h('div', { className: 'prize-detail-image' },
        image
          ? h('img', { src: image, alt: title })
          : h('div', { className: 'prize-placeholder' })
      ),
      h('div', { className: 'prize-detail-content' },
        h('h3', { className: 'prize-detail-title' }, title),
        h('p', { className: 'prize-detail-description' }, lore || 'No description available.'),

        h('div', { className: 'trait-section', 'data-open': traitsOpen ? 'true' : 'false' },
          h('button', {
            className: 'btn ghost smaller',
            type: 'button',
            onClick: this.toggleTraits,
          }, toggleText),
          h('div', { className: 'trait-list' },
            h('div', null,
              h('span', null, 'Contract'),
              h('a', {
                className: 'ghost-link',
                href: `https://etherscan.io/address/${nftContract}`,
                target: '_blank',
                rel: 'noreferrer',
              }, h('strong', null, shortContract))
            ),
            h('div', null,
              h('span', null, 'Token ID'),
              h('strong', null, `#${tokenId}`)
            ),
            h('div', null,
              h('span', null, 'Appraisal'),
              h('strong', null, `${appraisalEth} ETH`)
            ),
            h('div', null,
              h('span', null, 'Prize Pot'),
              h('strong', null, `${potEth} ETH`)
            ),
            h('div', null,
              h('span', null, 'Bottles Sold'),
              h('strong', null, bottlesSold)
            ),
            h('div', null,
              h('span', null, 'Creator'),
              h('strong', null, shortCreator)
            )
          )
        ),

        h('div', { className: 'prize-detail-actions' },
          isViewMode
            ? h('button', {
                className: 'btn ghost',
                type: 'button',
                onClick: this.handleClose,
              }, 'Close')
            : [
                h('button', {
                  key: 'cancel',
                  className: 'btn ghost',
                  type: 'button',
                  onClick: this.handleCancel,
                }, 'Cancel'),
                h('button', {
                  key: 'confirm',
                  className: 'btn primary',
                  type: 'button',
                  onClick: this.handleConfirm,
                }, 'Select This Prize'),
              ]
        )
      )
    );
  }
}

export default PrizeDetailModal;
