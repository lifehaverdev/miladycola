import { Component, h, eventBus } from '@monygroupcorp/microact';
import { ethers } from 'ethers';
import contractInfo from '../generated/contract.json';

class CounterCard extends Component {
  constructor(props) {
    super(props);
    this.state = {
      value: null,
      pending: false,
      error: null,
    };
    this.provider = new ethers.providers.JsonRpcProvider(contractInfo.rpcUrl);
    this.contract = new ethers.Contract(contractInfo.address, contractInfo.abi, this.provider);
  }

  didMount() {
    this.loadValue();
    this.setInterval(() => this.loadValue(), 4000);
    this.subscribe('wallet:connected', () => {
      this.setState({ error: null });
    });
  }

  async loadValue() {
    try {
      const value = await this.contract.value();
      this.setState({ value: value.toString(), error: null });
    } catch (error) {
      console.error('Failed to read counter value', error);
      this.setState({ error: 'Unable to read counter value. Is Anvil running?' });
    }
  }

  handleIncrement = async () => {
    await this.sendTx('increment');
  };

  handleDecrement = async () => {
    await this.sendTx('decrement');
  };

  handleRefresh = () => {
    this.loadValue();
  };

  async sendTx(method) {
    if (!this.props.walletService.isConnected()) {
      this.setState({ error: 'Connect a wallet that points to the local Anvil network.' });
      return;
    }

    try {
      this.setState({ pending: true, error: null });
      const signer = this.props.walletService.signer || (this.props.walletService.ethersProvider?.getSigner());
      if (!signer) {
        throw new Error('Wallet signer unavailable.');
      }
      const tx = await this.contract.connect(signer)[method]();
      await tx.wait();
      await this.loadValue();
    } catch (error) {
      console.error('Counter transaction failed', error);
      this.setState({ error: error.message || 'Counter transaction failed.' });
    } finally {
      this.setState({ pending: false });
    }
  }

  render() {
    const { value, pending, error } = this.state;
    const address = contractInfo.address;

    return h('section', { className: 'counter' },
      h('header', null,
        h('h2', null, 'Local Counter'),
        h('p', { className: 'counter__meta' },
          'Contract ', h('code', null, address), h('br'), 'RPC ', h('code', null, contractInfo.rpcUrl)
        )
      ),
      h('div', { className: 'counter__value' },
        value === null
          ? h('span', { className: 'muted' }, 'loading...')
          : h('span', null, value)
      ),
      h('div', { className: 'counter__actions' },
        h('button', { className: 'counter__decrement', disabled: pending, onClick: this.handleDecrement }, '-'),
        h('button', { className: 'counter__increment', disabled: pending, onClick: this.handleIncrement }, '+'),
        h('button', { className: 'counter__refresh', disabled: pending, onClick: this.handleRefresh }, 'Refresh')
      ),
      pending && h('p', { className: 'counter__status' }, 'Waiting for confirmation...'),
      error && h('p', { className: 'counter__error' }, error),
      h('p', { className: 'counter__helper' },
        'This contract is deployed locally via Foundry + Anvil. Use the wallet button to connect, then interact here.'
      )
    );
  }
}

export default CounterCard;
