import { Component, h, eventBus } from '@monygroupcorp/microact';
import PrizeDetailModal from '../ui/PrizeDetailModal.js';
import ChallengeWizard from '../ui/ChallengeWizard.js';
import EntryModal from '../ui/EntryModal.js';
import RevealModal from '../ui/RevealModal.js';
import ClaimModal from '../ui/ClaimModal.js';
import RefundModal from '../ui/RefundModal.js';
import WalletSelectModal from '../ui/WalletSelectModal.js';
import WinDetailsModal from '../ui/WinDetailsModal.js';
import fixturesChallenges from '../../fixtures/challenges.json';

class ModalManager extends Component {
  constructor(props) {
    super(props);
    this.state = {
      activeModal: null,
      modalData: null,
    };

    // Refs for imperative child access
    this.prizeDetailModal = null;
    this.challengeWizardModal = null;
    this.entryModal = null;
    this.revealModal = null;
    this.claimModal = null;
    this.refundModal = null;
    this.walletSelectModal = null;
    this.winDetailsModal = null;
  }

  didMount() {
    // Listen for modal events
    this.subscribe('modal:open', (data) => {
      this.openModal(data.modal, data);
    });

    this.subscribe('modal:close', () => {
      this.closeModal();
    });

    // Convenience events - challenge preview (from challenge cards)
    this.subscribe('challenge:preview', (data) => {
      this.openModal('prizeDetail', { challenge: data.challenge, mode: 'view' });
    });

    // Challenge select (for entering a challenge)
    this.subscribe('challenge:select', (data) => {
      this.openModal('entry', data);
    });

    // Token confirmation (from ChallengeWizard)
    this.subscribe('token:preview', (data) => {
      this.openModal('prizeDetail', { challenge: data.challenge, mode: 'confirm' });
    });

    // Bottle preview (from bottle cards - looks up challenge by ID)
    this.subscribe('bottle:preview', (data) => {
      const bottle = data.bottle;
      // Use live challenges from props first, fall back to fixtures
      const liveChallenges = this.props.challenges || [];
      const challenge = liveChallenges.find(c => c.id === bottle.challengeId)
        || fixturesChallenges.find(c => c.id === bottle.challengeId);
      if (challenge) {
        this.openModal('prizeDetail', { challenge, mode: 'view' });
      }
    });

    // Wallet selection modal
    this.subscribe('wallet:select', () => {
      this.openModal('walletSelect', {});
    });

    // Bottle claim (from bottle cards)
    this.subscribe('bottle:claim', (data) => {
      this.openModal('claim', { bottle: data.bottle });
    });

    // Refund modal (from Dashboard refundable alert)
    this.subscribe('modal:openRefund', (data) => {
      this.openModal('refund', { chances: data.chances });
    });

    // Claim status updates (from AppShell)
    this.subscribe('claim:status', (data) => {
      if (this.claimModal) {
        this.claimModal.setStatus(data.status, data.error);
      }
      if (data.status === 'success') {
        // Auto-close after success
        setTimeout(() => this.closeModal(), 2000);
      }
    });
  }

  openModal(modalName, data = {}) {
    document.body.classList.add('modal-open');
    this.setState({ activeModal: modalName, modalData: data });

    // Update child modal data (refs may not be available on first render)
    // Use requestAnimationFrame to ensure refs are set after render
    requestAnimationFrame(() => {
      switch (modalName) {
        case 'prizeDetail':
          this.prizeDetailModal?.setChallenge(data.challenge, data.mode || 'view');
          break;
        case 'entry':
          this.entryModal?.setChallenge(data.challenge);
          break;
        case 'reveal':
          this.revealModal?.setBottle(data.bottle);
          break;
        case 'claim':
          this.claimModal?.setBottle(data.bottle);
          break;
        case 'refund':
          this.refundModal?.setChances(data.chances);
          break;
        case 'challengeWizard':
          this.challengeWizardModal?.reset();
          break;
        case 'walletSelect':
          this.walletSelectModal?.refresh();
          break;
        case 'winDetails':
          this.winDetailsModal?.setWinner(data.winner);
          break;
      }
    });
  }

  closeModal() {
    document.body.classList.remove('modal-open');
    this.setState({ activeModal: null, modalData: null });
  }

  handleBackdropClick = (e) => {
    // Only close if clicking the backdrop itself, not the panel
    if (e.target.classList.contains('modal-backdrop')) {
      this.closeModal();
    }
  };

  renderModal(name, modalClass, ModalComponent, extraProps = {}) {
    const { activeModal } = this.state;
    const isOpen = activeModal === name;
    const openClass = isOpen ? 'open' : '';

    return h('div', {
      className: `${modalClass} modal-backdrop ${openClass}`,
      'aria-hidden': String(!isOpen),
      onClick: this.handleBackdropClick,
    },
      h(ModalComponent, {
        ref: (inst) => { this[`${name}Modal`] = inst; },
        walletService: this.props.walletService,
        contractService: this.props.contractService,
        ...extraProps,
      })
    );
  }

  render() {
    return h('div', { className: 'modal-manager' },
      this.renderModal('prizeDetail', 'prize-detail-modal', PrizeDetailModal),
      this.renderModal('challengeWizard', 'challenge-wizard', ChallengeWizard),
      this.renderModal('entry', 'challenge-wizard', EntryModal),
      this.renderModal('reveal', 'reveal-modal', RevealModal),
      this.renderModal('claim', 'claim-modal', ClaimModal),
      this.renderModal('refund', 'refund-modal', RefundModal),
      this.renderModal('walletSelect', 'wallet-select-modal', WalletSelectModal),
      this.renderModal('winDetails', 'win-details-modal', WinDetailsModal)
    );
  }
}

export default ModalManager;
