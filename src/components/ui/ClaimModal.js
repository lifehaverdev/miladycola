import { Component, h, eventBus } from '@monygroupcorp/microact';
import { getStoredPassphrase } from './EntryModal.js';

const SITE_URL = 'https://miladycola.net';

function shareOnX(text) {
  const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SITE_URL)}`;
  window.open(url, '_blank', 'noopener,width=550,height=420');
}

class ClaimModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      bottle: null,
      passphrase: '',
      loading: false,
      error: null,
      status: '', // '', 'generating', 'claiming', 'success'
    };
  }

  setBottle(bottle) {
    // Try to auto-fill passphrase from storage
    const storedPassphrase = getStoredPassphrase(bottle.id) || '';

    this.setState({
      bottle,
      passphrase: storedPassphrase,
      loading: false,
      error: null,
      status: '',
    });
  }

  handleClose = () => {
    this.setState({ loading: false, error: null, status: '' });
    eventBus.emit('modal:close');
  };

  handlePassphraseChange = (e) => {
    this.setState({ passphrase: e.target.value, error: null });
  };

  handleSubmitClaim = async () => {
    const { bottle, passphrase } = this.state;

    if (!passphrase.trim()) {
      this.setState({ error: 'Please enter your passphrase' });
      return;
    }

    this.setState({ loading: true, error: null, status: 'generating' });

    // Emit event for AppShell to handle the actual claim
    eventBus.emit('claim:submit', {
      bottle,
      passphrase: passphrase.trim(),
    });
  };

  // Called by AppShell to update status
  setStatus(status, error = null) {
    this.setState({
      status,
      error,
      loading: status !== 'success' && status !== '' && !error,
    });
  }

  render() {
    const { bottle, passphrase, loading, error, status } = this.state;

    if (!bottle) {
      return h('div', { className: 'claim-modal__panel' },
        h('p', { className: 'muted' }, 'No bottle selected')
      );
    }

    const hasStoredPassphrase = getStoredPassphrase(bottle.id);
    const canSubmit = passphrase.trim().length > 0 && !loading;

    let statusText = '';
    switch (status) {
      case 'verifying':
        statusText = 'Verifying passphrase...';
        break;
      case 'generating':
        statusText = 'Generating ZK proof... This may take a moment.';
        break;
      case 'claiming':
        statusText = 'Submitting claim transaction...';
        break;
      case 'success':
        statusText = 'Prize claimed successfully!';
        break;
    }

    return h('div', { className: 'claim-modal__panel' },
      h('div', { className: 'wizard-header' },
        h('div', { className: 'wizard-header__copy' },
          h('h2', null, 'Claim Your Prize'),
          h('p', { className: 'caption' }, `${bottle.challengeTitle} \u00B7 Ticket #${bottle.id}`)
        ),
        h('button', {
          className: 'icon-btn wizard-header__close',
          type: 'button',
          onClick: this.handleClose,
        }, 'Close')
      ),

      h('div', { className: 'form-grid' },
        h('div', { className: 'prize-summary' },
          h('p', { className: 'muted' }, 'Enter your bottle secret to generate the ZK proof and claim your prize.')
        ),

        h('label', null,
          h('span', { className: 'label-row' },
            'Bottle Secret',
            hasStoredPassphrase && h('span', { className: 'muted small-text' }, '(auto-filled from storage)')
          ),
          h('input', {
            type: 'text',
            value: passphrase,
            placeholder: 'Enter your passphrase',
            disabled: loading,
            onInput: this.handlePassphraseChange,
          })
        ),

        error && h('p', { className: 'form-error' }, error),
        statusText && h('p', { className: 'form-status muted' }, statusText),

        h('div', {
          className: `modal-loader ${loading ? 'active' : ''}`,
          'aria-hidden': String(!loading),
        }),

        status === 'success'
          ? h('div', { className: 'claim-success-actions' },
              h('button', {
                className: 'btn primary full share-btn',
                type: 'button',
                onClick: () => shareOnX(`🏆 Just claimed my NFT prize on @miladycola!\n\nZK-powered provably fair challenge using Ethereum beacon randomness 🍾`),
              }, '𝕏 Share Your Victory!'),
              h('button', {
                className: 'btn ghost full',
                type: 'button',
                onClick: this.handleClose,
              }, 'Back to Dashboard')
            )
          : h('button', {
              className: 'btn primary full',
              type: 'button',
              disabled: !canSubmit,
              onClick: this.handleSubmitClaim,
            }, loading ? 'Processing...' : 'Claim Prize')
      )
    );
  }
}

export default ClaimModal;
