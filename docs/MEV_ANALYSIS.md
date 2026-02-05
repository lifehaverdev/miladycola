# MEV Analysis: Colasseum Protocol

This document analyzes transaction ordering risks and maximal extractable value (MEV) attack vectors in the Colasseum protocol.

## Commitment Scheme

The protocol implements a commit-reveal pattern that separates the commitment of intent from the revelation of outcomes:

1. **Commit Phase** (`valor`): Participant submits `commitment = hash(preimage)` and `targetTimestamp`
2. **Finality Phase**: 768 seconds pass (Deep Bake)
3. **Reveal Phase** (`victory`): Participant reveals preimage via ZK proof

This temporal separation ensures randomness is determined after commitments are locked.

## Beacon Randomness Properties

EIP-4788 beacon block roots provide strong entropy guarantees:

- **Validator-determined**: Roots derive from the consensus of thousands of validators
- **Pre-committed**: The beacon chain state is fixed before execution layer transactions process
- **Unpredictable**: No single party can compute future roots

The Deep Bake delay of 768 seconds (2 epochs) ensures:

- Beacon state is finalized
- No reorganization can alter the root
- Sufficient block confirmations exist

## Attack Vectors Analyzed

### 1. Front-running `valor()` Entries

**Vector**: Attacker observes a participant's `valor()` transaction in the mempool and front-runs with their own entry.

**Effectiveness**: **Ineffective**

The front-runner does not gain useful information:

- They cannot see the participant's secret preimage (only the commitment hash)
- They cannot predict whether the participant's proof will be valid
- The target timestamp is visible, but the beacon root at that timestamp is not yet known
- Each participant's commitment is independent

**Conclusion**: Front-running entries provides no advantage since the outcome depends on private knowledge (the preimage) that the attacker cannot observe.

### 2. Front-running `victory()` Claims

**Vector**: Attacker observes a valid `victory()` transaction and attempts to claim first.

**Effectiveness**: **Impossible**

The contract enforces:

```solidity
require(chance.owner == msg.sender, "Not chance owner");
```

Only the address that created the chance can claim victory. Even if an attacker extracts the ZK proof from the mempool, they cannot use it because:

- The proof is bound to the specific `chanceId`
- The `chanceId` maps to a specific `owner` address
- The contract verifies the caller matches the owner

**Conclusion**: Claims are owner-bound and cannot be stolen via front-running.

### 3. Sandwich Attacks

**Vector**: Attacker sandwiches a transaction between their own buy/sell orders to profit from price impact.

**Effectiveness**: **Not Applicable**

Sandwich attacks exploit price slippage in AMM swaps. Colasseum has no AMM component:

- Entry cost is fixed at 0.000000001 ETH per chance
- No price discovery mechanism exists
- No liquidity pools or reserves to manipulate

**Conclusion**: The fixed-price model eliminates sandwich attack surfaces.

### 4. Block Builder Collusion

**Vector**: A malicious block builder manipulates which beacon root gets used by reordering or censoring transactions.

**Effectiveness**: **Mitigated by Deep Bake**

The 768-second finality delay (2 epochs) means:

- The beacon root is finalized before any claim can be made
- Block builders cannot predict beacon roots 2 epochs in advance
- By the time claims are possible, the beacon state is immutable

Even if a block builder wanted to manipulate outcomes:

1. They would need to control validator selection 2 epochs ahead
2. They would need to predict which commitments would produce winning proofs
3. Both requirements are computationally infeasible

**Conclusion**: The Deep Bake delay neutralizes block builder manipulation vectors.

### 5. Commitment Grinding

**Vector**: Attacker generates many commitments, observing which beacon root will be used, then only reveals the winning one.

**Effectiveness**: **Ineffective**

Timing constraints prevent this attack:

1. Commitments must specify `targetTimestamp` at entry time
2. `targetTimestamp` must be in the future (`>= block.timestamp`)
3. Once committed, the participant cannot change their target
4. Deep Bake delay means the beacon root is already determined when grinding would be attempted

An attacker would need to:

- Generate all possible preimages before knowing the beacon root
- Commit to specific timestamps before those roots exist
- Pay entry fees for every commitment

This reduces to brute-forcing the ZK circuit, which is computationally infeasible.

**Conclusion**: The commit-then-reveal structure prevents grinding attacks.

### 6. Beacon Root Prediction

**Vector**: Attacker predicts future beacon roots to create winning commitments.

**Effectiveness**: **Infeasible**

Beacon block roots depend on:

- Attestations from thousands of validators
- Randomness from RANDAO
- Network timing and message propagation

No party controls enough of these inputs to predict roots. Even the next block proposer cannot determine the root before their slot.

**Conclusion**: Beacon root prediction is not a viable attack vector.

## Residual Risks

### Timing Constraints

Participants must claim within the ring buffer window (~27 hours). If they wait too long after Deep Bake, their chance becomes unclaimable. This is a known limitation, not an attack vector.

### Missed Slot Edge Cases

If the target timestamp's slot is missed, the contract searches forward up to 12 slots. Frontends must implement identical logic. Mismatches between frontend and contract implementations could cause proof verification failures.

**Mitigation**: The search algorithm is deterministic. Documented implementations should be validated against the contract's behavior.

### ZK Proof Generation Privacy

Proof generation happens off-chain. If a participant generates their proof on a compromised machine, their preimage could be leaked. However, this does not enable theft since only the chance owner can claim.

**Mitigation**: Users should generate proofs in trusted environments.

## Summary

| Attack Vector | Risk Level | Reason |
|---------------|------------|--------|
| Front-running entries | None | Commitment hides preimage |
| Front-running claims | None | Owner-bound access control |
| Sandwich attacks | None | Fixed-price model |
| Builder collusion | Mitigated | Deep Bake finality |
| Commitment grinding | None | Temporal commitment binding |
| Root prediction | None | Beacon unpredictability |

The Colasseum protocol's commitment scheme, combined with EIP-4788 beacon randomness and Deep Bake finality delays, provides strong protection against MEV extraction. The primary security relies on:

1. **Cryptographic binding**: Commitments lock choices before randomness
2. **Access control**: Claims restricted to chance owners
3. **Finality**: Deep Bake ensures beacon roots cannot be manipulated
4. **Determinism**: Fixed costs eliminate price manipulation surfaces
