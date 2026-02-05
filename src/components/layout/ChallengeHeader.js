import { Component, h, eventBus } from '@monygroupcorp/microact';

class ChallengeHeader extends Component {
  constructor(props) {
    super(props);
    this.state = {
      connected: false,
      address: null,
    };
  }

  didMount() {
    if (this.props.walletService.isConnected?.()) {
      const address = this.props.walletService.getAddress?.() || this.props.walletService.address;
      queueMicrotask(() => {
        this.setState({ connected: true, address });
      });
    }

    this.subscribe('wallet:connected', (data) => {
      this.setState({ connected: true, address: data.address });
    });
    this.subscribe('wallet:disconnected', () => {
      this.setState({ connected: false, address: null });
    });
  }

  handleConnect = () => {
    eventBus.emit('wallet:select');
  };

  handleDisconnect = async () => {
    try {
      await this.props.walletService.disconnect();
    } catch (err) {
      console.error('Wallet disconnect failed:', err);
    }
  };

  handleHomeClick = () => {
    if (this.props.onHomeClick) {
      this.props.onHomeClick();
    }
  };

  formatAddress(addr) {
    if (!addr) return '';
    return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
  }

  render() {
    const { connected, address } = this.state;
    const connectedClass = connected ? 'connected' : '';

    return h('header', { className: `wallet-bar challenge-header ${connectedClass}` },
      h('div', { className: 'challenge-header__left' },
        h('button', {
          className: 'btn ghost challenge-header__home',
          type: 'button',
          onClick: this.handleHomeClick,
        }, '\u2190 Home')
      ),
      h('div', { className: 'wallet-tray' },
        !connected && h('button', {
          className: 'btn secondary',
          type: 'button',
          onClick: this.handleConnect,
        }, 'Connect wallet'),
        connected && h('span', null, this.formatAddress(address)),
        connected && h('button', {
          className: 'btn ghost small disconnect-btn',
          type: 'button',
          onClick: this.handleDisconnect,
        },
          h('span', { 'aria-hidden': 'true' }, '\u23CF\uFE0E'),
          h('span', { className: 'disconnect-text' }, 'Disconnect')
        )
      )
    );
  }
}

export default ChallengeHeader;
