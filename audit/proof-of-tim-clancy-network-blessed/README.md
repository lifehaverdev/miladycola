# Proof of Fair Odds: Colasseum ZK Circuit Audit

**Audited**: February 2026
**Scope**: Groth16 circuit (`lottery.circom`), on-chain verifier (`Verifier.sol`), settlement contract (`miladycola4.sol`), proof generation (`CryptoService.js`)
**Deployed Contracts**: [Colasseum](https://etherscan.io/address/0xEBB82461b745d4be95C95beCa7095f0EC6c530AC) | [Groth16Verifier](https://etherscan.io/address/0x6451e5027EC265c117FbDA85579B337F459D3837) | [BeaconOracle](https://etherscan.io/address/0xFac6478a6e9Cece4931b25a7d938c013F4568779)

---

## Summary

A systematic red team audit of the Colasseum ZK proof system was conducted to answer one question: **are the odds real?**

**Verdict: Yes.** For all practical usage, the probability model is mathematically correct. A 1% ticket has a 1% chance of winning. The circuit, verifier, and settlement logic are sound. A field overflow edge case exists at extreme spending levels (see [Known Limitations](#known-limitations)) but does not affect normal operation.

---

## 1. Forensic Verification of Real Winning Proof

The first-ever Colasseum victory was examined end-to-end using on-chain data.

### On-Chain Facts (Immutable)

| Field | Value | Source |
|-------|-------|--------|
| Chance ID | 1 | `Colasseum.chances(1)` |
| Beacon Root | `0x7bdc5fff0246d9ca8b22368d9ea366ae...` | `EIP-4788 @ timestamp 1770428351` |
| Commitment | `10117544964956295...534901079` | Stored at entry time (before randomness) |
| Difficulty | `56123699671382756...000000000` | Derived from 0.39 ETH appraisal |
| NumChances | 3,900,001 | Purchased at 1 gwei each (0.0039 ETH) |

### Exact Probability Derivation

```
P(win) = (difficulty * numChances) / p

Where p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
      (BN254 scalar field prime, used in both contract and circuit)

threshold = 56123699671382756980118989090403269457816318975425729086405000000000 * 3900001
          = 218882484842092423605221037571561841288753101820479318862708586405000000000

P(win) = 218882484842092423605221037571561841288753101820479318862708586405000000000
         / 21888242871839275222246405745257275088548364400416034343698204186575808495617

P(win) = 1.0000%  (exactly 1 in 99.99)
```

**Field overflow check**: `threshold / p = 0.01` — only 1% of the field is used. No overflow. Safe.

### Monte Carlo Confirmation

1,000,000 uniform random samples over `[0, p-1]`:

| Metric | Value |
|--------|-------|
| Simulated win rate | 0.9950% |
| Expected win rate | 1.0000% |
| Z-score | -0.50 |
| **Verdict** | **PASS** (within normal statistical variance) |

### Why a First-Try Win at 1% Is Not Suspicious

- P(winning on the very first try) = 1%
- This happens to 1 in 100 players naturally
- P(winning within 10 tries) = 9.6%
- P(winning within 100 tries) = 63.4%
- Expected tries to win = 100

A 1% event occurring once is completely ordinary. It would take repeated anomalies (e.g., 5+ consecutive first-try wins) to indicate a systemic issue.

### Commitment Binding (Anti-Grinding)

The protocol enforces a strict commit-reveal ordering:

1. **Commit phase**: User calls `valor()` with `commitment = Poseidon(passphrase, address)` and a `targetTimestamp` that MUST be in the future
2. **Reveal phase**: After `targetTimestamp + 768 seconds` (2 epochs finality), the beacon root becomes available
3. **Claim phase**: User generates a ZK proof binding their committed secret to the now-known beacon root

Since the passphrase is locked before randomness exists, grinding is impossible. Changing the passphrase would invalidate the on-chain commitment. The Groth16 proof enforces `Poseidon(passphrase, owner) === commitment` as a hard circuit constraint.

---

## 2. Circuit Audit

### Source Verification

The deployed circuit artifacts (`challenge.wasm`, `challenge_final.zkey`) were verified against the source:

```
$ snarkjs zkey export verificationkey challenge_final.zkey
$ snarkjs zkey export verificationkey lottery_final.zkey
→ IDENTICAL verification keys (all IC points, alpha, beta, gamma, delta match)
```

The verification key constants in `Verifier.sol` match exactly. The deployed circuit IS compiled from `lottery.circom`.

### Circuit Structure (`lottery.circom`)

```
FortressLottery Circuit
├── Private Inputs: passphrase, ownerAddress
├── Public Inputs: rootHigh, rootLow, ticketHash, difficulty, chances
├── Constraints:
│   ├── Poseidon(passphrase, ownerAddress) === ticketHash     [commitment check]
│   ├── randomnessHash = Poseidon(passphrase, rootHigh, rootLow)
│   ├── effectiveDifficulty = difficulty * chances             [field arithmetic]
│   └── randomnessHash < effectiveDifficulty                  [win condition]
└── Comparison: Multi-precision 127+127 bit split with LessThan(127)
```

**R1CS stats**: 1,903 constraints, 1,905 wires, 2 private inputs, 5 public inputs

### What's Correct

- **Poseidon commitment**: Properly binds passphrase + owner to on-chain commitment
- **Randomness mixing**: Poseidon(passphrase, rootHigh, rootLow) produces a uniform field element
- **Multi-precision comparison**: 254-bit numbers split into two 127-bit halves, compared with `(a_hi < b_hi) || (a_hi == b_hi && a_lo < b_lo)` — mathematically sound
- **LessThan(127)**: circomlib's comparator is valid for 127-bit inputs (asserts n <= 252)
- **Bit coverage**: bits [0,126] = low, bits [127,253] = high — all 254 bits covered, none dropped

### Verifier Contract

The `Groth16Verifier.sol` is standard snarkjs-generated code using BN254 elliptic curve pairings. It:
- Validates all public signals are within the scalar field (`checkField`)
- Computes the verification key linear combination
- Performs the pairing check via EVM precompiles (ecAdd, ecMul, ecPairing)

The verification key constants were confirmed to match the deployed zkey.

---

## 3. On-Chain Proof Verification Tests

Two Foundry test suites provide additional verification:

### `VerifyRealWin.t.sol`

Tests the actual winning proof against the deployed verifier:

- `test_verifyRealWinningProof()` — Real proof with real beacon root: **PASSES**
- `test_realProofFailsWithWrongBeaconRoot()` — Same proof, different root: **REJECTED**
- `test_realProofFailsWithWrongDifficulty()` — Doubled difficulty: **REJECTED**

### `VerifierSecurity.t.sol`

Comprehensive security tests proving the verifier rejects invalid proofs:

- Tampered pA, pB, pC components: **ALL REJECTED**
- Tampered public signals (rootHigh, rootLow, commitment, difficulty, chances): **ALL REJECTED**
- Random/zero/all-ones proof forgery: **ALL REJECTED**
- Proof reuse with different signals: **REJECTED**
- Field overflow signals (>= scalar field): **REJECTED**
- Fuzz testing with random tampering: **ALL REJECTED**

---

## 4. Mass Statistical Valor Test (1000 Trials)

A mass volume test was conducted to prove the **full on-chain pipeline** works correctly under load — not just the circuit in isolation, but `oracle → 128-bit split → public signals → Groth16 verifier → settlement`.

### Method

1. Generated 1000 random trials using identical production parameters (0.39 ETH appraisal, 3,900,001 chances, ~1% odds)
2. Evaluated win/loss via Poseidon hash in JS — found **7 wins** (0.70%)
3. Generated real Groth16 proofs for all 7 wins using the production circuit (`challenge.wasm`, `challenge_final.zkey`)
4. Fed every proof through a Foundry test deploying the **real `Groth16Verifier`** (not a mock) + `MockBeaconOracle` + `Colasseum`
5. Each win followed the full protocol flow: `challenge() → valor() → setMockRootOverride() → warp → victory()`

### Results

| Test | Result |
|------|--------|
| `test_allWinsVerifiedOnChain` | **7/7 JS-wins verified** by real Groth16Verifier |
| `test_wrongBeaconRootRejects` | Wrong beacon root → "Invalid ZK Proof" revert |
| `test_wrongDifficultyRejects` | Wrong difficulty → "Invalid ZK Proof" revert |
| `test_difficultyCalculationMatches` | JS difficulty = Solidity difficulty (exact match) |

Difficulty confirmed identical: `56123699671382756980118989090403269457816318975425729086405000000000`

### Batch-of-12 Histogram ("How unusual is 2/12?")

10,000 simulated batches of 12 entries at 1% odds:

```
 0 wins: 88.51%
 1 win:  10.76%
 2 wins:  0.71%
 3 wins:  0.02%
```

**P(2+ wins in 12 at 1%) = 0.62%** (binomial exact). That's roughly 1-in-161 — rare, but well within normal probability. The production result of 2 wins from 12 attempts is a legitimate statistical outcome.

### How to Reproduce

```bash
# Generate fresh fixtures (creates contracts/test/MassValorFixtures.sol)
node audit/proof-of-tim-clancy-network-blessed/mass-valor-generator.mjs

# Run Foundry tests
cd contracts && forge test --match-contract MassValorTest -vvv
```

---

## 5. Known Limitations

### Field Overflow at Extreme Spend Levels

**Severity**: Edge case — does not affect normal usage
**Trigger**: When `difficulty * numChances >= BN254 scalar field prime`
**Effect**: Threshold wraps mod p, producing incorrect (lower) win probability

This occurs when total spend approaches the appraisal value:

| Appraisal | Overflow at | Cost |
|-----------|------------|------|
| 0.01 ETH | 10M chances | 0.01 ETH |
| 0.1 ETH | 100M chances | 0.1 ETH |
| 1.0 ETH | 1B chances | 1.0 ETH |

At the overflow boundary, win probability drops from ~100% to ~0%. See `overflow-proof.mjs` for detailed analysis. A contract-level guard (`require(trial.difficulty * _numChances < MAX_HASH)`) would prevent this edge case.

**Why it doesn't matter for normal usage**: The overflow only triggers when someone spends approximately equal to the full prize value on a single beacon timestamp. For the actual winning trial (0.39 ETH appraisal, 0.0039 ETH spent), the threshold was only 1% of the field — nowhere near overflow.

---

## 6. Test Scripts

All scripts can be run with `node <script>`:

| Script | Purpose |
|--------|---------|
| `prove-1pct-legitimate.mjs` | Full forensic proof the 1% win was legitimate |
| `overflow-proof.mjs` | Mathematical proof of the field overflow edge case |
| `monte-carlo.mjs` | 1M-sample Monte Carlo confirming claimed vs actual odds |
| `edge-cases.mjs` | Boundary condition analysis and secondary findings |
| `mass-valor-generator.mjs` | 1000-trial fixture generator with Groth16 proofs and batch-of-12 histogram |

Solidity tests (run with `forge test`):

| Test | Purpose |
|------|---------|
| `contracts/test/VerifyRealWin.t.sol` | Verifies actual winning proof on-chain |
| `contracts/test/VerifierSecurity.t.sol` | Proves verifier rejects all invalid proofs |
| `contracts/test/MassValor.t.sol` | Mass volume test: 7 real proofs through full on-chain pipeline |
| `contracts/test/MassValorFixtures.sol` | Auto-generated fixture data (beacon roots, commitments, proofs) |

---

## 7. Conclusion

The Colasseum proof system delivers the odds it claims. The ZK circuit correctly implements a commit-reveal lottery with Poseidon hashing and Groth16 verification. The victories at ~1% odds were legitimate probabilistic outcomes, verified through:

1. Exact mathematical derivation from immutable on-chain state
2. Monte Carlo simulation with 1M samples (z-score within normal range)
3. On-chain Groth16 proof verification against the deployed verifier
4. Circuit source-to-artifact verification (identical verification keys)
5. Comprehensive tamper-rejection testing (all invalid proofs rejected)
6. Mass volume test: 1000 trials, 7 real Groth16 proofs, all verified through the full on-chain pipeline with the real verifier
7. Batch-of-12 analysis: P(2+ wins in 12 at 1%) = 0.62% — rare but legitimate

The odds are real.

---

**Protocol**: [miladycola.net](https://miladycola.net)
**Source**: [github.com/lifehaverdev/miladycola](https://github.com/lifehaverdev/miladycola)
**X**: [@miladycola](https://x.com/miladycola)
