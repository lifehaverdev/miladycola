// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/miladycola4.sol";
import "../src/Verifier.sol";
import "../src/ranmilio.sol";

/**
 * @title DeployMainnet
 * @notice Production deployment script with oracle validation
 * @dev Validates EIP-4788 integration before deploying Colasseum
 *
 * Works on any EIP-4788 enabled network: Mainnet, Sepolia, etc.
 *
 * Usage (Sepolia example):
 *   # Step 1: Deploy and validate oracle (wait 13 min between steps)
 *   forge script script/DeployMainnet.s.sol:DeployOracle \
 *     --rpc-url $SEPOLIA_RPC_URL --account COLA --broadcast
 *
 *   # Step 2: After 13 minutes, validate the oracle
 *   forge script script/DeployMainnet.s.sol:ValidateOracle \
 *     --rpc-url $SEPOLIA_RPC_URL --sig "run(address)" <ORACLE_ADDRESS>
 *
 *   # Step 3: Deploy Colasseum with validated oracle
 *   forge script script/DeployMainnet.s.sol:DeployColasseum \
 *     --rpc-url $SEPOLIA_RPC_URL --account COLA --broadcast \
 *     --sig "run(address)" <ORACLE_ADDRESS>
 *
 * Required environment variables for Step 3:
 *   CHARITY_ADDRESS   - Address to receive charity donations
 *   WITNESS_ADDRESS   - Address for signature verification
 *   GENEROSITY_BPS    - (optional) Charity percentage in basis points (default: 500 = 5%)
 *
 * =============================================================================
 * LESSONS LEARNED FROM MAINNET VALIDATION (February 2026)
 * =============================================================================
 *
 * ISSUE #1: EIP-4788 Uses RAW Calldata (No Function Selector!)
 * -----------------------------------------------------------------------------
 * Our original BeaconRandomnessOracle used an interface call:
 *
 *   bytes32 root = IBeaconRoots(BEACON_ROOTS).timestampToBeaconRoot(timestamp);
 *
 * This SILENTLY FAILED because Solidity adds a 4-byte function selector to the
 * calldata. But EIP-4788's system contract expects ONLY the 32-byte timestamp
 * as raw calldata - no selector, no ABI encoding of function signature.
 *
 * THE FIX (in ranmilio.sol):
 *   (bool success, bytes memory data) = BEACON_ROOTS_ADDRESS.staticcall(
 *       abi.encode(targetTimestamp)  // Just the timestamp, nothing else
 *   );
 *
 * VALIDATION RESULT: After fix, oracle correctly returned beacon root
 *   0x43c809c1bba8991893a7be63309bdce56d6c1133e61155556f40470dc63a1c02
 *   for block timestamp 1769968607.
 *
 * ISSUE #2: Only REAL Block Timestamps Work
 * -----------------------------------------------------------------------------
 * We tried querying with arbitrary timestamps like (block.timestamp - 1000).
 * Result: ZeroRandomness() revert.
 *
 * EIP-4788 stores beacon roots keyed by the EXACT timestamp of each block.
 * Ethereum blocks are ~12 seconds apart, but timestamps are not perfectly
 * aligned to 12-second intervals.
 *
 * THE FIX: Query an actual block's timestamp:
 *   cast block <BLOCK_NUMBER> --field timestamp --rpc-url $RPC
 *   cast call <ORACLE> "getRandomness(uint256)" <THAT_TIMESTAMP>
 *
 * This validation script probes for valid timestamps automatically.
 *
 * ISSUE #3: isRandomnessAvailable() Can Lie
 * -----------------------------------------------------------------------------
 * isRandomnessAvailable(timestamp) only checks:
 *   - timestamp is in the past
 *   - timestamp is past safety delay (finalized)
 *   - timestamp is within ring buffer window
 *
 * It does NOT verify the timestamp corresponds to a real block!
 * So isRandomnessAvailable() can return TRUE while getRandomness() reverts
 * with ZeroRandomness().
 *
 * This is a known limitation. The validation script handles this by catching
 * the revert and continuing to search for a valid timestamp.
 *
 * ISSUE #4: Ring Buffer Expires (~27 Hours)
 * -----------------------------------------------------------------------------
 * We validated the oracle at timestamp 1769769587, got a beacon root, then
 * tried to query it again ~56 hours later. Result: RandomnessExpired() revert.
 *
 * EIP-4788 stores only 8191 roots (8191 * 12 seconds ≈ 27.3 hours).
 * Older timestamps fall out of the buffer and become unqueryable.
 *
 * For Colasseum, this means: users must claim their prize within ~27 hours
 * of their target timestamp, after waiting the 13-minute safety delay.
 *
 * ISSUE #5: Fork Testing Cannot Prove Full Flow
 * -----------------------------------------------------------------------------
 * We tried to fork-test the complete Colasseum flow (valor -> wait -> victory).
 * Problem: valor() requires a FUTURE timestamp, but EIP-4788 only has data for
 * PAST blocks. These requirements are mutually exclusive in a fork environment.
 *
 * Solution: We created BeaconValidator.sol - a one-off contract that:
 *   1. Records its deployment timestamp
 *   2. Waits 13 minutes
 *   3. Queries EIP-4788 for the deployment timestamp's beacon root
 *
 * This proved the oracle works with REAL beacon data, even though we couldn't
 * test the full challenge flow without mocking.
 *
 * VALIDATED ORACLE ADDRESS: 0xD86D7EA0a9D52a2Db620e40EE7AD8d4bDbe6c233
 * VALIDATION TIMESTAMP: 1769968607 (block 24363649)
 * VALIDATION RESULT: 0x43c809c1bba8991893a7be63309bdce56d6c1133e61155556f40470dc63a1c02
 *
 * =============================================================================
 */

