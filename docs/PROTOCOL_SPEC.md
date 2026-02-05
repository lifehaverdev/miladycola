# Colasseum Protocol Specification

## Overview

Colasseum is a permissionless protocol enabling NFT holders to create provably fair trials where participants can challenge for ownership. The protocol combines EIP-4788 beacon chain randomness with Groth16 zero-knowledge proofs to ensure:

1. **Unpredictable outcomes** - Randomness determined by Ethereum's validator set
2. **Verifiable fairness** - On-chain ZK verification proves valid claims
3. **Commitment binding** - Participants commit before randomness is revealed

The protocol operates without centralized operators. Anyone can create trials, and outcomes are determined solely by cryptographic proofs.

## Actors

### Challenger

The NFT holder who initiates a trial. Responsibilities:

- Deposit NFT and set appraisal value
- Provide 5% deposit as collateral
- Optionally provide lore (description) for the trial

The challenger receives accumulated entry fees (minus charity donation) when a victor claims the trial, or can withdraw via `cowardice()` (forfeiting their deposit to charity).

### Participant

Any address that enters a trial. Responsibilities:

- Generate a secret preimage and compute its commitment hash
- Select a target timestamp for randomness (within 24 hours)
- Pay the fixed entry cost per chance

Participants can enter multiple chances per trial. After Deep Bake finality, they can attempt victory by generating a ZK proof.

### Charity

A designated address receiving donations from:

- A percentage of entry fees when trials conclude
- Forfeited deposits when challengers surrender

The charity address and generosity rate are controlled through a two-step governance process requiring both the current charity and a witness.

### Witness

An independent address that confirms charity configuration changes. This separation of powers prevents unilateral modification of fund distribution.

## Lifecycle

### 1. Trial Creation (Gauntlet)

```solidity
function challenge(
    address _nftContract,
    uint256 _nftId,
    uint256 _appraisal,
    string memory _lore
) public payable returns (uint256 trialId)
```

The challenger:

1. Approves the Colasseum contract for NFT transfer
2. Calls `challenge()` with appraisal value and minimum 5% deposit
3. NFT is transferred to the contract

Difficulty is computed as:
```
difficulty = (MAX_HASH / appraisal) * FIXED_ENTRY_COST
```

Higher appraisals result in lower difficulty thresholds, making claims harder.

**Event emitted**: `Gauntlet(trialId, challenger, nftContract, nftId, appraisal, difficulty, lore)`

### 2. Entry (Valor)

```solidity
function valor(
    uint256 _trialId,
    uint256 _commitment,
    uint256 _targetTimestamp,
    uint256 _numChances
) public payable
```

The participant:

1. Generates a secret preimage locally
2. Computes `commitment = hash(preimage)`
3. Selects a target timestamp (must be in future, within 24 hours)
4. Calls `valor()` with payment: `numChances * 0.000000001 ETH`

**Constraints**:
- Trial must be active
- `_numChances > 0`
- `msg.value == _numChances * FIXED_ENTRY_COST`
- `_targetTimestamp >= block.timestamp`
- `_targetTimestamp < block.timestamp + 24 hours`

**Event emitted**: `ChallengeAccepted(trialId, chanceId, participant, numChances, appraisal, difficulty)`

### 3. Settlement

Settlement occurs through one of three paths:

#### Victory

```solidity
function victory(
    uint256 _chanceId,
    uint256[2] calldata _pA,
    uint256[2][2] calldata _pB,
    uint256[2] calldata _pC
) public
```

After Deep Bake finality (768 seconds), the chance owner:

