# Functional Parity Audit: app-colasseum → miladycolav4

**Date:** 2026-01-21
**Status:** Complete + Fixed
**Goal:** Trace full bottle lifecycle, find divergences, fix proving

## Implementation Status

All fixes implemented with **auto-detection** - no manual config needed for production:

- [x] `DevService.js` created with `warpChainTime()` and `deriveSeededRoot()`
- [x] **Auto-detects dev mode** by checking oracle address vs real EIP-4788 beacon roots
- [x] AppShell.handleClaim uses DevService for claim preparation (auto-disabled in prod)
- [x] Commitment verification added before proof generation
- [x] `timeWarpUrl` and `oracleSeed` added to deploy output

**Production behavior (zero config):**
- Real beacon oracle (`0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02`) → dev features disabled
- Any other oracle address → dev features enabled automatically

**Files changed:**
- `src/services/DevService.js` (new)
- `src/main.js`
- `src/components/App.js`
- `src/components/layout/AppShell.js`
- `src/components/ui/ClaimModal.js`
- `scripts/deploy.mjs`
- `src/generated/contracts.json`

---

## Summary

The core ZK cryptography (commitment generation, proof inputs, proof formatting) is **correctly implemented** in miladycolav4. The structures match app-colasseum exactly.

**Critical gaps found:**
1. Missing `warpChainTime()` - dev mode can't advance chain time for beacon availability
2. Missing commitment verification before proof generation (UX issue, not correctness)
3. oracleSeed available in config but not used for local derivation fallback

---

## Stage 1: Wallet Connect

| Checkpoint | app-colasseum | miladycolav4 | Verdict |
|------------|---------------|--------------|---------|
| Chain ID | 0x539 (1337) | 1337 from config | ✓ match |
| Provider setup | `new ethers.providers.Web3Provider(ethereum)` | `new ethers.providers.JsonRpcProvider(rpcUrl)` | ⚠ different approach |
| Signer retrieval | `provider.getSigner()` | Passed from WalletService | ✓ match |
| Contract instantiation | Inline with JSON ABI strings | Full ABI from contracts.json | ✓ match |
| Address capture | `userAddress` global | `connectedAddress` in AppShell state | ✓ match |

**Notes:** Provider approach differs (Web3Provider vs JsonRpcProvider) but both get signer from wallet, so functionally equivalent.

---

## Stage 2: Create Challenge

| Checkpoint | app-colasseum | miladycolav4 | Verdict |
|------------|---------------|--------------|---------|
| NFT approval | `approve(colasseumAddress, tokenId)` | `approveNft(nftContract, tokenId)` → same call | ✓ match |
| Appraisal handling | `parseEther(appraisalEth)` | `parseEther(appraisalEth)` | ✓ match |
| Deposit calc | `appraisal * 5 / 100` | `appraisal.mul(5).div(100)` | ✓ match |
| createDraw params | `(nftContract, nftId, appraisal, {value: deposit})` | Same | ✓ match |

---

## Stage 3: Buy Bottle (Commitment) - CRITICAL

| Checkpoint | app-colasseum | miladycolav4 | Verdict |
|------------|---------------|--------------|---------|
| Passphrase→field | `keccak256(toUtf8Bytes(passphrase)).toBigInt()` | `BigInt(keccak256(toUtf8Bytes(passphrase)))` | ✓ match |
| Address→field | `BigNumber.from(userAddress).toBigInt()` | `BigInt(ownerAddress)` | ✓ match |
| Commitment | `poseidon([passphraseField, ownerField])` | Same | ✓ match |
| Commitment extract | `poseidon.F.toObject(commitmentBytes)` | Same | ✓ match |
| Target timestamp | `currentBlockTime + 120 + 1` | `currentBlockTime + 120 + 1` | ✓ match |
| numChances formula | `ceil((MAX_HASH * oddsPercent / 100) / difficulty)` | Same | ✓ match |
| enterDraw params | `(drawId, commitment, targetTimestamp, numChances)` | Same | ✓ match |
| msg.value | `FIXED_TICKET_PRICE * numChances` (1 gwei each) | Same | ✓ match |

**Commitment generation is CORRECT.**

---

## Stage 4-5: Wait & Reveal

| Checkpoint | app-colasseum | miladycolav4 | Verdict |
|------------|---------------|--------------|---------|
| Randomness check | `oracle.isRandomnessAvailable(ts)` | Same via ContractService | ✓ match |
| Beacon root fetch | `deriveSeededRoot(ts) \|\| oracle.getRandomness(ts)` | Only `oracle.getRandomness(ts)` | ⚠ missing fallback |
| Root split | `rootHigh = root >> 128n`, `rootLow = root & mask` | Same | ✓ match |
| Win threshold | `difficulty * numChances` | Same | ✓ match |
| Win condition | `randomnessHash < threshold` | Same | ✓ match |
| Chain time warp | `warpChainTime(targetTimestamp)` | **MISSING** | ✗ BUG |