// ============================================================================
// STEP 1: Deploy Oracle
// ============================================================================

contract DeployOracle is Script {
    function run() external returns (address oracle, uint256 deployTimestamp) {
        vm.startBroadcast();

        BeaconRandomnessOracle oracleContract = new BeaconRandomnessOracle();
        deployTimestamp = block.timestamp;

        console.log("==============================================");
        console.log("STEP 1 COMPLETE: Oracle Deployed");
        console.log("==============================================");
        console.log("Oracle address:", address(oracleContract));
        console.log("Deploy timestamp:", deployTimestamp);
        console.log("");
        console.log("NEXT STEPS:");
        console.log("1. Wait 13 minutes (768 seconds) for beacon finality");
        console.log("2. Run ValidateOracle with the oracle address");
        console.log("");
        console.log("Validation command:");
        console.log("  forge script script/DeployMainnet.s.sol:ValidateOracle \\");
        console.log("    --rpc-url $RPC_URL \\");
        console.log("    --sig 'run(address)'", address(oracleContract));

        vm.stopBroadcast();

        return (address(oracleContract), deployTimestamp);
    }
}

// ============================================================================
// STEP 2: Validate Oracle (READ-ONLY, no gas needed)
// ============================================================================

/**
 * @title ValidateOracle
 * @notice Validates that the BeaconRandomnessOracle correctly reads EIP-4788
 * @dev This script exists because we learned the hard way that:
 *
 *   1. Interface calls to EIP-4788 fail silently (adds function selector)
 *   2. Arbitrary timestamps fail - only real block timestamps work
 *   3. isRandomnessAvailable() can return true when getRandomness() will revert
 *   4. Data expires after ~27 hours (ring buffer limit)
 *
 * The _findValidBlockTimestamp() function probes backward from 15 minutes ago
 * in 12-second intervals (roughly matching block times) and catches reverts
 * to find a timestamp that actually works.
 *
 * If this validation passes, your oracle is correctly integrated with EIP-4788.
 * If it fails, check that:
 *   - You're on an EIP-4788 enabled network (mainnet, Sepolia, etc. - NOT local anvil)
 *   - The oracle uses raw staticcall, not interface call
 *   - At least 13 minutes have passed since some block was produced
 */
