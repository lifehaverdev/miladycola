import { Component, h, eventBus } from '@monygroupcorp/microact';
import { IpfsImage, IpfsService } from '@monygroupcorp/micro-web3';
import ChallengeCard from '../ui/ChallengeCard.js';

const { isIpfsUri } = IpfsService;

class ChallengeGrid extends Component {
  constructor(props) {
    super(props);
    this.state = {
      challenges: props.challenges || [],
      connectedAddress: props.connectedAddress || null,
      currentPage: 0,
    };
  }

  setChallenges(challenges) {
    this.setState({ challenges, currentPage: 0 });
  }

  setConnectedAddress(address) {
    this.setState({ connectedAddress: address });
  }

  nextPage = () => {
    const maxPage = Math.ceil(this.state.challenges.length / 6) - 1;
    if (this.state.currentPage < maxPage) {
      this.setState({ currentPage: this.state.currentPage + 1 });
    }
  };

  prevPage = () => {
    if (this.state.currentPage > 0) {
      this.setState({ currentPage: this.state.currentPage - 1 });
    }
  };

  // Generate slot index like A1, A2, A3, B1, B2, B3, etc.
  getSlotIndex(i) {
    const row = String.fromCharCode(65 + Math.floor(i / 3)); // A, B, C, D...
    const col = (i % 3) + 1; // 1, 2, 3
    return `${row}${col}`;
  }

  handleSlotClick(challenge, index) {
    eventBus.emit('modal:open', {
      modal: 'entry',
      challenge,
      slotIndex: this.getSlotIndex(index),
    });
  }

  renderProductSlot(challenge, i) {
    const slotIndex = this.getSlotIndex(i);
    const isEnded = challenge.status !== 'active';

    return h('div', {
      key: challenge.id || i,
      className: `product-slot ${isEnded ? 'product-slot--sold-out' : ''}`,
      onClick: () => !isEnded && this.handleSlotClick(challenge, i),
    },
      h('span', { className: 'product-slot__index' }, slotIndex),
      h('div', { className: 'product-slot__image' },
        challenge.image
          ? (isIpfsUri(challenge.image)
              ? h(IpfsImage, { src: challenge.image, alt: challenge.title })
              : h('img', { src: challenge.image, alt: challenge.title }))
          : h('div', { className: 'product-slot__placeholder' }, '?')
      ),
      h('div', { className: 'product-slot__price' },
        h('div', { className: 'product-slot__price-row' },
          h('span', { className: 'product-slot__price-label' }, 'Appraisal'),
          h('span', { className: 'product-slot__price-value' }, `${challenge.appraisalEth} Ξ`)
        ),
        h('div', { className: 'product-slot__price-row' },
          h('span', { className: 'product-slot__price-label' }, 'Attempts'),
          h('span', { className: 'product-slot__price-value product-slot__price-value--pot' }, `${challenge.potEth || '0'} Ξ`)
        )
      )
    );
  }

  renderEmptySlot(i) {
    const slotIndex = this.getSlotIndex(i);
    return h('div', {
      className: 'product-slot product-slot--empty',
    },
      h('span', { className: 'product-slot__index' }, slotIndex),
      h('div', { className: 'product-slot__image' },
        h('div', { className: 'product-slot__placeholder' }, '—')
      )
    );
  }

  render() {
    const { challenges, connectedAddress } = this.state;
    const asProductGrid = this.props.asProductGrid;

    // Product grid mode (vending machine display)
    if (asProductGrid) {
      const itemsPerPage = 6;
      const { currentPage } = this.state;

      // Sort by highest ETH pot first
      const sortedChallenges = [...challenges].sort((a, b) => {
        const aEth = parseFloat(a.appraisalEth) || 0;
        const bEth = parseFloat(b.appraisalEth) || 0;
        return bEth - aEth;
      });

      const totalPages = Math.max(1, Math.ceil(sortedChallenges.length / itemsPerPage));
      const startIdx = currentPage * itemsPerPage;
      const visibleChallenges = sortedChallenges.slice(startIdx, startIdx + itemsPerPage);
      const hasPrev = currentPage > 0;
      const hasNext = currentPage < totalPages - 1;

      // Always render 6 slots
      const slots = [];
      for (let i = 0; i < itemsPerPage; i++) {
        const globalIdx = startIdx + i;
        if (i < visibleChallenges.length) {
          slots.push(this.renderProductSlot(visibleChallenges[i], globalIdx));
        } else {
          slots.push(this.renderEmptySlot(globalIdx));
        }
      }

      return h('div', { className: 'product-display' },
        h('div', { className: 'product-grid' }, slots),
        totalPages > 1 && h('div', { className: 'product-pagination' },
          h('button', {
            className: 'pagination-btn',
            disabled: !hasPrev,
            onClick: this.prevPage,
          }, '◀'),
          h('span', { className: 'pagination-info' }, `${currentPage + 1} / ${totalPages}`),
          h('button', {
            className: 'pagination-btn',
            disabled: !hasNext,
            onClick: this.nextPage,
          }, '▶')
        )
      );
    }

    // Legacy card grid mode
    return h('section', { className: 'challenge-grid' },
      h('header', null,
        h('div', null,
          h('h2', null, 'Prizes')
        )
      ),
      h('div', { className: 'challenge-list-grid' },
        isEmpty
          ? h('p', { className: 'muted' }, 'No active challenges at the moment.')
          : challenges.map((challenge, i) =>
              h(ChallengeCard, {
                key: challenge.id || i,
                challenge,
                connectedAddress,
              })
            )
      )
    );
  }
}

export default ChallengeGrid;
