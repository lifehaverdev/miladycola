import { Component, h, eventBus } from '@monygroupcorp/microact';

/**
 * RefundModal - Shows refundable chances grouped by trial and allows batch claiming.
 */
class RefundModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      chances: [],
      processing: null, // trialId currently being processed
      processedTrials: new Set(), // trialIds that have been successfully refunded
      error: null,
    };
  }

  setChances(chances) {
    this.setState({
      chances,
      processing: null,
      processedTrials: new Set(),
      error: null,
    });
  }

  /**
   * Group chances by trialId for batch claiming
   */
  getTrialGroups() {
    const groups = new Map();
    for (const chance of this.state.chances) {
      const trialId = String(chance.trialId);
      if (!groups.has(trialId)) {
        groups.set(trialId, {
          trialId,
          chances: [],
          totalBottles: 0,
          totalRefund: 0,
        });
      }
      const group = groups.get(trialId);
      group.chances.push(chance);
      group.totalBottles += chance.numChances || 1;
      group.totalRefund += (chance.numChances || 1) * 0.000000001; // 1 gwei per bottle
    }
    return Array.from(groups.values());
  }

  handleClose = () => {
    eventBus.emit('modal:close');
  };

  handleClaimTrialRefund = async (trialId) => {
    if (!trialId || this.state.processing) return;

    this.setState({ processing: trialId, error: null });

    try {
      // Get all chanceIds for this trial
      const trialChances = this.state.chances.filter(c => String(c.trialId) === trialId);
      const chanceIds = trialChances.map(c => parseInt(c.chanceId, 10));

      // Batch refund all chances in one transaction
      await this.props.contractService.perseverance(chanceIds);

      // Mark trial as processed
      const newProcessedTrials = new Set(this.state.processedTrials);
      newProcessedTrials.add(trialId);

      // Remove these chances from list
      const remainingChances = this.state.chances.filter(c => String(c.trialId) !== trialId);

      this.setState({
        processing: null,
        processedTrials: newProcessedTrials,
        chances: remainingChances,
      });

      // If no more refunds, close modal after a short delay
      if (remainingChances.length === 0) {
        setTimeout(() => {
          eventBus.emit('modal:close');
          eventBus.emit('refundable:found', { count: 0, chances: [] });
        }, 1500);
      }
    } catch (error) {
      console.error('[RefundModal] Refund failed:', error);
      this.setState({
        processing: null,
        error: error.reason || error.message || 'Refund failed',
      });
    }
  };

  render() {
    const { processing, processedTrials, error } = this.state;
    const trialGroups = this.getTrialGroups();

    const allDone = trialGroups.length === 0 && processedTrials.size > 0;

    return h('div', { className: 'refund-modal__panel' },
      h('div', { className: 'refund-modal__header' },
        h('h2', null, 'Claim Refunds'),
        h('button', {
          className: 'icon-btn refund-modal__close',
          type: 'button',
          onClick: this.handleClose,
        }, 'Close')
      ),
      h('div', { className: 'refund-modal__body' },
        allDone
          ? h('div', { className: 'refund-modal__success' },
              h('p', null, 'All refunds claimed successfully!')
            )
          : trialGroups.length === 0
            ? h('p', { className: 'muted' }, 'No refunds available.')
            : [
                h('p', { key: 'intro', className: 'refund-modal__intro' },
                  'The following challenges were cancelled. Click "Claim" to refund all your entries for that challenge in one transaction.'
                ),
                h('div', { key: 'list', className: 'refund-list' },
                  trialGroups.map(group => {
                    const isProcessing = processing === group.trialId;
                    const entryCount = group.chances.length;

                    return h('div', { key: group.trialId, className: 'refund-item' },
                      h('div', { className: 'refund-item__info' },
                        h('span', { className: 'refund-item__trial' }, `Trial #${group.trialId}`),
                        h('span', { className: 'refund-item__details' },
                          `${group.totalBottles} bottle${group.totalBottles === 1 ? '' : 's'}${entryCount > 1 ? ` (${entryCount} entries)` : ''}`
                        )
                      ),
                      h('div', { className: 'refund-item__amount' },
                        h('span', null, `${group.totalRefund.toFixed(9)} ETH`)
                      ),
                      h('button', {
                        className: 'btn primary small refund-trial__claim-btn',
                        type: 'button',
                        disabled: isProcessing || !!processing,
                        onClick: () => this.handleClaimTrialRefund(group.trialId),
                      }, isProcessing ? 'Claiming...' : 'Claim All')
                    );
                  })
                ),
              ],
        error && h('p', { className: 'form-error' }, error)
      )
    );
  }
}

export default RefundModal;
