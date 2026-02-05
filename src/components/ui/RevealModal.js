import { Component, h, eventBus } from '@monygroupcorp/microact';
import { setRevealSeen, storeWinResult, getStoredPassphrase, storePassphrase } from './EntryModal.js';
import cryptoService from '../../services/CryptoService.js';

const SITE_URL = 'https://miladycola.net';

function shareOnX(text) {
  const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SITE_URL)}`;
  window.open(url, '_blank', 'noopener,width=550,height=420');
}

class RevealModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      bottle: null,
      countdown: 3,
      phase: 'ready', // ready, needsPassphrase, counting, revealing, result, error
      result: null,
      manualPassphrase: '',
      errorMessage: null,
    };
    this.countdownInterval = null;
  }

  setBottle(bottle) {
    // Check if we have a stored passphrase
    const storedPassphrase = getStoredPassphrase(bottle?.id);
    this.setState({
      bottle,
      countdown: 3,
      phase: storedPassphrase ? 'ready' : 'needsPassphrase',
      result: null,
      manualPassphrase: '',
      errorMessage: null,
    });
  }

  handlePassphraseInput = (e) => {
    this.setState({ manualPassphrase: e.target.value, errorMessage: null });
  };

  handlePassphraseSubmit = () => {
    const { manualPassphrase, bottle } = this.state;
    if (!manualPassphrase.trim()) {
      this.setState({ errorMessage: 'Please enter your passphrase' });
      return;
    }
    // Store it for future use on this device
    if (bottle?.id) {
      storePassphrase(bottle.id, manualPassphrase.trim());
    }
    this.setState({ phase: 'ready' });
  };

  handleClose = () => {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    eventBus.emit('modal:close');
  };

  startReveal = () => {
    this.setState({ phase: 'counting' });

    this.countdownInterval = setInterval(() => {
      const newCount = this.state.countdown - 1;

      if (newCount <= 0) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
        this.doReveal();
      } else {
        this.setState({ countdown: newCount });
      }
    }, 1000);
  };

  willUnmount() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  async doReveal() {
    this.setState({ phase: 'revealing' });

    const bottle = this.state.bottle;

    try {
      // Get passphrase - prefer stored, fall back to manual entry
      const passphrase = getStoredPassphrase(bottle.id) || this.state.manualPassphrase.trim();
      if (!passphrase) {
        this.setState({ phase: 'needsPassphrase', errorMessage: 'Please enter your passphrase' });
        return;
      }

      // Require contract service for real evaluation - no more random fallbacks
      if (!this.props.contractService?.initialized) {
        throw new Error('Contract service not available');
      }

      if (!bottle.targetTimestamp || !bottle.difficulty) {
        throw new Error('Bottle missing required fields (targetTimestamp or difficulty)');
      }

      // Check if randomness is available (time-based check)
      const isAvailable = await this.props.contractService.isRandomnessAvailable(bottle.targetTimestamp);
      if (!isAvailable) {
        throw new Error('Randomness not available yet. Please wait for the cooldown period.');
      }

      // Find canonical beacon root by searching actual blocks
      const { root: beaconRoot, timestamp: canonicalTimestamp } =
        await this.props.contractService.findCanonicalBeaconRoot(bottle.targetTimestamp);

      console.log('[RevealModal] Found canonical beacon root at timestamp:', canonicalTimestamp);

      if (!beaconRoot || beaconRoot === '0x' + '0'.repeat(64)) {
        throw new Error('No beacon root available for this timestamp range.');
      }

      // Evaluate win condition using real beacon randomness
      const { isWinner } = await cryptoService.evaluateWinCondition(
        passphrase,
        beaconRoot,
        bottle.difficulty,
        bottle.numChances
      );

      console.log('[RevealModal] Real evaluation result:', isWinner);

      const resultStr = isWinner ? 'win' : 'loss';

      // Store the result and mark reveal as seen
      if (bottle?.id) {
        storeWinResult(bottle.id, isWinner);
        setRevealSeen(bottle.id);
      }

      this.setState({
        phase: 'result',
        result: resultStr,
      });

      // Emit event for other components to update
      eventBus.emit('bottle:revealed', {
        bottle,
        result: resultStr,
      });

    } catch (error) {
      console.error('[RevealModal] Error evaluating win condition:', error);
      // Show error state instead of fake result
      this.setState({
        phase: 'error',
        errorMessage: error.message,
      });
    }
  }

  render() {
    const { bottle, countdown, phase, result, manualPassphrase, errorMessage } = this.state;

    if (!bottle) {
      return h('div', { className: 'reveal-modal__panel' },
        h('p', { className: 'muted' }, 'No bottle selected')
      );
    }

    // Passphrase entry phase
    if (phase === 'needsPassphrase') {
      return h('div', { className: 'reveal-modal__panel' },
        h('button', {
          className: 'icon-btn',
          type: 'button',
          onClick: this.handleClose,
        }, 'Close'),
        h('div', { className: 'reveal-modal__content' },
          h('p', { className: 'label' }, bottle.challengeTitle),
          h('h3', { className: 'reveal-modal__status' }, 'Enter Your Passphrase'),
          h('p', { className: 'muted small-text' }, 'Enter the passphrase you used when buying this bottle to check your result.'),
          h('div', { className: 'passphrase-entry' },
            h('input', {
              type: 'text',
              value: manualPassphrase,
              placeholder: 'Your secret passphrase',
              onInput: this.handlePassphraseInput,
              autoFocus: true,
            }),
            errorMessage && h('p', { className: 'form-error' }, errorMessage),
            h('button', {
              className: 'btn primary',
              type: 'button',
              disabled: !manualPassphrase.trim(),
              onClick: this.handlePassphraseSubmit,
            }, 'Continue')
          )
        )
      );
    }

    // Error phase
    if (phase === 'error') {
      return h('div', { className: 'reveal-modal__panel' },
        h('button', {
          className: 'icon-btn',
          type: 'button',
          onClick: this.handleClose,
        }, 'Close'),
        h('div', { className: 'reveal-modal__content' },
          h('p', { className: 'label' }, bottle.challengeTitle),
          h('h3', { className: 'reveal-modal__status reveal-modal__status--error' }, 'Error'),
          h('p', { className: 'form-error' }, errorMessage || 'Something went wrong'),
          h('button', {
            className: 'btn ghost',
            type: 'button',
            onClick: () => this.setState({ phase: 'needsPassphrase', errorMessage: null }),
          }, 'Try Different Passphrase')
        )
      );
    }

    let statusText = '';
    let countdownDisplay = countdown;
    let resultClass = '';
    let resultText = '';

    switch (phase) {
      case 'ready':
        statusText = 'Ready to pop!';
        countdownDisplay = '';
        break;
      case 'counting':
        statusText = 'Shaking...';
        break;
      case 'revealing':
        statusText = 'Checking cap\u2026';
        countdownDisplay = '\u2026';
        break;
      case 'result':
        statusText = result === 'win' ? 'WINNER!' : 'Better luck next time';
        countdownDisplay = result === 'win' ? '\u{1F389}' : '';
        resultClass = result === 'win' ? 'winner' : 'loser';
        resultText = result === 'win'
          ? 'You won! Claim your prize from the dashboard.'
          : 'No winning cap this time.';
        break;
    }

    const showStartButton = phase === 'ready';

    const isLoss = phase === 'result' && result === 'loss';
    const isWin = phase === 'result' && result === 'win';

    return h('div', { className: 'reveal-modal__panel' },
      h('button', {
        className: 'icon-btn',
        type: 'button',
        onClick: this.handleClose,
      }, 'Close'),
      h('div', { className: 'reveal-modal__content' },
        h('p', { className: 'label' }, bottle.challengeTitle),
        h('div', { className: 'reveal-modal__countdown' }, countdownDisplay),
        h('p', { className: 'reveal-modal__status' }, statusText),
        h('div', { className: `reveal-modal__result ${resultClass}` }, resultText),
        showStartButton && h('button', {
          className: 'btn primary',
          type: 'button',
          onClick: this.startReveal,
        }, 'Pop It!'),
        showStartButton && h('button', {
          className: 'btn ghost small',
          type: 'button',
          onClick: () => this.setState({ phase: 'needsPassphrase', manualPassphrase: '' }),
        }, 'Use Different Passphrase'),
        isLoss && h('button', {
          className: 'btn ghost share-btn',
          type: 'button',
          onClick: () => shareOnX(`Just popped a @miladycola bottle... no luck this time 😔\n\nTry your luck on NFT prizes with ZK proofs 🍾`),
        }, '𝕏 Share the L'),
        isWin && h('button', {
          className: 'btn primary share-btn',
          type: 'button',
          onClick: () => shareOnX(`🎉 Just won a prize on @miladycola!\n\nZK-powered NFT challenge with real Ethereum beacon randomness 🍾`),
        }, '𝕏 Share Your Win!')
      )
    );
  }
}

export default RevealModal;