contract ValidateOracle is Script {
    uint256 constant SAFETY_DELAY = 768;

    function run(
        address oracleAddress
    ) external view {
        BeaconRandomnessOracle oracle = BeaconRandomnessOracle(oracleAddress);

        console.log("==============================================");
        console.log("STEP 2: Validating Oracle");
        console.log("==============================================");
        console.log("Oracle address:", oracleAddress);
        console.log("Current timestamp:", block.timestamp);
        console.log("");

        // Verify oracle constants
        require(
            oracle.BEACON_ROOTS_ADDRESS() == 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02, "Invalid beacon roots address"
        );
        console.log("[OK] Beacon roots address correct");

        require(oracle.SAFETY_DELAY() == 768, "Invalid safety delay");
        console.log("[OK] Safety delay = 768 seconds");

        // Find a valid block timestamp to test with
        // We need a timestamp that is:
        // - At least SAFETY_DELAY seconds old (finalized)
        // - From an actual block (not arbitrary)
        // We'll probe backwards from current time

        uint256 testTimestamp = _findValidBlockTimestamp(oracle);
        console.log("[OK] Found valid block timestamp:", testTimestamp);

        // Query randomness
        bytes32 randomness = oracle.getRandomness(testTimestamp);
        require(randomness != bytes32(0), "Got zero randomness");
        console.log("[OK] Retrieved beacon root:");
        console.logBytes32(randomness);

        // Verify the verification function works
        require(oracle.verifyRandomness(testTimestamp, randomness), "Verification failed");
        console.log("[OK] verifyRandomness() works");

        // Check isRandomnessAvailable
        require(oracle.isRandomnessAvailable(testTimestamp), "isRandomnessAvailable returned false");
        console.log("[OK] isRandomnessAvailable() works");

        console.log("");
        console.log("==============================================");
        console.log("VALIDATION PASSED - Oracle is working!");
        console.log("==============================================");
        console.log("");
        console.log("NEXT STEP: Deploy Colasseum with this oracle:");
        console.log("  forge script script/DeployMainnet.s.sol:DeployColasseum \\");
        console.log("    --rpc-url $RPC_URL --account COLA --broadcast \\");
        console.log("    --sig 'run(address)'", oracleAddress);
    }

    /**
     * @dev Finds a valid block timestamp by probing backward from 15 minutes ago.
     *
     * WHY THIS IS NECESSARY:
     * We can't just use (block.timestamp - 1000) because EIP-4788 only stores
     * data for EXACT block timestamps. If timestamp 1769968607 was a real block
     * but 1769968600 wasn't, the latter will revert with ZeroRandomness().
     *
     * WHY WE CAN'T TRUST isRandomnessAvailable():
     * It only checks time-based constraints (past, finalized, not expired).
     * It does NOT verify the timestamp corresponds to an actual block.
     * So we must try-catch getRandomness() to confirm.
     *
     * WHY 12-SECOND INTERVALS:
     * Ethereum targets 12-second block times. By probing every 12 seconds
     * starting from 15 minutes ago, we're likely to hit a real block timestamp
     * within the first few attempts.
     *
     * WHAT IF THIS FAILS:
     * - Not on an EIP-4788 network (mainnet/Sepolia - not local anvil)
     * - Oracle has the interface-call bug (adds function selector)
     * - Network issues preventing staticcall to beacon roots contract
     */
    function _findValidBlockTimestamp(
        BeaconRandomnessOracle oracle
    ) internal view returns (uint256) {
        // Start from 15 minutes ago (safely past SAFETY_DELAY of 768 seconds)
        uint256 searchStart = block.timestamp - 900;

        // EIP-4788 stores roots keyed by block timestamp
        // Block timestamps are roughly 12 seconds apart
        // We'll check if isRandomnessAvailable returns true, then try getRandomness

        for (uint256 i = 0; i < 100; i++) {
            uint256 candidateTs = searchStart - (i * 12);

            if (oracle.isRandomnessAvailable(candidateTs)) {
                // Try to actually get the randomness (might still fail if not exact block ts)
                try oracle.getRandomness(candidateTs) returns (bytes32 root) {
                    if (root != bytes32(0)) {
                        return candidateTs;
                    }
                } catch {
                    // Not an exact block timestamp, continue searching
                }
            }
        }

        revert("Could not find valid block timestamp - is this an EIP-4788 network?");
    }
}

