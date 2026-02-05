import { Component, h, eventBus } from '@monygroupcorp/microact';

class HeroSection extends Component {
  openChallengeWizard = () => {
    eventBus.emit('modal:open', { modal: 'challengeWizard' });
  };

  openDocumentation = () => {
    window.open('/docs.html', '_blank', 'noopener');
  };

  render() {
    return h('section', { className: 'hero-section' },
      h('h1', { 'data-text': 'MILADYCOLA' }, 'MILADYCOLA'),
      h('p', { className: 'hero-subtitle' }, '#1 Permissionless Decentralized Carbonated Beverage'),
      h('div', { className: 'hero-cta-row' },
        h('button', {
          className: 'btn primary',
          type: 'button',
          onClick: this.openChallengeWizard,
        }, 'Create a challenge'),
        h('button', {
          className: 'btn ghost',
          type: 'button',
          onClick: this.openDocumentation,
        }, 'Documentation')
      )
    );
  }
}

export default HeroSection;
