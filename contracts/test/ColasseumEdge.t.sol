// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/miladycola4.sol";
import "../src/ranmilio.sol";
import "../src/mocks/MockNFT.sol";
import "./mocks/MockVerifier5.sol";

/**
 * @title ColasseumEdgeTest
 * @notice Edge case and boundary tests for the Colasseum contract (lean version)
 */
contract ColasseumEdgeTest is Test {
    Colasseum public colasseum;
    MockBeaconOracle public oracle;
    MockVerifier5 public verifier;
    CoolNFT public nft;

    address public charity = address(0xC4A817);
    address public witness = address(0x717E55);
    address public challenger = address(0x1);
    address public participant = address(0x2);
    address public participant2 = address(0x3);

    uint256 public constant FIXED_TICKET_PRICE = 0.000000001 ether;
    uint256 public constant DEPOSIT_PERCENT = 5;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant SAFETY_DELAY = 768;
    uint256 public constant MAX_HASH = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    uint256 public constant TEST_APPRAISAL = 1e18;

    // Contracts that reject ETH
    RejectingReceiver public rejectingCharity;

    function setUp() public {
        oracle = new MockBeaconOracle();
        oracle.setSeed(keccak256("test_seed"));

        verifier = new MockVerifier5();
        nft = new CoolNFT();

        colasseum = new Colasseum(
            address(oracle),
            address(verifier),
            charity,
            1000,
            address(0x717E55) // witness
        );

        rejectingCharity = new RejectingReceiver();

        vm.deal(challenger, 100 ether);
        vm.deal(participant, 100 ether);
        vm.deal(participant2, 100 ether);
    }

    // =========================================================================
    // Boundary Value Tests
    // =========================================================================

    function test_challenge_minAppraisalExact() public {
        // Test with a safe minimum appraisal
        uint256 safeMinAppraisal = 2e8;
        uint256 tokenId = _mintAndApprove(challenger);
        uint256 deposit = (safeMinAppraisal * DEPOSIT_PERCENT) / 100;

        vm.deal(challenger, deposit + 1 ether);

        vm.prank(challenger);
        uint256 trialId = colasseum.challenge{value: deposit}(address(nft), tokenId, safeMinAppraisal, "");

        (,,, uint256 appraisal, uint256 difficulty,,,,) = colasseum.trials(trialId);
        assertEq(appraisal, safeMinAppraisal);
        assertGt(difficulty, 0);
    }

    function test_challenge_veryHighAppraisal() public {
        uint256 tokenId = _mintAndApprove(challenger);
        uint256 highAppraisal = MAX_HASH / FIXED_TICKET_PRICE / 2;
        uint256 deposit = (highAppraisal * DEPOSIT_PERCENT) / 100;

        vm.deal(challenger, deposit + 1 ether);

        vm.prank(challenger);
        uint256 trialId = colasseum.challenge{value: deposit}(address(nft), tokenId, highAppraisal, "");

        (,,,, uint256 difficulty,,,,) = colasseum.trials(trialId);
        assertGt(difficulty, 0);
    }

    function test_challenge_revertsZeroDifficulty() public {
        uint256 tokenId = _mintAndApprove(challenger);
        uint256 tooHighAppraisal = MAX_HASH + 1;
        uint256 deposit = 1 ether;

        vm.deal(challenger, deposit + 1 ether);

        vm.prank(challenger);
        vm.expectRevert("Appraisal is too high, results in zero difficulty");
        colasseum.challenge{value: deposit}(address(nft), tokenId, tooHighAppraisal, "");
    }

    function test_valor_targetTimestampBoundaryMax() public {
        uint256 trialId = _createTrial(challenger);

        // Just under 24 hours should work
        uint256 targetTimestamp = block.timestamp + 24 hours - 1;

        vm.prank(participant);
        colasseum.valor{value: FIXED_TICKET_PRICE}(trialId, 0x123, targetTimestamp, 1);

        (,,, uint256 storedTarget,,) = colasseum.chances(0);
        assertEq(storedTarget, targetTimestamp);
    }

    function test_honor_zeroGenerosity() public {
        address newCharity = address(0xBEEF);

        vm.prank(charity);
        colasseum.honor(newCharity, 0);

        vm.prank(witness);
        colasseum.affirm();

        (, uint256 generosity) = colasseum.charity();
        assertEq(generosity, 0);
    }

    function test_honor_maxGenerosity() public {
        address newCharity = address(0xBEEF);

        vm.prank(charity);
        colasseum.honor(newCharity, BPS_DENOMINATOR);

        vm.prank(witness);
        colasseum.affirm();

        (, uint256 generosity) = colasseum.charity();
        assertEq(generosity, BPS_DENOMINATOR);
    }

    // =========================================================================
    // Multiple Trials / Complex Scenarios
    // =========================================================================

    function test_multipleTrials_independentState() public {
        uint256 trialId1 = _createTrial(challenger);
        uint256 trialId2 = _createTrial(challenger);

        _enterTrial(participant, trialId1, 0x111, block.timestamp + 5 minutes, 5);
        _enterTrial(participant, trialId2, 0x222, block.timestamp + 5 minutes, 10);

        vm.prank(challenger);
        colasseum.cowardice(trialId1);

        (,,,,,,,, uint8 status1) = colasseum.trials(trialId1);
        assertEq(status1 & 2, 2);

        (,,,,,,,, uint8 status2) = colasseum.trials(trialId2);
        assertEq(status2 & 1, 1);
    }

    function test_multipleParticipants_allRefunded() public {
        uint256 trialId = _createTrial(challenger);

        uint256 chanceId1 = _enterTrial(participant, trialId, 0x111, block.timestamp + 5 minutes, 5);
        uint256 chanceId2 = _enterTrial(participant2, trialId, 0x222, block.timestamp + 5 minutes, 10);

        vm.prank(challenger);
        colasseum.cowardice(trialId);

        uint256 balance1Before = participant.balance;
        uint256 balance2Before = participant2.balance;

        uint256[] memory ids1 = new uint256[](1);
        ids1[0] = chanceId1;
        vm.prank(participant);
        colasseum.perseverance(ids1);

        uint256[] memory ids2 = new uint256[](1);
        ids2[0] = chanceId2;
        vm.prank(participant2);
        colasseum.perseverance(ids2);

        assertEq(participant.balance, balance1Before + 5 * FIXED_TICKET_PRICE);
        assertEq(participant2.balance, balance2Before + 10 * FIXED_TICKET_PRICE);
    }

    // =========================================================================
    // Status Bit Manipulation Tests
    // =========================================================================

    function test_statusBits_trialActive() public {
        uint256 trialId = _createTrial(challenger);

        (,,,,,,,, uint8 status) = colasseum.trials(trialId);
        assertEq(status & 1, 1); // TRIAL_ACTIVE = 1 << 0
        assertEq(status & 2, 0); // TRIAL_CANCELLED = 1 << 1
    }

    function test_statusBits_trialCancelled() public {
        uint256 trialId = _createTrial(challenger);

        vm.prank(challenger);
        colasseum.cowardice(trialId);

        (,,,,,,,, uint8 status) = colasseum.trials(trialId);
        assertEq(status & 1, 0); // TRIAL_ACTIVE cleared
        assertEq(status & 2, 2); // TRIAL_CANCELLED set
    }

    function test_statusBits_chanceClaimed() public {
        uint256 trialId = _createTrial(challenger);
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 chanceId = _enterTrial(participant, trialId, 0x123, targetTimestamp, 10);

        verifier.setAlwaysPass(true);
        vm.warp(targetTimestamp + SAFETY_DELAY + 1);

        vm.prank(participant);
        colasseum.victory(
            chanceId,
            targetTimestamp,
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );

        (,,,,, uint8 status) = colasseum.chances(chanceId);
        assertEq(status & 1, 1); // CHANCE_CLAIMED = 1 << 0
    }

    function test_statusBits_chanceRefunded() public {
        uint256 trialId = _createTrial(challenger);
        uint256 chanceId = _enterTrial(participant, trialId, 0x123, block.timestamp + 5 minutes, 10);

        vm.prank(challenger);
        colasseum.cowardice(trialId);

        uint256[] memory ids = new uint256[](1);
        ids[0] = chanceId;
        vm.prank(participant);
        colasseum.perseverance(ids);

        (,,,,, uint8 status) = colasseum.chances(chanceId);
        assertEq(status & 2, 2); // CHANCE_REFUNDED = 1 << 1
    }

    // =========================================================================
    // Beacon Timestamp Validation Tests
    // =========================================================================

    function test_victory_revertsBeaconTimestampTooEarly() public {
        uint256 trialId = _createTrial(challenger);
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 chanceId = _enterTrial(participant, trialId, 0x123, targetTimestamp, 10);

        verifier.setAlwaysPass(true);
        vm.warp(targetTimestamp + SAFETY_DELAY + 1);

        // Try to claim with a beacon timestamp before the target
        vm.prank(participant);
        vm.expectRevert("Beacon timestamp too early");
        colasseum.victory(
            chanceId,
            targetTimestamp - 1, // Too early!
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );
    }

    function test_victory_revertsBeaconTimestampTooLate() public {
        uint256 trialId = _createTrial(challenger);
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 chanceId = _enterTrial(participant, trialId, 0x123, targetTimestamp, 10);

        verifier.setAlwaysPass(true);
        vm.warp(targetTimestamp + SAFETY_DELAY + 200);

        // Try to claim with a beacon timestamp beyond the 12-slot window (144 seconds)
        vm.prank(participant);
        vm.expectRevert("Beacon timestamp too late");
        colasseum.victory(
            chanceId,
            targetTimestamp + 145, // Beyond 12 slots * 12 seconds = 144
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );
    }

    function test_victory_acceptsBeaconTimestampAtMaxWindow() public {
        uint256 trialId = _createTrial(challenger);
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 chanceId = _enterTrial(participant, trialId, 0x123, targetTimestamp, 10);

        // Use a beacon timestamp at the edge of the allowed window
        uint256 beaconTimestamp = targetTimestamp + 144; // Exactly at limit

        verifier.setAlwaysPass(true);
        vm.warp(beaconTimestamp + SAFETY_DELAY + 1);

        vm.prank(participant);
        colasseum.victory(
            chanceId,
            beaconTimestamp,
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );

        assertEq(nft.ownerOf(1), participant);
    }

    function test_victory_withSpecificRandomness() public {
        uint256 trialId = _createTrial(challenger);
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 commitment = 0xDEADBEEF;
        uint256 chanceId = _enterTrial(participant, trialId, commitment, targetTimestamp, 10);

        bytes32 specificRoot = keccak256("specific_randomness");
        oracle.setMockRootOverride(targetTimestamp, specificRoot);

        verifier.setAlwaysPass(true);
        vm.warp(targetTimestamp + SAFETY_DELAY + 1);

        vm.prank(participant);
        colasseum.victory(
            chanceId,
            targetTimestamp,
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );

        assertEq(nft.ownerOf(1), participant);
    }

    function test_victory_withAlternateBeaconTimestamp() public {
        uint256 trialId = _createTrial(challenger);
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 chanceId = _enterTrial(participant, trialId, 0x123, targetTimestamp, 10);

        // Use a beacon timestamp slightly after target (simulating real block discovery)
        uint256 beaconTimestamp = targetTimestamp + 24; // 2 slots later

        verifier.setAlwaysPass(true);
        vm.warp(beaconTimestamp + SAFETY_DELAY + 1);

        vm.prank(participant);
        colasseum.victory(
            chanceId,
            beaconTimestamp,
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );

        assertEq(nft.ownerOf(1), participant);
    }

    // =========================================================================
    // Gas Optimization Tests
    // =========================================================================

    function test_largeNumberOfChances() public {
        uint256 trialId = _createTrial(challenger);

        uint256 numChances = 1000;
        uint256 payment = numChances * FIXED_TICKET_PRICE;

        vm.prank(participant);
        colasseum.valor{value: payment}(trialId, 0x123, block.timestamp + 5 minutes, numChances);

        (,,,, uint256 storedNumChances,) = colasseum.chances(0);
        assertEq(storedNumChances, numChances);
    }

    function test_manyParticipants() public {
        uint256 trialId = _createTrial(challenger);

        for (uint256 i = 0; i < 50; i++) {
            address p = address(uint160(0x1000 + i));
            vm.deal(p, 1 ether);

            vm.prank(p);
            colasseum.valor{value: FIXED_TICKET_PRICE * 5}(trialId, i, block.timestamp + 5 minutes, 5);
        }

        // Verify pool accumulated all 50 entries
        (,,,,, uint256 ethPool,,,) = colasseum.trials(trialId);
        assertEq(ethPool, FIXED_TICKET_PRICE * 5 * 50);
    }

    // =========================================================================
    // Fuzz Tests
    // =========================================================================

    function testFuzz_challenge_validAppraisal(
        uint256 appraisal
    ) public {
        uint256 safeMin = 2e8;
        uint256 safeMax = MAX_HASH / FIXED_TICKET_PRICE / 2;
        appraisal = bound(appraisal, safeMin, safeMax);

        uint256 tokenId = _mintAndApprove(challenger);
        uint256 deposit = (appraisal * DEPOSIT_PERCENT) / 100;

        vm.deal(challenger, deposit + 1 ether);

        vm.prank(challenger);
        uint256 trialId = colasseum.challenge{value: deposit}(address(nft), tokenId, appraisal, "");

        (,,, uint256 storedAppraisal, uint256 difficulty,,,,) = colasseum.trials(trialId);
        assertEq(storedAppraisal, appraisal);
        assertGt(difficulty, 0);
    }

    function testFuzz_valor_validChances(
        uint256 numChances
    ) public {
        numChances = bound(numChances, 1, 10000);

        uint256 trialId = _createTrial(challenger);
        uint256 payment = numChances * FIXED_TICKET_PRICE;

        vm.deal(participant, payment + 1 ether);

        vm.prank(participant);
        colasseum.valor{value: payment}(trialId, 0x123, block.timestamp + 5 minutes, numChances);

        (,,,, uint256 storedNumChances,) = colasseum.chances(0);
        assertEq(storedNumChances, numChances);
    }

    function testFuzz_honor_validGenerosity(
        uint256 generosity
    ) public {
        generosity = bound(generosity, 0, BPS_DENOMINATOR);

        vm.prank(charity);
        colasseum.honor(address(0xBEEF), generosity);

        vm.prank(witness);
        colasseum.affirm();

        (, uint256 stored) = colasseum.charity();
        assertEq(stored, generosity);
    }

    // =========================================================================
    // Helper Functions
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

    function _createTrial(
        address _challenger
    ) internal returns (uint256) {
        uint256 tokenId = _mintAndApprove(_challenger);
        uint256 deposit = (TEST_APPRAISAL * DEPOSIT_PERCENT) / 100;

        vm.prank(_challenger);
        return colasseum.challenge{value: deposit}(address(nft), tokenId, TEST_APPRAISAL, "");
    }

    function _enterTrial(
        address _participant,
        uint256 trialId,
        uint256 commitment,
        uint256 targetTimestamp,
        uint256 numChances
    ) internal returns (uint256) {
        uint256 payment = numChances * FIXED_TICKET_PRICE;

        vm.recordLogs();
        vm.prank(_participant);
        colasseum.valor{value: payment}(trialId, commitment, targetTimestamp, numChances);

        // Extract chanceId from ChallengeAccepted event
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 chanceId = uint256(logs[0].topics[2]);

        return chanceId;
    }
}

// =========================================================================
// Helper Contracts
// =========================================================================

contract RejectingReceiver {
    receive() external payable {
        revert("I reject ETH");
    }
}