// ============================================================================
// STEP 3: Deploy Colasseum with validated oracle
// ============================================================================

contract DeployColasseum is Script {
    function run(
        address oracleAddress
    ) external returns (address colasseum, address verifier) {
        // First, validate the oracle still works (read-only check)
        BeaconRandomnessOracle oracle = BeaconRandomnessOracle(oracleAddress);

        console.log("==============================================");
        console.log("STEP 3: Deploying Colasseum");
        console.log("==============================================");
        console.log("Using oracle:", oracleAddress);

        // Quick sanity check
        require(oracle.BEACON_ROOTS_ADDRESS() == 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02, "Invalid oracle");

        // Get deployment parameters from environment
        address charity = vm.envAddress("CHARITY_ADDRESS");
        uint256 generosity = vm.envOr("GENEROSITY_BPS", uint256(500)); // Default 5%
        address witness = vm.envAddress("WITNESS_ADDRESS");

        console.log("Charity address:", charity);
        console.log("Generosity (bps):", generosity);
        console.log("Witness address:", witness);

        vm.startBroadcast();

        // Deploy verifier
        Groth16Verifier zkVerifier = new Groth16Verifier();
        console.log("Groth16Verifier deployed at:", address(zkVerifier));

        // Deploy Colasseum
        Colasseum colasseumContract = new Colasseum(oracleAddress, address(zkVerifier), charity, generosity, witness);
        console.log("Colasseum deployed at:", address(colasseumContract));

        vm.stopBroadcast();

        console.log("");
        console.log("==============================================");
        console.log("DEPLOYMENT COMPLETE!");
        console.log("==============================================");
        console.log("Oracle:", oracleAddress);
        console.log("Verifier:", address(zkVerifier));
        console.log("Colasseum:", address(colasseumContract));
        console.log("");
        console.log("The system is ready. You can now create challenges.");

        return (address(colasseumContract), address(zkVerifier));
    }
}

// ============================================================================
// BONUS: Full deployment in one shot (if you're feeling lucky)
// ============================================================================

contract DeployAll is Script {
    function run() external returns (address oracle, address verifier, address colasseum) {
        address charity = vm.envAddress("CHARITY_ADDRESS");
        uint256 generosity = vm.envOr("GENEROSITY_BPS", uint256(500));
        address witness = vm.envAddress("WITNESS_ADDRESS");

        console.log("==============================================");
        console.log("FULL MAINNET DEPLOYMENT");
        console.log("==============================================");
        console.log("WARNING: This deploys everything at once.");
        console.log("You should validate the oracle before using Colasseum!");
        console.log("");

        vm.startBroadcast();

        // Deploy oracle
        BeaconRandomnessOracle oracleContract = new BeaconRandomnessOracle();
        console.log("BeaconRandomnessOracle:", address(oracleContract));

        // Deploy verifier
        Groth16Verifier zkVerifier = new Groth16Verifier();
        console.log("Groth16Verifier:", address(zkVerifier));

        // Deploy Colasseum
        Colasseum colasseumContract =
            new Colasseum(address(oracleContract), address(zkVerifier), charity, generosity, witness);
        console.log("Colasseum:", address(colasseumContract));

        vm.stopBroadcast();

        console.log("");
        console.log("==============================================");
        console.log("IMPORTANT: Validate before creating challenges!");
        console.log("==============================================");
        console.log("Wait 13 minutes, then run:");
        console.log("  forge script script/DeployMainnet.s.sol:ValidateOracle \\");
        console.log("    --rpc-url $RPC_URL \\");
        console.log("    --sig 'run(address)'", address(oracleContract));

        return (address(oracleContract), address(zkVerifier), address(colasseumContract));
    }
}
