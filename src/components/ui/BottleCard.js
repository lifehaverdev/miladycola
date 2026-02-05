import { Component, h, eventBus } from '@monygroupcorp/microact';
import { hasRevealBeenSeen, getStoredWinResult, storeWinResult, setRevealSeen, getStoredPassphrase } from './EntryModal.js';

// Cache the bottle SVG template
let bottleSvgTemplate = null;

class BottleCard extends Component {
  constructor(props) {
    super(props);
    const bottle = props.bottle;

    // Check if this bottle's reveal has already been seen
    const alreadySeen = hasRevealBeenSeen(bottle.id);
    const storedResult = getStoredWinResult(bottle.id);

    // Determine initial state
    let initialStatus = bottle.status;
    // Use pre-evaluated result from AppShell, stored result, or null
    let initialResult = bottle.result || (storedResult !== null ? (storedResult ? 'win' : 'loss') : null);

    // Check if bottle is already cooled (past cooldown time)
    // Status 'ready' from AppShell means cooldown is complete
    const isCooled = bottle.status === 'ready' ||
                     (bottle.cooldownRemaining <= 0 && bottle.status !== 'cooling');

    // If reveal was seen or we have a result, show it directly
    // But preserve 'claimed' status (already finalized on-chain)
    if (initialStatus !== 'claimed' && (alreadySeen || initialResult) && isCooled) {
      initialStatus = 'revealed';
    }

    // Compute absolute target time from relative cooldown so timer survives background tabs
    const cooldownSecs = bottle.cooldownRemaining || 0;
    this._cooldownTarget = cooldownSecs > 0 ? Date.now() + cooldownSecs * 1000 : 0;

    this.state = {
      cooldownRemaining: cooldownSecs,
      bottleDataUrl: null,
      status: initialStatus,
      result: initialResult,
      watchedCountdownFinish: false, // True if user watched countdown hit 0
    };
  }

  async didMount() {
    // Load and colorize bottle SVG
    await this.loadBottleSvg();

    // Subscribe to reveal results
    this.subscribe('bottle:revealed', ({ bottle, result }) => {
      if (bottle.id === this.props.bottle.id) {
        this.setState({
          status: 'revealed',
          result,
        });
      }
    });

    // Start countdown timer if cooling
    this._startCountdownIfNeeded();
  }

  didUpdate() {
    // When props are refreshed (e.g. dashboard refresh), the bottle may now
    // have valid cooldown data that wasn't available on first render.
    const bottle = this.props.bottle;

    if (bottle.cooldownRemaining > 0 && this._cooldownTarget === 0 &&
        this.state.status !== 'revealed' && this.state.status !== 'claimed') {
      // We now have cooldown data — set up the target and start the timer
      this._cooldownTarget = Date.now() + bottle.cooldownRemaining * 1000;
      this.setState({
        cooldownRemaining: bottle.cooldownRemaining,
        status: 'cooling',
      });
      this._startCountdownIfNeeded();
    }
  }

  _startCountdownIfNeeded() {
    // Don't start a second timer
    if (this._countdownRunning) return;
    if (this._cooldownTarget <= 0) return;
    if (this.state.status === 'revealed' || this.state.status === 'claimed') return;

    this._countdownRunning = true;
    this._countdownInterval = this.setInterval(() => {
      // Don't overwrite finalized states
      if (this.state.status === 'revealed' || this.state.status === 'claimable' || this.state.status === 'claimed') return;

      const remaining = Math.max(0, Math.ceil((this._cooldownTarget - Date.now()) / 1000));
      if (remaining <= 0) {
        // User watched the countdown finish - give them the "Pop It" experience
        this.setState({
          cooldownRemaining: 0,
          status: 'ready',
          watchedCountdownFinish: true,
        });
      } else {
        this.setState({ cooldownRemaining: remaining });
      }
    }, 1000);
  }

  async loadBottleSvg() {
    // Yield to ensure DOM node is attached before any setState
    await Promise.resolve();
    const { status, result } = this.state;
    const isWin = status === 'claimed' || status === 'claimable' || (status === 'revealed' && result === 'win');
    const isLoss = status === 'revealed' && result === 'loss';

    if (isWin || isLoss) {
      return;
    }

    try {
      // Use cached template or fetch
      if (!bottleSvgTemplate) {
        const response = await fetch('/bottle.svg');
        bottleSvgTemplate = await response.text();
      }

      const color = this.generateColor(this.props.bottle.id);
      const coloredSvg = bottleSvgTemplate.replace(/BOTTLE_LIQUID_COLOR/g, color);

      // Convert to data URL for img src
      const dataUrl = 'data:image/svg+xml,' + encodeURIComponent(coloredSvg);
      this.setState({ bottleDataUrl: dataUrl });
    } catch (err) {
      console.error('Failed to load bottle SVG:', err);
    }
  }

  generateColor(nonce) {
    // Use the nonce/id to generate a unique hue
    // Multiply by a prime to spread colors apart
    const seed = (nonce * 137) % 360;
    return `hsl(${seed}, 75%, 55%)`;
  }

  handleReveal = () => {
    eventBus.emit('modal:open', { modal: 'reveal', bottle: this.props.bottle });
  };

  handlePreview = () => {
    eventBus.emit('bottle:preview', { bottle: this.props.bottle });
  };

