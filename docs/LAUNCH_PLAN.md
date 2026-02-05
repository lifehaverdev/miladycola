# MiladyCola Launch Plan

## Overview

This document outlines the complete path from Sepolia testing to mainnet launch and public announcement.

---

## Phase 1: Sepolia Deployment

### Prerequisites
```bash
# Set environment variables
export SEPOLIA_RPC_URL="https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY"
export CHARITY_ADDRESS="0x..."      # Testnet charity address
export WITNESS_ADDRESS="0x..."      # Testnet witness address
export GENEROSITY_BPS="500"         # 5% charity donation
```

### Step 1.1: Deploy Oracle
```bash
cd contracts
forge script script/DeployMainnet.s.sol:DeployOracle \
  --rpc-url $SEPOLIA_RPC_URL --account COLA --broadcast
```
- [ ] Record oracle address: `________________`
- [ ] Record deploy timestamp: `________________`

### Step 1.2: Wait 13 Minutes
EIP-4788 requires beacon finality before randomness is available.

### Step 1.3: Validate Oracle
```bash
forge script script/DeployMainnet.s.sol:ValidateOracle \
  --rpc-url $SEPOLIA_RPC_URL \
  --sig "run(address)" <ORACLE_ADDRESS>
```
- [ ] Validation passed (beacon root retrieved successfully)

### Step 1.4: Deploy Colasseum
```bash
forge script script/DeployMainnet.s.sol:DeployColasseum \
  --rpc-url $SEPOLIA_RPC_URL --account COLA --broadcast \
  --sig "run(address)" <ORACLE_ADDRESS>
```
- [ ] Record Verifier address: `________________`
- [ ] Record Colasseum address: `________________`

---

## Phase 2: Frontend Testing on Sepolia

### Step 2.1: Generate Sepolia Frontend Config
```bash
node scripts/generate-network-config.mjs sepolia \
  --colasseum <COLASSEUM_ADDRESS> \
  --verifier <VERIFIER_ADDRESS> \
  --oracle <ORACLE_ADDRESS> \
  --rpc-url $SEPOLIA_RPC_URL
```
This creates `src/generated/contracts-sepolia.json`

### Step 2.2: Run Frontend Against Sepolia
```bash
npm run sepolia
```
Opens dev server pointing to Sepolia contracts

### Step 2.3: End-to-End Testing
- [ ] Connect wallet on Sepolia
- [ ] Create a challenge (stake an NFT)
- [ ] Enter a trial (valor)
- [ ] Wait for cooldown (~13 min)
- [ ] Reveal outcome
- [ ] Claim victory (if winner) or verify loss state
- [ ] Test cowardice (cancel trial)
- [ ] Test perseverance (refund after cancellation)

### Step 2.4: Edge Case Verification
- [ ] Multiple participants in same trial
- [ ] High odds vs low odds purchases
- [ ] ZK proof generation working correctly
- [ ] Event indexer catching all events
- [ ] Winners section displaying correctly

---

## Phase 3: Contract Review for Publication

### Step 3.1: Code Organization
- [ ] Remove any dead code or unused imports
- [ ] Ensure consistent formatting (`forge fmt`)
- [ ] Verify all comments are accurate and helpful
- [ ] Check SPDX license headers on all files

### Step 3.2: Documentation Review
- [ ] NatSpec comments complete on all public functions
- [ ] Contract-level documentation accurate
- [ ] Events documented
- [ ] Error types documented

### Step 3.3: Security Checklist
- [ ] No hardcoded test values
- [ ] No console.log imports in production contracts
- [ ] Proper access control on all admin functions
- [ ] Reentrancy protection verified
- [ ] Integer overflow/underflow handled (Solidity 0.8+)

### Step 3.4: Files to Review
- [ ] `src/miladycola4.sol` (Colasseum)
- [ ] `src/ranmilio.sol` (BeaconRandomnessOracle)
- [ ] `src/Verifier.sol` (Groth16Verifier)
- [ ] Any other production contracts

---

## Phase 4: Dress Rehearsal (Mainnet)

### Prerequisites
```bash
export MAINNET_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
export CHARITY_ADDRESS="0x..."      # REAL charity address
export WITNESS_ADDRESS="0x..."      # REAL witness address
export GENEROSITY_BPS="500"         # 5% charity donation
```

### Step 4.1: Deploy Oracle (Mainnet)
```bash
forge script script/DeployMainnet.s.sol:DeployOracle \
  --rpc-url $MAINNET_RPC_URL --account COLA --broadcast
```
- [ ] Record oracle address: `________________`
- [ ] Record deploy timestamp: `________________`
- [ ] Record gas cost: `________________`