1. Retrieves beacon root for their target timestamp
2. Generates Groth16 proof with public signals:
   - `rootHigh` (upper 128 bits of beacon root)
   - `rootLow` (lower 128 bits of beacon root)
   - `commitment` (their committed hash)
   - `difficulty` (trial's threshold)
   - `numChances` (entries purchased)
3. Submits proof to `victory()`

The contract:

1. Finds canonical beacon root (handling missed slots)
2. Verifies ZK proof against public signals
3. Transfers NFT to victor
4. Distributes entry pool: charity receives generosity percentage, challenger receives remainder
5. Returns deposit to challenger

**Event emitted**: `Victor(trialId, chanceId, winner, appraisal, difficulty, charityDonation, challengerShare)`

#### Cowardice (Surrender)

```solidity
function cowardice(uint256 _trialId) public
```

The challenger can withdraw their NFT at any time, but:

- Deposit is forfeited to charity
- Trial is marked cancelled
- Participants can reclaim entry fees

**Event emitted**: `Surrender(trialId)`

#### Perseverance (Refund)

```solidity
function perseverance(uint256[] calldata _chanceIds) public
```

After a trial is cancelled, participants reclaim their entry fees:

1. Verify trial is cancelled
2. Verify chance not already refunded
3. Return `numChances * FIXED_ENTRY_COST`

**Event emitted**: `Justice(trialId, chanceId, participant, amount, numChances)`

## Randomness

### EIP-4788 Beacon Roots

The protocol uses Ethereum's beacon chain block roots as its entropy source. These roots are:

- **Unpredictable**: Determined by the distributed validator set
- **On-chain accessible**: Available via the EIP-4788 system contract at `0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02`
- **Time-bounded**: Stored in a ring buffer of 8191 slots (~27 hours)

### Deep Bake Safety Delay

Before beacon roots can be used, the protocol enforces a 768-second finality delay:

```
SAFETY_DELAY = 2 epochs * 32 slots/epoch * 12 seconds/slot = 768 seconds
```

This ensures:

1. The beacon block is finalized and cannot be reorged
2. Sufficient time has passed for network consensus
3. No manipulation is possible through block reorganization

### Missed Slot Handling

When a target timestamp's slot has no beacon root (validator missed), the contract searches forward:

```solidity
function _findCanonicalBeaconRoot(uint256 targetTimestamp) internal view returns (bytes32) {
    for (uint256 i = 0; i < MAX_MISSED_SLOTS; i++) {  // MAX_MISSED_SLOTS = 12
        try randomnessOracle.getRandomness(ts) returns (bytes32 root) {
            return root;
        } catch {
            ts += SECONDS_PER_SLOT;  // 12 seconds
        }
    }
    revert NoValidSlotFound();
}
```

Frontend proof generators must implement identical logic to ensure proofs verify against the canonical root.

## ZK Proof System

### Circuit Public Signals

The Groth16 circuit accepts 5 public signals:

| Index | Signal | Description |
|-------|--------|-------------|
| 0 | `rootHigh` | Upper 128 bits of beacon root |
| 1 | `rootLow` | Lower 128 bits of beacon root |
| 2 | `commitment` | Hash of participant's secret preimage |
| 3 | `difficulty` | Trial's threshold value |
| 4 | `numChances` | Number of chances purchased |

### Verification

The circuit verifies (privately) that:

1. The participant knows a preimage that hashes to `commitment`
2. When combined with the beacon root, the result is below `difficulty`
3. The `numChances` count multiplies the probability accordingly

The contract verifies the proof on-chain using the `Groth16Verifier` contract.

## Economics

### Entry Cost

Fixed at `0.000000001 ETH` (1 gwei) per chance.

```solidity
uint256 public constant FIXED_TICKET_PRICE = 0.000000001 ether;
```

### Deposit Requirement

Challengers must deposit at least 5% of their stated appraisal:

```solidity
uint256 depositRequired = (_appraisal * 5) / 100;
```

### Charity Generosity

Expressed in basis points (out of 10,000):

```solidity
donation = (pot * charity.generosity) / 10_000;
```

Example: 500 generosity = 5% to charity, 95% to challenger.

### Difficulty Calculation

```solidity
uint256 difficulty = (MAX_HASH / _appraisal) * FIXED_TICKET_PRICE;
```

Where `MAX_HASH = 21888242871839275222246405745257275088548364400416034343698204186575808495617` (the BN254 scalar field size).

## Events

| Event | Emission Trigger |
|-------|-----------------|
| `Gauntlet` | New trial created via `challenge()` |
| `ChallengeAccepted` | Participant enters via `valor()` |
| `Victor` | Successful claim via `victory()` |
| `Surrender` | Challenger withdraws via `cowardice()` |
| `Justice` | Participant refunded via `perseverance()` |
| `HonorPending` | New charity configuration proposed |
| `HonorAffirmed` | Witness confirms charity change |
| `TrustBestowed` | Witness address changed |

## Security Properties

### Commitment Integrity

- Participants cannot change their preimage after commitment
- The commitment hash binds their choice before randomness revelation
- The ZK circuit ensures the proof matches the committed value

### Finality Guarantees

- 768-second Deep Bake prevents any reorg-based manipulation
- Two full epochs provide strong finality on beacon chain state
- Ring buffer expiration (27 hours) creates a hard deadline for claims

### Access Controls

- Only chance owner can claim (`victory`)
- Only challenger can withdraw (`cowardice`)
- Only chance owner can claim refunds (`perseverance`)
- Charity changes require two-party approval (charity + witness)