  handleClaim = () => {
    eventBus.emit('bottle:claim', { bottle: this.props.bottle });
  };

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  renderBottleVisual() {
    const { status, result, bottleDataUrl, cooldownRemaining, watchedCountdownFinish } = this.state;
    const color = this.generateColor(this.props.bottle.id);

    // Check if this is a revealed/finalized bottle
    const isFinalized = status === 'revealed' ||
                        status === 'claimable' ||
                        status === 'claimed' ||
                        (status === 'ready' && !watchedCountdownFinish && cooldownRemaining <= 0);

    // Use result from state (pre-evaluated by AppShell or from reveal flow)
    const isWin = isFinalized && result === 'win';
    const isLoss = isFinalized && result === 'loss';

    if (isWin) {
      return h('div', { className: 'bottle-visual-wrapper' },
        h('div', { className: 'bottle-color-circle', style: `background: ${color};` }),
        h('img', { src: '/win.svg', alt: 'Winner', className: 'bottle-result-svg' })
      );
    }

    if (isLoss) {
      return h('div', { className: 'bottle-visual-wrapper' },
        h('div', { className: 'bottle-color-circle', style: `background: ${color};` }),
        h('img', { src: '/loss.svg', alt: 'No luck', className: 'bottle-result-svg' })
      );
    }

    // Regular bottle with colored liquid
    if (bottleDataUrl) {
      return h('img', { src: bottleDataUrl, alt: 'Bottle', className: 'bottle-svg-img' });
    }

    // Fallback while loading
    return h('div', { className: 'bottle-loading' }, 'Loading...');
  }

  render() {
    const { id, challengeTitle, odds, priceEth } = this.props.bottle;
    const { cooldownRemaining, status, result, watchedCountdownFinish } = this.state;

    const isCooling = status === 'cooling' && cooldownRemaining > 0;
    const isReady = status === 'ready' && watchedCountdownFinish;
    const isClaimed = status === 'claimed';
    // Cooldown done: either explicitly 'revealed'/'ready', or 'cooling' but time ran out
    const cooldownDone = cooldownRemaining <= 0 && status !== 'claimed';
    const isRevealed = status === 'revealed' ||
                       (status === 'ready' && !watchedCountdownFinish && cooldownDone) ||
                       (status === 'cooling' && cooldownDone);
    const isClaimable = !isClaimed && (status === 'claimable' || (isRevealed && result === 'win' && !this.props.bottle.claimed));

    // Allow reveal if cooldown is done but we don't have a result yet
    // This lets users enter their passphrase manually or retry evaluation
    const needsReveal = isRevealed && result === null;
    const hasStoredPassphrase = needsReveal && getStoredPassphrase(this.props.bottle.id);
    // Only show reveal button if no result yet
    const canReveal = result === null && (isReady || needsReveal || cooldownDone);

    let statusText = '';
    let statusClass = '';
    if (isClaimed) {
      statusText = 'Claimed!';
      statusClass = 'winner';
    } else if (isCooling && cooldownRemaining > 0) {
      statusText = `Cooling: ${this.formatTime(cooldownRemaining)}`;
      statusClass = '';
    } else if (isReady) {
      statusText = 'Ready to pop!';
      statusClass = '';
    } else if (needsReveal && !hasStoredPassphrase) {
      // Cooldown done and no passphrase stored - prompt user to enter it
      statusText = 'Enter passphrase to reveal';
      statusClass = '';
    } else if (needsReveal && hasStoredPassphrase) {
      // Cooldown done, has passphrase but evaluation failed - let them retry
      statusText = 'Ready to reveal';
      statusClass = '';
    } else if (isRevealed) {
      // Use result from state (pre-evaluated or from reveal)
      statusText = result === 'win' ? 'Winner!' : 'No luck';
      statusClass = result === 'win' ? 'winner' : 'loser';
    } else if (isClaimable) {
      statusText = 'Claim your prize!';
      statusClass = 'winner';
    } else if (cooldownDone) {
      // Fallback: cooldown is done but no other state matched - let them reveal
      statusText = 'Ready to reveal';
      statusClass = '';
    }

    return h('article', { className: 'dashboard-bottle-card' },
      h('div', { className: 'dashboard-bottle-media', 'data-reveal-ready': isReady ? 'true' : 'false' },
        h('div', { className: 'dashboard-bottle-visual' },
          this.renderBottleVisual()
        ),
        h('button', {
          className: 'reveal-trigger',
          type: 'button',
          disabled: !canReveal,
          onClick: this.handleReveal,
        }, 'Crack Open')
      ),
      h('div', { className: 'dashboard-bottle-head' },
        h('h4', null, challengeTitle),
        h('span', { className: 'challenge-card__badge' }, `#${id}`)
      ),
      h('p', { className: 'dashboard-bottle-meta' }, `${odds}% chance \u00B7 ${priceEth} ETH`),
      h('p', { className: `dashboard-bottle-status ${statusClass}` }, statusText),
      h('div', { className: 'dashboard-bottle-actions' },
        h('button', {
          className: 'btn ghost small bottle-preview-btn',
          type: 'button',
          onClick: this.handlePreview,
        }, 'Details'),
        canReveal && !isReady && h('button', {
          className: 'btn primary small',
          type: 'button',
          onClick: this.handleReveal,
        }, 'Reveal'),
        isClaimable && h('button', {
          className: 'btn primary small bottle-claim-btn',
          type: 'button',
          onClick: this.handleClaim,
        }, 'Claim')
      )
    );
  }
}

export default BottleCard;
