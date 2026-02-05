import { Component, h, eventBus } from '@monygroupcorp/microact';

class Header extends Component {
  constructor(props) {
    super(props);
    this.state = {
      connected: false,
      address: null,
      notificationCount: 0,
      notificationPanelOpen: false,
    };
  }

  didMount() {
    // Check if already connected (auto-reconnect may have happened before mount)
    // Defer setState to avoid sync update before DOM node is attached
    if (this.props.walletService.isConnected?.()) {
      const address = this.props.walletService.getAddress?.() || this.props.walletService.address;
      queueMicrotask(() => {
        this.setState({
          connected: true,
          address,
        });
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
    // Open wallet selection modal
    eventBus.emit('wallet:select');
  };

  handleDisconnect = async () => {
    try {
      await this.props.walletService.disconnect();
    } catch (err) {
      console.error('Wallet disconnect failed:', err);
    }
  };

  toggleNotificationPanel = () => {
    this.setState({ notificationPanelOpen: !this.state.notificationPanelOpen });
  };

  formatAddress(addr) {
    if (!addr) return '';
    return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
  }

  render() {
    const { connected, address, notificationCount, notificationPanelOpen } = this.state;
    const connectedClass = connected ? 'connected' : '';
    const panelOpen = notificationPanelOpen ? 'true' : 'false';

    // Compact mode for vending machine control panel
    if (this.props.compact) {
      return h('div', { className: 'machine-wallet-compact' },
        !connected && h('button', {
          className: 'btn primary',
          type: 'button',
          onClick: this.handleConnect,
        }, 'Connect'),
        connected && h('button', {
          className: 'btn ghost small',
          type: 'button',
          onClick: this.handleDisconnect,
        }, '\u23CF\uFE0E Disconnect')
      );
    }

    // Standard wallet bar
    return h('header', { className: `wallet-bar ${connectedClass}` },
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
      ),
      h('div', { className: 'notification-bell' },
        h('button', {
          'aria-expanded': panelOpen,
          type: 'button',
          onClick: this.toggleNotificationPanel,
        },
          '\u2139\uFE0E',
          h('span', {
            className: 'bell-badge',
            style: notificationCount > 0 ? '' : 'display:none;',
          }, notificationCount)
        ),
        h('div', { className: 'notification-panel', 'data-open': panelOpen },
          h('p', { className: 'muted' }, 'Account alerts'),
          h('div', null,
            h('p', { className: 'muted' }, 'All clear for now\u2014your alerts will pop in as soon as things update.')
          )
        )
      )
    );
  }
}

export default Header;
