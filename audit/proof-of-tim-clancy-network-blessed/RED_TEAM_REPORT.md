# Colasseum ZK Circuit Red Team Audit

## Executive Summary

The Colasseum proof system contains a **CRITICAL field arithmetic overflow** in the
circuit's win condition that causes the probability model to break down completely at
the threshold boundary. Additionally, several medium-severity issues exist in the
circuit design and frontend integration.

**Bottom line**: The odds ARE correct for normal usage (spending << prize value), but
the probability model is mathematically broken when `difficulty * numChances` approaches
or exceeds the BN254 scalar field prime. The system claims "provably fair" but the
underlying math produces a sawtooth probability curve instead of the expected linear one.

---

## Findings

### FINDING 1: Field Overflow in `effectiveDifficulty` (CRITICAL)

**File**: `circuits/lottery.circom:54`
**Severity**: CRITICAL
**Status**: CONFIRMED WITH PROOF-OF-CONCEPT

#### The Bug

```circom
// Line 54 - THIS IS FIELD ARITHMETIC (mod p)
effectiveDifficulty <== difficulty * chances;
```

In circom, all arithmetic is performed modulo the BN254 scalar field prime:
```
p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
```

When `difficulty * chances >= p`, the result **wraps around mod p**, producing a
value much smaller than intended.

#### Mathematical Proof

For an appraisal of 0.39 ETH:
```
difficulty = 56123699671382756980118989090403269457816318975425729086405000000000
p / difficulty ≈ 390,000,000

At numChances = 390,000,000: threshold ≈ 0.9999 * p  → P(win) ≈ 99.99%  ✓
At numChances = 390,000,001: threshold wraps to ≈ 0   → P(win) ≈ 0.00%   ✗
```

**The probability drops from ~100% to ~0% when crossing the field boundary.**

The cost at this boundary is `390,000,001 * 1 gwei = 0.390000001 ETH`, which is
essentially equal to the prize value.

#### Probability Curve is a Sawtooth

Instead of linear growth from 0% to 100%, the actual probability function is:
```
P_actual(n) = ((difficulty * n) mod p) / p
```