### Step 4.2: Wait 13 Minutes

### Step 4.3: Validate Oracle (Mainnet)
```bash
forge script script/DeployMainnet.s.sol:ValidateOracle \
  --rpc-url $MAINNET_RPC_URL \
  --sig "run(address)" <ORACLE_ADDRESS>
```
- [ ] Validation passed on mainnet

### Step 4.4: STOP - Do Not Deploy Colasseum Yet
This is the dress rehearsal checkpoint. Do NOT proceed to deploy Colasseum.

---

## Phase 5: Review & Break

### Step 5.1: Dress Rehearsal Review
- [ ] Oracle deployed successfully
- [ ] Oracle validated successfully (EIP-4788 working)
- [ ] Gas costs acceptable
- [ ] No unexpected issues

### Step 5.2: Take a Break
- Step away from the computer
- Clear your head
- Come back with fresh eyes

### Step 5.3: Final Go/No-Go Decision
- [ ] Sepolia testing passed all checks
- [ ] Contract review complete
- [ ] Dress rehearsal successful
- [ ] Confident in the deployment

---

## Phase 6: Production Mainnet Deployment

### Step 6.1: Deploy Colasseum (Mainnet)
```bash
forge script script/DeployMainnet.s.sol:DeployColasseum \
  --rpc-url $MAINNET_RPC_URL --account COLA --broadcast \
  --sig "run(address)" <ORACLE_ADDRESS>
```
- [ ] Record Verifier address: `________________`
- [ ] Record Colasseum address: `________________`
- [ ] Record total gas cost: `________________`

### Step 6.2: Verify Contracts on Etherscan
```bash
forge verify-contract <ORACLE_ADDRESS> BeaconRandomnessOracle \
  --chain mainnet --watch

forge verify-contract <VERIFIER_ADDRESS> Groth16Verifier \
  --chain mainnet --watch

forge verify-contract <COLASSEUM_ADDRESS> Colasseum \
  --chain mainnet --watch \
  --constructor-args $(cast abi-encode "constructor(address,address,address,uint256,address)" \
    <ORACLE> <VERIFIER> <CHARITY> <GENEROSITY> <WITNESS>)
```
- [ ] Oracle verified
- [ ] Verifier verified
- [ ] Colasseum verified

### Step 6.3: Generate Mainnet Frontend Config
```bash
node scripts/generate-network-config.mjs mainnet \
  --colasseum <COLASSEUM_ADDRESS> \
  --verifier <VERIFIER_ADDRESS> \
  --oracle <ORACLE_ADDRESS> \
  --rpc-url $MAINNET_RPC_URL \
  --charity $CHARITY_ADDRESS \
  --witness $WITNESS_ADDRESS
```

### Step 6.4: Build Production Frontend
```bash
npm run build:mainnet
```
- [ ] Build completes without errors
- [ ] Deploy `dist/` to production hosting

---

## Phase 7: Repository Migration

### Step 7.1: Prepare Repository
```bash
# Ensure all changes are committed
git status
git add -A
git commit -m "Production deployment - mainnet launch"
```

### Step 7.2: Force Push to miladycola
```bash
# WARNING: This overwrites the remote repository entirely
git remote add miladycola git@github.com:YOUR_ORG/miladycola.git  # if not already added
git push miladycola main --force
```
- [ ] Repository updated
- [ ] Verify push succeeded

---

## Phase 8: Announcement

### Step 8.1: Prepare Announcement
- [ ] Draft announcement text
- [ ] Prepare any graphics/media
- [ ] Contract addresses ready to share

### Step 8.2: Announce
- [ ] Post to X (@miladycola)
- [ ] Any other channels

---

## Deployed Addresses (Fill In)

| Network | Contract | Address |
|---------|----------|---------|
| Sepolia | Oracle | |
| Sepolia | Verifier | |
| Sepolia | Colasseum | |
| Mainnet | Oracle | |
| Mainnet | Verifier | |
| Mainnet | Colasseum | |

---

## Rollback Plan

If something goes wrong after mainnet deployment:

1. **Do NOT create any challenges** until issue is resolved
2. If oracle validation fails, deploy a new oracle
3. If Colasseum has issues, deploy a new Colasseum with same oracle
4. Contracts are immutable - cannot be "fixed", only redeployed

---

## Notes

- EIP-4788 ring buffer expires after ~27 hours
- Users must claim within 27 hours of their target timestamp
- Safety delay is 768 seconds (~13 minutes)
- Charity percentage is immutable after deployment
