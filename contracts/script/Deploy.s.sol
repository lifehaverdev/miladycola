// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/miladycola4.sol";
import "../src/Verifier.sol";
import "../src/ranmilio.sol";
import "../src/mocks/MockNFT.sol";

contract Deploy is Script {
    // The default anvil account #0 address for funding
    address constant DEFAULT_USER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    // Charity address (using anvil account #1 for testing)
    address constant CHARITY = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    // Generosity basis points (1% = 100)
    uint256 constant GENEROSITY = 500; // 5%

    function run() external returns (address colasseum, address nft, address oracle, address verifier) {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy mock oracle for local testing
        MockBeaconOracle mockOracle = new MockBeaconOracle();
        mockOracle.setSeed(keccak256("local-test-seed"));
        console.log("MockBeaconOracle deployed at:", address(mockOracle));

        // 2. Deploy verifier
        Groth16Verifier zkVerifier = new Groth16Verifier();
        console.log("Groth16Verifier deployed at:", address(zkVerifier));

        // 3. Deploy Colasseum (using deployer as witness for local testing)
        address witness = vm.addr(deployerPrivateKey);
        Colasseum colasseum = new Colasseum(address(mockOracle), address(zkVerifier), CHARITY, GENEROSITY, witness);
        console.log("Colasseum deployed at:", address(colasseum));

        // 4. Deploy mock NFT for testing
        CoolNFT coolNft = new CoolNFT();
        console.log("CoolNFT deployed at:", address(coolNft));

        // 5. Mint some NFTs to default user (tokens 1, 2, 3)
        coolNft.mint(DEFAULT_USER);
        coolNft.mint(DEFAULT_USER);
        coolNft.mint(DEFAULT_USER);
        console.log("Minted NFT tokens 1, 2, 3 to:", DEFAULT_USER);

        // 6. Create an initial challenge with token #1
        // Appraisal = 1 ETH, Deposit = 5% = 0.05 ETH
        uint256 appraisal = 1 ether;
        uint256 deposit = (appraisal * 5) / 100;

        // Approve NFT for Colasseum
        coolNft.approve(address(colasseum), 1);

        // Create the challenge
        colasseum.challenge{value: deposit}(address(coolNft), 1, appraisal, "The Inaugural Cola Challenge");
        console.log("Created initial challenge with NFT #1, appraisal:", appraisal);

        vm.stopBroadcast();

        console.log("--- Deployment Complete ---");
        return (address(colasseum), address(coolNft), address(mockOracle), address(zkVerifier));
    }
}