**Key Issue:** app-colasseum warps chain time before fetching beacon root. miladycolav4 doesn't.

---

## Stage 6: Claim Prize - CRITICAL

| Checkpoint | app-colasseum | miladycolav4 | Verdict |
|------------|---------------|--------------|---------|
| Commitment verify | Verifies passphrase before proof | **MISSING** | ⚠ UX gap |
| Proof input: passphrase | `keccak256(passphrase).toBigInt().toString()` | Same via `passphraseToField()` | ✓ match |
| Proof input: ownerAddress | `BigNumber.from(addr).toBigInt().toString()` | Same via `addressToField()` | ✓ match |
| Proof input: rootHigh/Low | 128-bit split | Same | ✓ match |
| Proof input: ticketHash | `ticket.commitment.toString()` | `commitment.toString()` | ✓ match |
| Proof input: difficulty | `draw.difficulty.toBigInt().toString()` | `difficulty.toString()` | ✓ match |
| Proof input: chances | `ticket.numChances.toBigInt().toString()` | `numChances.toString()` | ✓ match |
| Proof generation | `snarkjs.groth16.fullProve(input, wasm, zkey)` | Same | ✓ match |
| pi_b flip | `[[b[0][1], b[0][0]], [[b[1][1], b[1][0]]]` | Same | ✓ match |
| claimItem params | `(ticketId, pA, pB, pC)` | Same | ✓ match |

**Proof generation structure is CORRECT.**

---

## Bugs Found

| Stage | Issue | Severity | Root Cause |
|-------|-------|----------|------------|
| 4-5 | No `warpChainTime()` function | **HIGH** | Dev mode can't advance Anvil time, so oracle returns no randomness |
| 4-5 | No local `deriveSeededRoot()` fallback | LOW | Relies entirely on contract call |
| 6 | No commitment verification before proof | LOW | Wrong passphrase causes wasted proof generation |

---

## Why Proving Fails

The proving itself is correctly implemented. The failure is upstream:

1. User buys bottle with `targetTimestamp = now + 120`
2. In dev mode, Anvil chain time doesn't automatically advance
3. When user tries to reveal/claim, `oracle.getRandomness(targetTimestamp)` fails because chain time < targetTimestamp + SAFETY_DELAY
4. No beacon root → proof generation fails or uses invalid inputs

**app-colasseum fixes this by:**
```javascript
// Before fetching beacon root:
await warpChainTime(desiredTimestamp);

// Local derivation as fallback:
const derivedRoot = deriveSeededRoot(targetTimestamp);
const beaconRoot = derivedRoot || await oracle.getRandomness(targetTimestamp);
```

---

## Intentional Changes

| Stage | Change | Rationale |
|-------|--------|-----------|
| 1 | JsonRpcProvider vs Web3Provider | Cleaner separation - RPC for reads, wallet for writes |
| All | Event-based architecture | Better decoupling via eventBus |
| All | Component-based state | Replaces 35+ global variables |
| 6 | Passphrase auto-fill from storage | Better UX - user doesn't need to remember |

---

## Fix Required (IMPLEMENTED)

The following fixes have been implemented:

### 1. Time warp utility (for dev mode)

```javascript
// In ContractService.js or new DevService.js
async warpChainTime(targetTimestamp) {
  const config = this.config;
  if (!config.timeWarpUrl) return false;

  await fetch(config.timeWarpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp: targetTimestamp })
  });
  return true;
}
```

### 2. Local beacon root derivation (optional but helpful)

```javascript
// In CryptoService.js
deriveSeededRoot(oracleSeed, timestamp) {
  if (!oracleSeed) return null;
  return ethers.utils.solidityKeccak256(
    ['bytes32', 'uint256'],
    [oracleSeed, timestamp]
  );
}
```

### 3. Pre-claim commitment verification (UX improvement)

```javascript
// In AppShell.handleClaim, before generating proof:
const expectedCommitment = await cryptoService.generateCommitment(passphrase, ownerAddress);
if (expectedCommitment !== bottle.commitment) {
  eventBus.emit('claim:status', { status: '', error: 'Passphrase does not match this bottle' });
  return;
}
```

### 4. Config additions needed

```json
{
  "timeWarpUrl": "http://127.0.0.1:8788/colasseum-warp",
  "oracleSeed": "0x..."
}
```

---

## Verification Checklist

After fixes:

- [ ] Buy bottle → commitment stored correctly
- [ ] Wait for cooldown (warp time in dev)
- [ ] Reveal → win condition evaluates correctly
- [ ] Claim (winner) → proof generates, contract accepts
- [ ] Claim (loser) → proof fails client-side (expected)