This produces a SAWTOOTH wave:
- 0 to ~390M chances: 0% → ~100% (correct, linear)
- ~390M to ~780M: wraps back to ~0% → ~100% (WRONG)
- ~780M to ~1.17B: wraps again ~0% → ~100% (WRONG)
- ...repeating forever
```

#### Impact

- **The contract has NO guard** against purchasing enough chances to trigger overflow
- **The frontend uses BigInt** (unlimited precision), so it calculates probability
  CORRECTLY - but the circuit uses field arithmetic, so proof generation FAILS
- A user could be told "you won!" by the frontend, then be unable to generate a proof
- Anyone spending close to the prize value gets catastrophically wrong odds
- The protocol spec claims "provably fair" but the math is provably broken at boundaries

#### No Attacker Advantage

The overflow always wraps to a SMALLER threshold, never larger. So an attacker
cannot exploit this to win more easily. The bug harms participants (worse odds than
claimed), not the protocol operator.

---

### FINDING 2: Frontend/Circuit Evaluation Mismatch (HIGH)

**File**: `src/services/CryptoService.js:124-128`
**Severity**: HIGH
**Status**: CONFIRMED

#### The Bug

The frontend evaluates win conditions using JavaScript BigInt (unlimited precision):
```javascript
// CryptoService.js line 127-128
const threshold = difficultyBigInt * chancesBigInt;  // NO overflow
const isWinner = randomnessHash < threshold;          // Correct comparison
```

But the circuit evaluates using BN254 field arithmetic:
```circom
// lottery.circom line 54
effectiveDifficulty <== difficulty * chances;  // mod p OVERFLOW
```

When `difficulty * chances >= p`:
- Frontend says: "You won!" (BigInt comparison is correct)
- Circuit says: proof generation fails (field-wrapped threshold is tiny)
- User gets a confusing error with no explanation

---

### FINDING 3: No `numChances` Overflow Guard in Contract (HIGH)

**File**: `contracts/src/miladycola4.sol:272-299`
**Severity**: HIGH
**Status**: CONFIRMED

The `valor()` function does not check whether `difficulty * numChances` would overflow
the BN254 field:

```solidity
function valor(..., uint256 _numChances) public payable virtual {
    // These checks exist:
    require(_numChances > 0, "Must buy at least one chance");
    require(msg.value == _numChances * FIXED_TICKET_PRICE, "Incorrect total payment");
    // ...but NO check for field overflow:
    // MISSING: require(trial.difficulty * _numChances < MAX_HASH, "Would overflow ZK field");
}
```

A participant can purchase enough chances to trigger field overflow, paying
real ETH for mathematically impossible odds.

---

### FINDING 4: `passphraseToField` Does Not Reduce mod p (MEDIUM)

**File**: `src/services/CryptoService.js:72-75`
**Severity**: MEDIUM
**Status**: CONFIRMED

```javascript
passphraseToField(passphrase) {
    const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(passphrase));
    return BigInt(hash);  // Can be >= p (keccak256 is 256 bits, p is ~254 bits)
}
```

keccak256 produces 256-bit outputs. The BN254 scalar field is ~254 bits.
Approximately 25% of keccak256 outputs exceed p and will be silently reduced
mod p by snarkjs during proof generation.

**Impact**: Two different passphrases could map to the same field element
(collision), and the field element used in the circuit differs from what the
user's raw keccak256 hash suggests. Practically low risk due to the enormous
hash space, but violates the principle of explicit field reduction.

---

### FINDING 5: Circuit Artifact Provenance (INFO - CLEARED)

**Status**: VERIFIED CLEAN

The deployed `challenge.wasm` / `challenge_final.zkey` were verified to have
**identical verification keys** to the `lottery_final.zkey` compiled from
`circuits/lottery.circom`. All IC points, alpha, beta, gamma, and delta
parameters match exactly. The circuit source accurately represents production.

---

### FINDING 6: Num2Bits(254) Multi-Precision Comparison (INFO - CORRECT)

**Status**: VERIFIED CORRECT

The circuit's multi-precision comparison splits 254-bit values into two 127-bit
halves and uses `LessThan(127)` on each. This correctly covers all 254 bits
(bits 0-126 for low, bits 127-253 for high) and the comparison logic is sound:

```
a < b ⟺ (a_hi < b_hi) ∨ (a_hi = b_hi ∧ a_lo < b_lo)
```

The `LessThan(127)` template from circomlib is appropriate for 127-bit inputs
(asserts n <= 252, uses Num2Bits(128) internally).

---

## Recommendations

### R1: Add Field Overflow Guard (MUST FIX)

In `valor()`, add:
```solidity
require(
    uint256(trial.difficulty) * _numChances < MAX_HASH,
    "Would overflow ZK field"
);
```

This prevents participants from purchasing chances that would cause the circuit's
field arithmetic to wrap around.

### R2: Add Frontend Overflow Warning

In `CryptoService.evaluateWinCondition()`, add:
```javascript
const threshold = difficultyBigInt * chancesBigInt;
if (threshold >= MAX_HASH) {
    throw new Error('Chance count would overflow ZK field - reduce quantity');
}
```

### R3: Reduce Passphrase to Field Before Use

```javascript
passphraseToField(passphrase) {
    const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(passphrase));
    return BigInt(hash) % MAX_HASH;
}
```

### R4: Consider Circuit Upgrade for Safe Multiplication

The circuit could use range checks to constrain that the product doesn't overflow,
but this would require a new trusted setup. The contract-level guard (R1) is the
pragmatic fix.

---

## Test Artifacts

- `audit/overflow-proof.mjs` - Mathematical proof of field overflow
- `audit/monte-carlo.mjs` - Statistical simulation of actual vs claimed odds
- `audit/edge-cases.mjs` - Boundary condition tests
