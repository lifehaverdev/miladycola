// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ranmilio.sol";

/**
 * @title BeaconValidator
 * @notice One-off contract to validate EIP-4788 beacon randomness works
 * @dev Deploy this, wait 13 minutes, then call validate()
 *
 * Usage:
 * 1. Deploy contract (records deployment timestamp)
 * 2. Wait at least 13 minutes (SAFETY_DELAY = 768 seconds)
 * 3. Call validate() - retrieves REAL beacon root for deployment time
 * 4. Check the ValidationSuccess event - contains the real beacon root
 *
 * If validate() succeeds, your BeaconRandomnessOracle integration is proven to work.
 */
contract BeaconValidator {
    // EIP-4788 Beacon Roots Contract
    address public constant BEACON_ROOTS = 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02;

    // Safety delay (2 epochs = ~13 minutes)
    uint256 public constant SAFETY_DELAY = 768;

    // Deployment timestamp - this becomes our test target
    uint256 public immutable deploymentTimestamp;

    // Results
    bool public validated;
    bytes32 public beaconRoot;

    event Deployed(uint256 timestamp, uint256 blockNumber);
    event ValidationSuccess(uint256 targetTimestamp, bytes32 beaconRoot, uint256 validatedAt);
    event ValidationFailed(uint256 targetTimestamp, string reason);

    constructor() {
        deploymentTimestamp = block.timestamp;
        emit Deployed(block.timestamp, block.number);
    }

    /**
     * @notice Validate that we can read beacon randomness for our deployment time
     * @dev Call this at least SAFETY_DELAY seconds after deployment
     */
    function validate() external returns (bytes32) {
        require(!validated, "Already validated");
        require(block.timestamp >= deploymentTimestamp + SAFETY_DELAY, "Too early - wait for safety delay");

        // Try to read beacon root for deployment timestamp
        (bool success, bytes memory data) = BEACON_ROOTS.staticcall(abi.encode(deploymentTimestamp));

        if (!success || data.length != 32) {
            emit ValidationFailed(deploymentTimestamp, "Beacon root query failed");
            revert("Beacon root query failed");
        }

        beaconRoot = abi.decode(data, (bytes32));

        if (beaconRoot == bytes32(0)) {
            emit ValidationFailed(deploymentTimestamp, "Beacon root is zero");
            revert("Beacon root is zero");
        }

        validated = true;
        emit ValidationSuccess(deploymentTimestamp, beaconRoot, block.timestamp);

        return beaconRoot;
    }

    /**
     * @notice Check if enough time has passed to validate
     */
    function canValidate() external view returns (bool ready, uint256 waitSeconds) {
        if (block.timestamp >= deploymentTimestamp + SAFETY_DELAY) {
            return (true, 0);
        }
        return (false, (deploymentTimestamp + SAFETY_DELAY) - block.timestamp);
    }

    /**
     * @notice Test the full oracle flow (deploy BeaconRandomnessOracle separately first)
     * @param oracle Address of deployed BeaconRandomnessOracle
     */
    function validateWithOracle(
        address oracle
    ) external returns (bytes32) {
        require(!validated, "Already validated");
        require(block.timestamp >= deploymentTimestamp + SAFETY_DELAY, "Too early");

        BeaconRandomnessOracle oracleContract = BeaconRandomnessOracle(oracle);

        // This will revert if anything is wrong
        beaconRoot = oracleContract.getRandomness(deploymentTimestamp);

        require(beaconRoot != bytes32(0), "Oracle returned zero");

        // Verify the oracle's verification function works too
        require(oracleContract.verifyRandomness(deploymentTimestamp, beaconRoot), "Verification failed");

        validated = true;
        emit ValidationSuccess(deploymentTimestamp, beaconRoot, block.timestamp);

        return beaconRoot;
    }
}
