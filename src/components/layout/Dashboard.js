import { Component, h, eventBus } from '@monygroupcorp/microact';
import BottleCard from '../ui/BottleCard.js';

class Dashboard extends Component {
  constructor(props) {
    super(props);
    this.state = {
      collapsed: false,
      refundableChances: [],
      bottles: props.bottles || [],
    };
  }

  didMount() {
    // Listen for refundable chances found
    this.subscribe('refundable:found', ({ chances }) => {
      this.setState({ refundableChances: chances });
    });
  }

  setRefundableChances(chances) {
    this.setState({ refundableChances: chances });
  }

  setBottles(bottles) {
    this.setState({ bottles });
  }

  handleClaimRefunds = () => {
    // Emit event to open refund modal
    eventBus.emit('modal:openRefund', {
      chances: this.state.refundableChances
    });
  };

  toggleCollapse = () => {
    this.setState({ collapsed: !this.state.collapsed });
  };

  handleRefresh = () => {
    eventBus.emit('dashboard:refresh');
  };

  render() {
    const { collapsed, refundableChances, bottles } = this.state;
    const count = bottles.length;
    const refundCount = refundableChances.length;

    const bodyClass = collapsed ? 'collapsed' : '';
    const toggleText = collapsed ? 'Show' : 'Hide';
    const isEmpty = count === 0;

    // Compact mode for vending machine dispense slot
    if (this.props.compact) {
      return h('div', { className: 'dispense-bottles' },
        // Show refundable alert in compact mode too
        refundCount > 0 && h('div', { className: 'refundable-alert refundable-alert--compact' },
          h('div', { className: 'refundable-alert__content' },
            h('span', { className: 'refundable-alert__icon' }, '\u{1F4B0}'),
            h('span', { className: 'refundable-alert__text-compact' },
              `${refundCount} refund${refundCount === 1 ? '' : 's'} available`
            )
          ),
          h('button', {
            className: 'btn primary small',
            type: 'button',
            onClick: this.handleClaimRefunds,
          }, 'Claim')
        ),
        isEmpty
          ? h('p', { className: 'muted dispense-empty' }, 'Empty - buy a bottle to see it here!')
          : bottles.map(bottle =>
              h(BottleCard, { key: bottle.id, bottle, compact: true })
            )
      );
    }

    // Standard dashboard
    return h('section', { className: 'dashboard' },
      refundCount > 0 && h('div', { className: 'refundable-alert' },
        h('div', { className: 'refundable-alert__content' },
          h('span', { className: 'refundable-alert__icon' }, '\u{1F4B0}'),
          h('div', { className: 'refundable-alert__text' },
            h('span', { className: 'refundable-alert__title' }, 'Refunds Available'),
            h('span', { className: 'refundable-alert__count' }, `${refundCount} cancelled ${refundCount === 1 ? 'trial' : 'trials'} with unclaimed refunds`)
          )
        ),
        h('button', {
          className: 'btn primary small',
          type: 'button',
          onClick: this.handleClaimRefunds,
        }, 'Claim Refunds')
      ),

      h('div', { className: 'dashboard-controls' },
        h('div', { className: 'dashboard-title-row' },
          h('h2', null, 'Your Bottles'),
          h('span', null, count)
        ),
        h('div', { className: 'dashboard-controls-actions' },
          h('button', {
            className: 'btn secondary small',
            type: 'button',
            onClick: this.handleRefresh,
          }, 'Refresh'),
          h('button', {
            className: 'btn ghost small',
            type: 'button',
            onClick: this.toggleCollapse,
          }, toggleText)
        )
      ),

      h('div', { className: `dashboard-body bottles-only ${bodyClass}` },
        isEmpty
          ? h('p', { className: 'muted' }, 'No bottles yet\u2014load a challenge to see them here.')
          : bottles.map(bottle =>
              h(BottleCard, { key: bottle.id, bottle })
            )
      )
    );
  }
}

export default Dashboard;
