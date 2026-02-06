# Colasseum

A ZK-SNARK provably fair NFT challenge system using EIP-4788 beacon randomness.

**Live App:** [https://miladycola.net](https://miladycola.net)

## Mainnet Contracts

| Contract | Address |
|----------|---------|
| Colasseum | [`0xEBB82461b745d4be95C95beCa7095f0EC6c530AC`](https://etherscan.io/address/0xEBB82461b745d4be95C95beCa7095f0EC6c530AC) |
| Groth16Verifier | [`0x6451e5027EC265c117FbDA85579B337F459D3837`](https://etherscan.io/address/0x6451e5027EC265c117FbDA85579B337F459D3837) |
| BeaconRandomnessOracle | [`0xFac6478a6e9Cece4931b25a7d938c013F4568779`](https://etherscan.io/address/0xFac6478a6e9Cece4931b25a7d938c013F4568779) |

## How It Works

Colasseum enables NFT holders to create on-chain trials where challengers stake their NFTs against participants who enter with committed chances. The protocol uses Ethereum's beacon chain randomness (EIP-4788) as an unpredictable, manipulation-resistant entropy source, combined with Groth16 zero-knowledge proofs to verify valid claims without revealing the preimage.

A challenger creates a trial by depositing an NFT and setting an appraisal value that determines the difficulty threshold. Participants enter by calling `valor()` with a commitment hash and target timestamp, paying a fixed cost per chance. After the "Deep Bake" finality delay (768 seconds), participants can attempt to claim victory by generating a ZK proof that their committed preimage, combined with the beacon randomness, produces a hash below the difficulty threshold.

If a participant succeeds, they receive the staked NFT while the challenger receives accumulated entry fees (minus a charity donation). If the challenger withdraws (cowardice), participants can reclaim their entry fees through perseverance.

## Key Concepts

| Term | Description |
|------|-------------|
| **Trial** | An NFT-backed challenge created by a challenger with a set appraisal and difficulty |
| **Chance** | A participant's entry commitment with a target timestamp for randomness |
| **Appraisal** | The challenger's stated value for the NFT, which inversely determines difficulty |
| **Difficulty** | The threshold for a valid proof: `(MAX_HASH / appraisal) * FIXED_COST` |
| **Deep Bake** | 768-second finality delay (2 epochs) before beacon roots can be used |
| **Valor** | The act of entering a trial with a commitment |
| **Victory** | Successfully claiming the NFT with a valid ZK proof |
| **Cowardice** | Challenger withdrawing from an active trial (forfeits deposit to charity) |
| **Perseverance** | Participants reclaiming entry fees after a trial is cancelled |

## Contract Architecture

| Contract | Role |
|----------|------|
| `Colasseum` | Main protocol: trial creation, entry, settlement, charity distribution |
| `BeaconRandomnessOracle` | Stateless wrapper around EIP-4788 enforcing Deep Bake finality |
| `Groth16Verifier` | On-chain ZK-SNARK verifier for claim proofs |

## Development Setup

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`foundryup` + `anvil` + `forge`)
- Node.js 18+
- A browser wallet capable of connecting to a custom RPC

### Commands

```bash
# Install dependencies
npm run setup

# Start local chain with deployed contracts
npm run chain:start

# Run frontend development server
npm run dev

# Stop local chain
npm run chain:stop
```

Point your wallet at `http://127.0.0.1:8545` (Chain ID 31337) to interact with the local deployment.

## Testing

```bash
cd contracts
forge test
```

## Security Considerations

**Commitment Scheme**: Participants commit to a preimage hash before randomness is revealed. The commitment binds them to their choice while hiding the actual value until claim time.

**Beacon Randomness**: EIP-4788 beacon roots are determined by the validator set and cannot be predicted or manipulated by individual actors. The 768-second Deep Bake delay ensures finality before randomness is used.

**Charity Controls**: Charity address and generosity rate changes require a two-step process: proposal by the current charity (`honor`) and confirmation by the witness (`affirm`). This prevents unilateral changes to fund distribution.

**Locked Charity Fee**: Each trial locks the charity fee percentage at creation time in the `charityBps` field. This prevents the protocol owner from changing the fee after participants have entered, protecting against fee manipulation.

**Missed Slot Handling**: If the target timestamp's beacon slot was missed, the contract searches forward up to 12 slots (144 seconds) to find a valid root. Frontend proof generators must use the same algorithm.
