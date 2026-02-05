import { Component, h } from '@monygroupcorp/microact';
import AppShell from './layout/AppShell.js';

class App extends Component {
  constructor(props) {
    super(props);
  }

  render() {
    return h(AppShell, {
      walletService: this.props.walletService,
      contractService: this.props.contractService,
      colasseumIndexer: this.props.colasseumIndexer,
      devService: this.props.devService,
      useFixtures: this.props.useFixtures,
    });
  }
}

export default App;
