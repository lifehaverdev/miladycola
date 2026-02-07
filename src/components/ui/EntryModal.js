import { Component, h, eventBus } from '@monygroupcorp/microact';
import { IpfsImage, IpfsService } from '@monygroupcorp/micro-web3';
import { ethers } from 'ethers';
import cryptoService from '../../services/CryptoService.js';

const { isIpfsUri } = IpfsService;

// BN128 field / MAX_HASH - same as contract
const MAX_HASH = ethers.BigNumber.from(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);
const FIXED_TICKET_PRICE = ethers.BigNumber.from('1000000000'); // 1 gwei in wei

// LocalStorage helpers for passphrase
const PASSPHRASE_PREFIX = 'miladycola_passphrase_';
export function storePassphrase(chanceId, passphrase) {
  try {
    localStorage.setItem(`${PASSPHRASE_PREFIX}${chanceId}`, passphrase);
  } catch (e) {
    console.warn('[EntryModal] Failed to store passphrase:', e);
  }
}

export function getStoredPassphrase(chanceId) {
  try {
    return localStorage.getItem(`${PASSPHRASE_PREFIX}${chanceId}`);
  } catch (e) {
    return null;
  }
}

// Track if reveal animation has been seen
const REVEAL_SEEN_PREFIX = 'miladycola_reveal_seen_';
export function setRevealSeen(chanceId) {
  try {
    localStorage.setItem(`${REVEAL_SEEN_PREFIX}${chanceId}`, Date.now().toString());
  } catch (e) {
    console.warn('[EntryModal] Failed to store reveal seen:', e);
  }
}

export function hasRevealBeenSeen(chanceId) {
  try {
    return !!localStorage.getItem(`${REVEAL_SEEN_PREFIX}${chanceId}`);
  } catch (e) {
    return false;
  }
}

// Store simulated win result (until we have real ZK evaluation)
const WIN_RESULT_PREFIX = 'miladycola_win_result_';
export function storeWinResult(chanceId, isWinner) {
  try {
    localStorage.setItem(`${WIN_RESULT_PREFIX}${chanceId}`, isWinner ? 'win' : 'loss');
  } catch (e) {
    console.warn('[EntryModal] Failed to store win result:', e);
  }
}

export function getStoredWinResult(chanceId) {
  try {
    const result = localStorage.getItem(`${WIN_RESULT_PREFIX}${chanceId}`);
    if (result === 'win') return true;
    if (result === 'loss') return false;
    return null;
  } catch (e) {
    return null;
  }
}

class EntryModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      challenge: null,
      oddsPercent: 1,
      passphrase: '',
      loading: false,
      error: null,
      isOwner: false,
      showCancelConfirm: false,
      cancelling: false,
    };
  }

  setChallenge(challenge) {
    this.setState({
      challenge,
      oddsPercent: 1,
      passphrase: '',
      loading: false,
      error: null,
      showCancelConfirm: false,
      cancelling: false,
    });
    // Check ownership async
    this.checkOwnership(challenge);
  }

  async checkOwnership(challenge) {
    if (!challenge?.creator || !this.props.contractService?.signer) {
      this.setState({ isOwner: false });
      return;
    }
    try {
      const address = await this.props.contractService.signer.getAddress();
      const isOwner = address?.toLowerCase() === challenge.creator?.toLowerCase();
      this.setState({ isOwner });
    } catch (e) {
      this.setState({ isOwner: false });
    }
  }

  handleClose = () => {
    eventBus.emit('modal:close');
  };

  /**
   * Calculate number of chances needed for desired odds percentage
   * Formula: numChances = ceil((MAX_HASH * oddsPercent / 100) / difficulty)
   */
  calculateNumChances(oddsPercent, difficulty) {
    if (!difficulty || difficulty.isZero()) {
      return ethers.BigNumber.from(1);
    }
    // desiredShare = MAX_HASH * oddsPercent / 100
    let desiredShare = MAX_HASH.mul(oddsPercent).div(100);
    if (desiredShare.lte(0)) {
      desiredShare = ethers.BigNumber.from(1);
    }
    // numChances = ceil(desiredShare / difficulty)
    // ceil division: (a + b - 1) / b
    let numChances = desiredShare.add(difficulty.sub(1)).div(difficulty);
    if (numChances.lt(1)) {
      numChances = ethers.BigNumber.from(1);
    }
    return numChances;
  }

  /**
   * Calculate total cost in wei
   */
  calculateCostWei(numChances) {
    return FIXED_TICKET_PRICE.mul(numChances);
  }

  /**
   * Format wei to ETH string
   */
  formatEth(wei) {
    return ethers.utils.formatEther(wei);
  }

  handleOddsInput = (e) => {
    const oddsPercent = parseInt(e.target.value, 10);
    this.setState({ oddsPercent });
  };

  handleOddsChange = (e) => {
    this.setState({ oddsPercent: parseInt(e.target.value, 10) });
  };

  handlePassphraseChange = (e) => {
    this.setState({ passphrase: e.target.value });
  };

  handleShowCancelConfirm = () => {
    this.setState({ showCancelConfirm: true });
  };

  handleHideCancelConfirm = () => {
    this.setState({ showCancelConfirm: false });
  };

  handleConfirmCancel = () => {
    this.setState({ cancelling: true });
    eventBus.emit('challenge:cancel', { challengeId: this.state.challenge.id });
    // Listen for completion
    const onCancelled = () => {
      this.setState({ cancelling: false });
      eventBus.emit('modal:close');
      eventBus.off('challenge:cancelled', onCancelled);
      eventBus.off('challenge:cancelError', onError);
    };
    const onError = ({ error }) => {
      this.setState({ cancelling: false, error: error || 'Failed to cancel challenge' });
      eventBus.off('challenge:cancelled', onCancelled);
      eventBus.off('challenge:cancelError', onError);
    };
    eventBus.on('challenge:cancelled', onCancelled);
    eventBus.on('challenge:cancelError', onError);
  };

  calculateDisplayPrice() {
    const { challenge, oddsPercent } = this.state;
    if (!challenge?.difficulty) return '0.0000';

    const difficulty = ethers.BigNumber.from(challenge.difficulty);
    const numChances = this.calculateNumChances(oddsPercent, difficulty);
    const costWei = this.calculateCostWei(numChances);
    return parseFloat(this.formatEth(costWei)).toFixed(4);
  }

  calculateDisplayChances() {
    const { challenge, oddsPercent } = this.state;
    if (!challenge?.difficulty) return '1';

    const difficulty = ethers.BigNumber.from(challenge.difficulty);
    const numChances = this.calculateNumChances(oddsPercent, difficulty);
    return numChances.toString();
  }

  handlePurchase = async () => {
    const { passphrase, challenge, oddsPercent } = this.state;

    if (!passphrase.trim()) {
      this.setState({ error: 'Please enter a passphrase to protect your bottle.' });
      return;
    }

    this.setState({ loading: true, error: null });

    // If contractService is available, use real transactions
    if (this.props.contractService?.initialized) {
      try {
        // Get connected wallet address
        const address = await this.props.contractService.signer?.getAddress();
        if (!address) {
          throw new Error('Wallet not connected');
        }

        // Calculate number of chances from odds percentage
        const difficulty = ethers.BigNumber.from(challenge.difficulty);
        const numChances = this.calculateNumChances(oddsPercent, difficulty);

        // Create Poseidon commitment matching the ZK circuit
        // commitment = Poseidon(passphrase_field, owner_field)
        const commitment = await cryptoService.generateCommitment(passphrase, address);

        // Get current block timestamp from the provider to ensure target is in future
        const provider = this.props.contractService.provider;
        const block = await provider.getBlock('latest');
        const currentBlockTime = block.timestamp;

        // Set target timestamp to ~2 minutes from current block time (matching app-colasseum)
        const ENTRY_TARGET_OFFSET_SECONDS = 120;
        const targetTimestamp = currentBlockTime + ENTRY_TARGET_OFFSET_SECONDS + 1;

        console.log('[EntryModal] Preparing purchase:', {
          trialId: challenge.id,
          commitment: commitment.toString(),
          targetTimestamp,
          currentBlockTime,
          oddsPercent,
          numChances: numChances.toString(),
          difficulty: difficulty.toString(),
        });

        // Enter the trial (valor)
        const { chanceId } = await this.props.contractService.valor(
          challenge.id,
          commitment.toString(),
          targetTimestamp,
          numChances.toNumber()
        );

        // Store passphrase for later reveal
        storePassphrase(chanceId, passphrase);

        this.setState({ loading: false });
        eventBus.emit('modal:close');
        eventBus.emit('bottle:purchased', {
          chanceId,
          challenge,
          oddsPercent,
          numChances: numChances.toString(),
          passphrase,
          price: this.calculateDisplayPrice(),
        });
      } catch (error) {
        console.error('[EntryModal] Failed to purchase bottle:', error);
        this.setState({
          loading: false,
          error: error.reason || error.message || 'Transaction failed',
        });
      }
    } else {
      // Fixture mode - simulate with timeout
      setTimeout(() => {
        this.setState({ loading: false });
        eventBus.emit('modal:close');
        eventBus.emit('bottle:purchased', {
          challenge,
          oddsPercent,
          passphrase,
          price: this.calculateDisplayPrice(),
        });
      }, 1500);
    }
  };

  render() {
    const { challenge, oddsPercent, passphrase, loading, error, isOwner, showCancelConfirm, cancelling } = this.state;

    if (!challenge) {
      return h('div', { className: 'challenge-wizard__panel' },
        h('p', { className: 'muted' }, 'No challenge selected')
      );
    }

    const price = this.calculateDisplayPrice();
    const chances = this.calculateDisplayChances();
    const canPurchase = passphrase.trim().length > 0 && !loading && !cancelling;

    return h('div', { className: 'challenge-wizard__panel' },
      h('div', { className: 'wizard-header' },
        h('div', { className: 'wizard-header__copy' },
          h('h2', null, 'Get Your Bottles'),
          h('p', { className: 'caption' }, 'After purchase, your bottles need 15 minutes of refrigeration before you can pop them to check for a winning cap.')
        ),
        h('button', {
          className: 'icon-btn wizard-header__close',
          type: 'button',
          onClick: this.handleClose,
        }, 'Close')
      ),
      h('div', { className: 'form-grid' },
        h('div', { className: 'prize-summary', 'aria-hidden': 'false' },
          challenge.image && h('div', { className: 'prize-summary__image' },
            isIpfsUri(challenge.image)
              ? h(IpfsImage, { src: challenge.image, alt: challenge.title })
              : h('img', { src: challenge.image, alt: challenge.title })
          ),
          h('div', { className: 'prize-summary__details' },
            h('strong', null, challenge.title),
            h('p', { className: 'muted small-text' }, `Appraisal: ${challenge.appraisalEth} ETH`)
          )
        ),

        h('label', null,
          h('span', { className: 'label-row' },
            'Bottle Secret',
            h('button', {
              className: 'info-pill info-pill--mini',
              type: 'button',
              'data-tooltip': "Keeps your win state private so you can claim in peace. Don't lose this passphrase or you can't claim a prize. (don't just say milady)",
            }, '\u2139\uFE0E')
          ),
          h('input', {
            type: 'text',
            value: passphrase,
            placeholder: 'Passphrase (e.g., my-secret-phrase)',
            onInput: this.handlePassphraseChange,
          })
        ),

        h('div', { className: 'slider-row' },
          h('div', null,
            h('p', { className: 'label' }, 'Victory Odds'),
            h('div', null, `${oddsPercent}%`)
          ),
          h('input', {
            type: 'range',
            min: '1',
            max: '99',
            value: oddsPercent,
            onInput: this.handleOddsInput,
            onChange: this.handleOddsChange,
          })
        ),

        h('div', { className: 'payment-readout' },
          'Bottle Price: ',
          h('strong', null, `${price} ETH`)
        ),

        error && h('p', { className: 'form-error' }, error),

        h('div', {
          className: `modal-loader ${loading ? 'active' : ''}`,
          'aria-hidden': String(!loading),
        }),

        h('button', {
          className: 'btn primary full',
          type: 'button',
          disabled: !canPurchase,
          onClick: this.handlePurchase,
        }, loading ? 'Processing...' : 'Buy Bottle'),

        // Owner cancel section
        isOwner && h('div', { className: 'owner-cancel-section' },
          h('hr', { className: 'section-divider' }),
          h('p', { className: 'muted small-text owner-cancel-label' }, 'You created this challenge'),
          showCancelConfirm
            ? h('div', { className: 'cancel-confirm-row' },
                h('span', { className: 'cancel-confirm-text' }, 'Cancel this challenge?'),
                h('button', {
                  className: 'btn ghost small',
                  type: 'button',
                  disabled: cancelling,
                  onClick: this.handleHideCancelConfirm,
                }, 'No'),
                h('button', {
                  className: 'btn danger small',
                  type: 'button',
                  disabled: cancelling,
                  onClick: this.handleConfirmCancel,
                }, cancelling ? 'Cancelling...' : 'Yes, Cancel')
              )
            : h('button', {
                className: 'btn ghost full',
                type: 'button',
                onClick: this.handleShowCancelConfirm,
              }, 'Cancel Challenge')
        )
      )
    );
  }
}

export default EntryModal;
