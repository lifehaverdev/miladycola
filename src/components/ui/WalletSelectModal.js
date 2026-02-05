import { Component, h, eventBus } from '@monygroupcorp/microact';

class WalletSelectModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      wallets: {},
      loading: false,
      error: null,
    };
  }

  refresh() {
    if (!this.props.walletService) return;

    const wallets = this.props.walletService.getAvailableWallets();
    this.setState({
      wallets,
      loading: false,
      error: null,
    });
  }

  handleClose = () => {
    eventBus.emit('modal:close');
  };

  handleWalletSelect = async (walletType) => {
    if (!walletType || !this.props.walletService) return;

    this.setState({ loading: true, error: null });

    try {
      await this.props.walletService.selectWallet(walletType);
      await this.props.walletService.connect();
      eventBus.emit('modal:close');
    } catch (error) {
      console.error('[WalletSelectModal] Connection failed:', error);
      this.setState({
        loading: false,
        error: error.message || 'Failed to connect wallet',
      });
    }
  };

  getWalletDisplayName(type) {
    const names = {
      metamask: 'MetaMask',
      rabby: 'Rabby',
      rainbow: 'Rainbow',
      phantom: 'Phantom',
      coinbase: 'Coinbase Wallet',
      trust: 'Trust Wallet',
      okx: 'OKX Wallet',
    };
    return names[type] || type.charAt(0).toUpperCase() + type.slice(1);
  }

  render() {
    const { wallets, loading, error } = this.state;
    const walletTypes = Object.keys(wallets);

    return h('div', { className: 'challenge-wizard__panel wallet-select-panel' },
      h('div', { className: 'wizard-header' },
        h('div', { className: 'wizard-header__copy' },
          h('h2', null, 'Connect Wallet'),
          h('p', { className: 'caption' }, 'Choose a wallet to connect to Colasseum.')
        ),
        h('button', {
          className: 'icon-btn wizard-header__close',
          type: 'button',
          onClick: this.handleClose,
        }, 'Close')
      ),
      h('div', { className: 'wallet-options-grid' },
        walletTypes.length > 0
          ? walletTypes.map(type =>
              h('button', {
                className: 'wallet-option-btn',
                type: 'button',
                disabled: loading,
                onClick: () => this.handleWalletSelect(type),
              },
                h('span', { className: 'wallet-option-name' }, this.getWalletDisplayName(type))
              )
            )
          : h('p', { className: 'muted' }, 'No wallets detected. Please install MetaMask or another browser wallet.')
      ),
      error && h('p', { className: 'form-error' }, error),
      loading && h('div', { className: 'modal-loader active', 'aria-hidden': 'false' })
    );
  }
}

export default WalletSelectModal;
