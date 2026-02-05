// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/miladycola4.sol";
import "../src/ranmilio.sol";
import "../src/mocks/MockNFT.sol";
import "./mocks/MockVerifier5.sol";

/**
 * @title ColasseumForkTest
 * @notice Fork tests for the Colasseum contract
 * @dev Run with: forge test --match-contract ColasseumForkTest --fork-url $MAINNET_RPC_URL -vvv
 *
 * This test suite has two parts:
 * 1. REAL beacon tests - verify oracle works with actual EIP-4788 data
 * 2. Integration tests - test full Colasseum flow with mocked beacon (necessary because
 *    valor() requires future timestamps but beacon data only exists for past blocks)
 */
contract ColasseumForkTest is Test {
    // EIP-4788 Beacon Roots Contract
    address constant BEACON_ROOTS = 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02;

    // Timing constants
    uint256 constant SAFETY_DELAY = 768; // 2 epochs = ~12.8 minutes
    uint256 constant BUFFER_LIMIT = 98292; // ~27.3 hours
    uint256 constant SECONDS_PER_SLOT = 12;

    Colasseum public colasseum;
    BeaconRandomnessOracle public realOracle;
    MockVerifier5 public verifier;
    CoolNFT public nft;

    address public charity = address(0xC4A817);
    address public challenger;
    address public participant;

    uint256 public constant FIXED_TICKET_PRICE = 0.000000001 ether;
    uint256 public constant DEPOSIT_PERCENT = 5;
    uint256 public constant TEST_APPRAISAL = 1e18;

    // The fork timestamp - this is a REAL block timestamp with beacon data
    uint256 public forkTimestamp;
    uint256 public forkBlock;

    function setUp() public {
        require(block.chainid == 1, "Must run on mainnet fork");

        forkTimestamp = block.timestamp;
        forkBlock = block.number;

        emit log_named_uint("Fork timestamp", forkTimestamp);
        emit log_named_uint("Fork block", forkBlock);

        // Verify beacon roots contract exists
        require(BEACON_ROOTS.code.length > 0, "Beacon roots contract not found");

        // Deploy contracts
        realOracle = new BeaconRandomnessOracle();
        verifier = new MockVerifier5();
        nft = new CoolNFT();

        colasseum = new Colasseum(
            address(realOracle),
            address(verifier),
            charity,
            1000,
            address(0x717E55) // witness
        );

        // Create test accounts
        challenger = makeAddr("challenger");
        participant = makeAddr("participant");
        vm.deal(challenger, 100 ether);
        vm.deal(participant, 100 ether);

        emit log("Setup complete");
    }

    // =========================================================================
    // PART 1: REAL BEACON DATA TESTS
    // These tests use actual EIP-4788 beacon roots from mainnet
    // =========================================================================

    function test_fork_beaconRootsContractExists() public view {
        assertGt(BEACON_ROOTS.code.length, 0, "EIP-4788 contract should exist");
    }

    function test_fork_oracleConfigured() public view {
        assertEq(realOracle.BEACON_ROOTS_ADDRESS(), BEACON_ROOTS);
        assertEq(realOracle.SAFETY_DELAY(), SAFETY_DELAY);
    }

    function test_fork_realBeaconRoot() public {
        // The fork timestamp is a REAL block timestamp - it MUST have beacon data
        // Query it directly from the beacon roots contract
        (bool success, bytes memory data) =
            BEACON_ROOTS.staticcall(abi.encodeWithSelector(IBeaconRoots.timestampToBeaconRoot.selector, forkTimestamp));

        assertTrue(success, "Fork timestamp should have beacon data");
        bytes32 realRoot = abi.decode(data, (bytes32));
        assertNotEq(realRoot, bytes32(0), "Beacon root should be non-zero");

        emit log_named_uint("Fork timestamp", forkTimestamp);
        emit log_named_bytes32("REAL beacon root", realRoot);
        emit log("SUCCESS: Retrieved REAL beacon root from EIP-4788!");
    }

    function test_fork_oracleReadsRealBeacon() public {
        // Warp forward past safety delay so we can query the fork timestamp
        vm.warp(forkTimestamp + SAFETY_DELAY + 60);

        bytes32 root = realOracle.getRandomness(forkTimestamp);
        assertNotEq(root, bytes32(0), "Should get real beacon root");

        // Verify it matches direct query
        bytes32 directRoot = IBeaconRoots(BEACON_ROOTS).timestampToBeaconRoot(forkTimestamp);
        assertEq(root, directRoot, "Oracle should return same as direct query");

        emit log_named_bytes32("REAL beacon root via oracle", root);
        emit log("SUCCESS: Oracle correctly reads REAL beacon data!");
    }

    function test_fork_realRandomnessIsDeterministic() public {
        vm.warp(forkTimestamp + SAFETY_DELAY + 60);

        bytes32 r1 = realOracle.getRandomness(forkTimestamp);
        bytes32 r2 = realOracle.getRandomness(forkTimestamp);

        assertEq(r1, r2, "Same timestamp should always return same root");
    }

    function test_fork_verifyRealRandomness() public {
        vm.warp(forkTimestamp + SAFETY_DELAY + 60);

        bytes32 root = realOracle.getRandomness(forkTimestamp);

        assertTrue(realOracle.verifyRandomness(forkTimestamp, root), "Real root should verify");
        assertFalse(realOracle.verifyRandomness(forkTimestamp, bytes32(uint256(1))), "Wrong root should fail");
    }

    function test_fork_futureTimestampReverts() public {
        uint256 futureTimestamp = block.timestamp + 1 hours;

        vm.expectRevert(IBeaconRandomness.FutureTimestamp.selector);
        realOracle.getRandomness(futureTimestamp);
    }

    function test_fork_notFinalizedReverts() public {
        // Fork timestamp without waiting for safety delay
        vm.expectRevert();
        realOracle.getRandomness(forkTimestamp);
    }

    function test_fork_gasRealBeaconQuery() public {
        vm.warp(forkTimestamp + SAFETY_DELAY + 60);

        uint256 gasBefore = gasleft();
        realOracle.getRandomness(forkTimestamp);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("Gas for REAL beacon query", gasUsed);
        assertLt(gasUsed, 10000, "getRandomness should be cheap");
    }

    // =========================================================================
    // PART 2: COLASSEUM INTEGRATION TESTS
    // These use mocked beacon data because valor() requires future timestamps
    // but beacon data only exists for past blocks
    // =========================================================================

    function _mockBeaconRoot(
        uint256 timestamp
    ) internal returns (bytes32) {
        bytes32 mockRoot = keccak256(abi.encodePacked("beacon_root", timestamp, block.chainid));
        vm.mockCall(
            BEACON_ROOTS,
            abi.encodeWithSelector(IBeaconRoots.timestampToBeaconRoot.selector, timestamp),
            abi.encode(mockRoot)
        );
        return mockRoot;
    }

    function test_fork_createTrial() public {
        uint256 tokenId = _mintAndApprove(challenger);
        uint256 deposit = (TEST_APPRAISAL * DEPOSIT_PERCENT) / 100;

        vm.prank(challenger);
        uint256 trialId = colasseum.challenge{value: deposit}(address(nft), tokenId, TEST_APPRAISAL, "Fork test trial");

        assertEq(trialId, 0);
        assertEq(nft.ownerOf(tokenId), address(colasseum));
    }

    function test_fork_fullVictoryFlow() public {
        // Create trial
        uint256 tokenId = _mintAndApprove(challenger);
        uint256 deposit = (TEST_APPRAISAL * DEPOSIT_PERCENT) / 100;

        vm.prank(challenger);
        colasseum.challenge{value: deposit}(address(nft), tokenId, TEST_APPRAISAL, "");

        // Enter with future timestamp
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        vm.prank(participant);
        colasseum.valor{value: FIXED_TICKET_PRICE * 10}(0, 0x123456, targetTimestamp, 10);

        // Warp forward and mock beacon root
        vm.warp(targetTimestamp + SAFETY_DELAY + 60);
        bytes32 root = _mockBeaconRoot(targetTimestamp);

        // Verify setup
        assertTrue(realOracle.isRandomnessAvailable(targetTimestamp));
        assertEq(realOracle.getRandomness(targetTimestamp), root);

        // Claim victory
        verifier.setAlwaysPass(true);
        vm.prank(participant);
        colasseum.victory(
            0,
            targetTimestamp,
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );

        assertEq(nft.ownerOf(tokenId), participant, "Winner should receive NFT");
        emit log("SUCCESS: Full victory flow completed!");
    }

    function test_fork_multipleTrials() public {
        verifier.setAlwaysPass(true);

        for (uint256 i = 0; i < 3; i++) {
            uint256 tokenId = _mintAndApprove(challenger);
            uint256 deposit = (TEST_APPRAISAL * DEPOSIT_PERCENT) / 100;

            vm.prank(challenger);
            colasseum.challenge{value: deposit}(address(nft), tokenId, TEST_APPRAISAL, "");

            uint256 targetTimestamp = block.timestamp + 5 minutes + (i * 2 minutes);
            vm.prank(participant);
            colasseum.valor{value: FIXED_TICKET_PRICE * 5}(i, uint256(keccak256(abi.encode(i))), targetTimestamp, 5);

            vm.warp(targetTimestamp + SAFETY_DELAY + 60);
            _mockBeaconRoot(targetTimestamp);

            vm.prank(participant);
            colasseum.victory(
                i,
                targetTimestamp,
                [uint256(0), uint256(0)],
                [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
                [uint256(0), uint256(0)]
            );

            assertEq(nft.ownerOf(tokenId), participant);
        }

        emit log("SUCCESS: Multiple trials completed!");
    }

    function test_fork_cancelAndRefund() public {
        uint256 tokenId = _mintAndApprove(challenger);
        uint256 deposit = (TEST_APPRAISAL * DEPOSIT_PERCENT) / 100;

        vm.prank(challenger);
        colasseum.challenge{value: deposit}(address(nft), tokenId, TEST_APPRAISAL, "");

        uint256 targetTimestamp = block.timestamp + 5 minutes;
        vm.prank(participant);
        colasseum.valor{value: FIXED_TICKET_PRICE * 10}(0, 0x123, targetTimestamp, 10);

        uint256 balanceBefore = participant.balance;

        vm.prank(challenger);
        colasseum.cowardice(0);

        uint256[] memory chanceIds = new uint256[](1);
        chanceIds[0] = 0;
        vm.prank(participant);
        colasseum.perseverance(chanceIds);

        assertEq(participant.balance, balanceBefore + FIXED_TICKET_PRICE * 10);
        assertEq(nft.ownerOf(tokenId), challenger);
    }

    function test_fork_gasVictoryFlow() public {
        uint256 tokenId = _mintAndApprove(challenger);
        uint256 deposit = (TEST_APPRAISAL * DEPOSIT_PERCENT) / 100;

        vm.prank(challenger);
        colasseum.challenge{value: deposit}(address(nft), tokenId, TEST_APPRAISAL, "");

        uint256 targetTimestamp = block.timestamp + 5 minutes;
        vm.prank(participant);
        colasseum.valor{value: FIXED_TICKET_PRICE * 10}(0, 0x123, targetTimestamp, 10);

        vm.warp(targetTimestamp + SAFETY_DELAY + 60);
        _mockBeaconRoot(targetTimestamp);
        verifier.setAlwaysPass(true);

        uint256 gasBefore = gasleft();
        vm.prank(participant);
        colasseum.victory(
            0,
            targetTimestamp,
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("Gas for victory()", gasUsed);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    function _mintAndApprove(
        address to
    ) internal returns (uint256) {
        vm.prank(to);
        uint256 tokenId = nft.mint(to);
        vm.prank(to);
        nft.approve(address(colasseum), tokenId);
        return tokenId;
    }
}
