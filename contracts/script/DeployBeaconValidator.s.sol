// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/BeaconValidator.sol";
import "../src/ranmilio.sol";

/**
 * @title DeployBeaconValidator
 * @notice Deploy the beacon validator to prove EIP-4788 integration works
 *
 * Usage:
 *   # Deploy validator only
 *   forge script script/DeployBeaconValidator.s.sol:DeployBeaconValidator \
 *     --rpc-url $MAINNET_RPC_URL --broadcast --private-key $PRIVATE_KEY
 *
 *   # Wait 13+ minutes, then validate:
 *   cast send <VALIDATOR_ADDRESS> "validate()" --rpc-url $MAINNET_RPC_URL --private-key $PRIVATE_KEY
 *
 *   # Check result:
 *   cast call <VALIDATOR_ADDRESS> "beaconRoot()" --rpc-url $MAINNET_RPC_URL
 */
contract DeployBeaconValidator is Script {
    function run() external {
        vm.startBroadcast();

        // Deploy the validator
        BeaconValidator validator = new BeaconValidator();

        console.log("=== BeaconValidator Deployed ===");
        console.log("Validator address:", address(validator));
        console.log("Deployment timestamp:", validator.deploymentTimestamp());
        console.log("");
        console.log("Next steps:");
        console.log("1. Wait 13 minutes (768 seconds)");
        console.log("2. Call validate() on the contract");
        console.log("3. If it succeeds, beacon integration is proven!");

        vm.stopBroadcast();
    }
}

/**
 * @title DeployFullValidation
 * @notice Deploy both oracle and validator for complete validation
 */
contract DeployFullValidation is Script {
    function run() external {
        vm.startBroadcast();

        // Deploy the oracle
        BeaconRandomnessOracle oracle = new BeaconRandomnessOracle();
        console.log("Oracle deployed at:", address(oracle));

        // Deploy the validator
        BeaconValidator validator = new BeaconValidator();
        console.log("Validator deployed at:", address(validator));
        console.log("Deployment timestamp:", validator.deploymentTimestamp());

        console.log("");
        console.log("=== Validation Instructions ===");
        console.log("Wait 13 minutes, then run:");
        console.log("");
        console.log("# Option 1: Direct beacon roots test");
        console.log("cast send <VALIDATOR> 'validate()' --rpc-url $RPC --private-key $KEY");
        console.log("");
        console.log("# Option 2: Full oracle test");
        console.log("cast send <VALIDATOR> 'validateWithOracle(address)' <ORACLE> --rpc-url $RPC --private-key $KEY");
        console.log("");
        console.log("Replace <VALIDATOR> and <ORACLE> with addresses above");

        vm.stopBroadcast();
    }
}
