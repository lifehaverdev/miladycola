// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/miladycola4.sol";
import "../src/ranmilio.sol";
import "../src/mocks/MockNFT.sol";
import "./mocks/MockVerifier5.sol";

/**
 * @title ColasseumTest
 * @notice Unit tests for the Colasseum contract (lean version)
 */
contract ColasseumTest is Test {
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

    // Use high appraisal values to avoid overflow in difficulty calculation
    uint256 public constant TEST_APPRAISAL = 1e18;

    event ChallengeAccepted(
        uint256 indexed trialId,
        uint256 indexed chanceId,
        address indexed participant,
        uint256 numChances,
        uint256 appraisal,
        uint256 difficulty
    );
    event Victor(
        uint256 indexed trialId,
        uint256 indexed chanceId,
        address indexed winner,
        uint256 appraisal,
        uint256 difficulty,
        uint256 charityDonation,
        uint256 challengerShare
    );
    event Justice(
        uint256 indexed trialId,
        uint256 indexed chanceId,
        address indexed participant,
        uint256 amount,
        uint256 numChances
    );
    event Gauntlet(
        uint256 indexed trialId,
        address indexed challenger,
        address nftContract,
        uint256 nftId,
        uint256 appraisal,
        uint256 difficulty,
        string lore
    );
    event Surrender(uint256 indexed trialId);
    event HonorPending(address indexed proposedDonations, uint256 proposedGenerosity);
    event HonorAffirmed(address indexed newDonations, uint256 newGenerosity);
    event TrustBestowed(address indexed oldWitness, address indexed newWitness);

    function setUp() public {
        oracle = new MockBeaconOracle();
        oracle.setSeed(keccak256("test_seed"));

        verifier = new MockVerifier5();
        nft = new CoolNFT();

        colasseum = new Colasseum(
            address(oracle),
            address(verifier),
            charity,
            1000, // 10% to charity
            witness
        );

        vm.deal(challenger, 100 ether);
        vm.deal(participant, 100 ether);
        vm.deal(participant2, 100 ether);
    }

    // =========================================================================
    // Constructor Tests
    // =========================================================================

    function test_constructor_setsCharity() public view {
        (address donations, uint256 generosity) = colasseum.charity();
        assertEq(donations, charity);
        assertEq(generosity, 1000);
    }

    function test_constructor_revertsZeroCharity() public {
        vm.expectRevert("Invalid charity");
        new Colasseum(address(oracle), address(verifier), address(0), 1000, witness);
    }

    function test_constructor_revertsHighGenerosity() public {
        vm.expectRevert("Rate too high");
        new Colasseum(address(oracle), address(verifier), charity, 10001, witness);
    }

    // =========================================================================
    // honor() Tests
    // =========================================================================

    function test_honor_thenAffirm_updatesCharity() public {
        address newCharity = address(0xBEEF);

        vm.prank(charity);
        colasseum.honor(newCharity, 2000);

        vm.prank(witness);
        colasseum.affirm();

        (address donations, uint256 generosity) = colasseum.charity();
        assertEq(donations, newCharity);
        assertEq(generosity, 2000);
    }

    function test_honor_revertsNonCharity() public {
        vm.prank(challenger);
        vm.expectRevert("Not Worthy");
        colasseum.honor(address(0xBEEF), 2000);
    }

    function test_honor_revertsZeroAddress() public {
        vm.prank(charity);
        vm.expectRevert("Invalid charity");
        colasseum.honor(address(0), 2000);
    }

    function test_honor_revertsHighGenerosity() public {
        vm.prank(charity);
        vm.expectRevert("Rate too high");
        colasseum.honor(address(0xBEEF), 10001);
    }

    function test_honor_storesPendingProposal() public {
        address newCharity = address(0xBEEF);

        vm.prank(charity);
        colasseum.honor(newCharity, 2000);

        // Charity should NOT have changed yet (pending)
        (address donations, uint256 generosity) = colasseum.charity();
        assertEq(donations, charity);
        assertEq(generosity, 1000);
    }

    function test_honor_emitsHonorPending() public {
        address newCharity = address(0xBEEF);

        vm.prank(charity);
        vm.expectEmit(true, false, false, true);
        emit HonorPending(newCharity, 2000);
        colasseum.honor(newCharity, 2000);
    }

    // =========================================================================
    // affirm() Tests
    // =========================================================================

    function test_affirm_executesProposal() public {
        address newCharity = address(0xBEEF);

        // Charity proposes
        vm.prank(charity);
        colasseum.honor(newCharity, 2000);

        // Witness confirms
        vm.prank(witness);
        colasseum.affirm();

        // Charity should now be updated
        (address donations, uint256 generosity) = colasseum.charity();
        assertEq(donations, newCharity);
        assertEq(generosity, 2000);
    }

    function test_affirm_clearsPendingProposal() public {
        address newCharity = address(0xBEEF);

        vm.prank(charity);
        colasseum.honor(newCharity, 2000);

        vm.prank(witness);
        colasseum.affirm();

        // Pending should be cleared - verified by second affirm reverting
        vm.prank(witness);
        vm.expectRevert("No pending proposal");
        colasseum.affirm();
    }

    function test_affirm_emitsHonorAffirmed() public {
        address newCharity = address(0xBEEF);

        vm.prank(charity);
        colasseum.honor(newCharity, 2000);

        vm.prank(witness);
        vm.expectEmit(true, false, false, true);
        emit HonorAffirmed(newCharity, 2000);
        colasseum.affirm();
    }

    function test_affirm_revertsNonWitness() public {
        address newCharity = address(0xBEEF);

        vm.prank(charity);
        colasseum.honor(newCharity, 2000);

        vm.prank(challenger);
        vm.expectRevert("Not Witness");
        colasseum.affirm();
    }

    function test_affirm_revertsNoPendingProposal() public {
        vm.prank(witness);
        vm.expectRevert("No pending proposal");
        colasseum.affirm();
    }

    // =========================================================================
    // trust() Tests
    // =========================================================================

    function test_trust_changesWitness() public {
        address newWitness = address(0xAE11);

        vm.prank(witness);
        colasseum.trust(newWitness);

        assertEq(colasseum.witness(), newWitness);
    }

    function test_trust_emitsTrustBestowed() public {
        address newWitness = address(0xAE11);

        vm.prank(witness);
        vm.expectEmit(true, true, false, false);
        emit TrustBestowed(witness, newWitness);
        colasseum.trust(newWitness);
    }

    function test_trust_revertsNonWitness() public {
        vm.prank(challenger);
        vm.expectRevert("Not Witness");
        colasseum.trust(address(0xAE11));
    }

    function test_trust_revertsZeroAddress() public {
        vm.prank(witness);
        vm.expectRevert("Invalid witness");
        colasseum.trust(address(0));
    }

    function test_trust_newWitnessCanAffirm() public {
        address newWitness = address(0xAE11);

        // Change witness
        vm.prank(witness);
        colasseum.trust(newWitness);

        // Propose new charity
        vm.prank(charity);
        colasseum.honor(address(0xBEEF), 2000);

        // New witness can affirm
        vm.prank(newWitness);
        colasseum.affirm();

        (address donations,) = colasseum.charity();
        assertEq(donations, address(0xBEEF));
    }

    function test_trust_oldWitnessCannotAffirm() public {
        address newWitness = address(0xAE11);

        // Change witness
        vm.prank(witness);
        colasseum.trust(newWitness);

        // Propose new charity
        vm.prank(charity);
        colasseum.honor(address(0xBEEF), 2000);

        // Old witness cannot affirm
        vm.prank(witness);
        vm.expectRevert("Not Witness");
        colasseum.affirm();
    }

    // =========================================================================
    // Constructor Tests (witness)
    // =========================================================================

    function test_constructor_setsWitness() public view {
        assertEq(colasseum.witness(), witness);
    }

    function test_constructor_revertsZeroWitness() public {
        vm.expectRevert("Invalid witness");
        new Colasseum(address(oracle), address(verifier), charity, 1000, address(0));
    }

    // =========================================================================
    // challenge() Tests
    // =========================================================================

    function test_challenge_createsTrial() public {
        uint256 tokenId = _mintAndApprove(challenger);
        uint256 appraisal = TEST_APPRAISAL;
        uint256 deposit = (appraisal * DEPOSIT_PERCENT) / 100;

        vm.prank(challenger);
        uint256 trialId = colasseum.challenge{value: deposit}(address(nft), tokenId, appraisal, "Test lore");

        assertEq(trialId, 0);

        (
            address payable trialChallenger,
            address nftContract,
            uint256 nftId,
            uint256 trialAppraisal,
            uint256 difficulty,
            uint256 ethPool,
            uint256 depositEscrow,,,
            uint8 status
        ) = colasseum.trials(trialId);

        assertEq(trialChallenger, challenger);
        assertEq(nftContract, address(nft));
        assertEq(nftId, tokenId);
        assertEq(trialAppraisal, appraisal);
        assertGt(difficulty, 0);
        assertEq(ethPool, 0);
        assertEq(depositEscrow, deposit);
        assertEq(status, 1); // TRIAL_ACTIVE
    }

    function test_challenge_transfersNFT() public {
        uint256 tokenId = _mintAndApprove(challenger);
        uint256 deposit = (TEST_APPRAISAL * DEPOSIT_PERCENT) / 100;

        assertEq(nft.ownerOf(tokenId), challenger);

        vm.prank(challenger);
        colasseum.challenge{value: deposit}(address(nft), tokenId, TEST_APPRAISAL, "");

        assertEq(nft.ownerOf(tokenId), address(colasseum));
    }

    function test_challenge_storesLore() public {
        uint256 tokenId = _mintAndApprove(challenger);
        uint256 deposit = (TEST_APPRAISAL * DEPOSIT_PERCENT) / 100;

        vm.prank(challenger);
        uint256 trialId = colasseum.challenge{value: deposit}(address(nft), tokenId, TEST_APPRAISAL, "Epic lore");

        assertEq(colasseum.lore(trialId), "Epic lore");
    }

    function test_challenge_emitsGauntlet() public {
        uint256 tokenId = _mintAndApprove(challenger);
        uint256 appraisal = TEST_APPRAISAL;
        uint256 deposit = (appraisal * DEPOSIT_PERCENT) / 100;
        uint256 expectedDifficulty = (MAX_HASH / appraisal) * FIXED_TICKET_PRICE;

        vm.prank(challenger);
        vm.expectEmit(true, true, false, true);
        emit Gauntlet(0, challenger, address(nft), tokenId, appraisal, expectedDifficulty, "Test");
        colasseum.challenge{value: deposit}(address(nft), tokenId, appraisal, "Test");
    }

    function test_challenge_revertsZeroAppraisal() public {
        uint256 tokenId = _mintAndApprove(challenger);

        vm.prank(challenger);
        vm.expectRevert("Appraisal must be > 0");
        colasseum.challenge{value: 1}(address(nft), tokenId, 0, "");
    }

    function test_challenge_revertsInsufficientDeposit() public {
        uint256 tokenId = _mintAndApprove(challenger);
        uint256 appraisal = TEST_APPRAISAL;
        uint256 requiredDeposit = (appraisal * DEPOSIT_PERCENT) / 100;

        vm.prank(challenger);
        vm.expectRevert("Deposit below 5% appraisal");
        colasseum.challenge{value: requiredDeposit - 1}(address(nft), tokenId, appraisal, "");
    }

    // =========================================================================
    // valor() Tests
    // =========================================================================

    function test_valor_createsChance() public {
        uint256 trialId = _createTrial(challenger);
        uint256 commitment = 0x123456;
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 numChances = 10;
        uint256 payment = numChances * FIXED_TICKET_PRICE;

        vm.prank(participant);
        colasseum.valor{value: payment}(trialId, commitment, targetTimestamp, numChances);

        (
            address owner,
            uint256 chanceTrialId,
            uint256 storedCommitment,
            uint256 storedTarget,
            uint256 storedNumChances,
            uint8 status
        ) = colasseum.chances(0);

        assertEq(owner, participant);
        assertEq(chanceTrialId, trialId);
        assertEq(storedCommitment, commitment);
        assertEq(storedTarget, targetTimestamp);
        assertEq(storedNumChances, numChances);
        assertEq(status, 0);
    }

    function test_valor_updatesEthPool() public {
        uint256 trialId = _createTrial(challenger);
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 numChances = 10;
        uint256 payment = numChances * FIXED_TICKET_PRICE;

        vm.prank(participant);
        colasseum.valor{value: payment}(trialId, 0x123, targetTimestamp, numChances);

        (,,,,, uint256 ethPool,,,,) = colasseum.trials(trialId);
        assertEq(ethPool, payment);
    }

    function test_valor_emitsChallengeAccepted() public {
        uint256 trialId = _createTrial(challenger);
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 numChances = 10;
        uint256 payment = numChances * FIXED_TICKET_PRICE;

        (,,, uint256 appraisal, uint256 difficulty,,,,,) = colasseum.trials(trialId);

        vm.prank(participant);
        vm.expectEmit(true, true, true, true);
        emit ChallengeAccepted(trialId, 0, participant, numChances, appraisal, difficulty);
        colasseum.valor{value: payment}(trialId, 0x123, targetTimestamp, numChances);
    }

    function test_valor_revertsInactiveTrial() public {
        vm.prank(participant);
        vm.expectRevert("Trial not active");
        colasseum.valor{value: FIXED_TICKET_PRICE}(999, 0x123, block.timestamp + 5 minutes, 1);
    }

    function test_valor_revertsZeroChances() public {
        uint256 trialId = _createTrial(challenger);

        vm.prank(participant);
        vm.expectRevert("Must buy at least one chance");
        colasseum.valor{value: 0}(trialId, 0x123, block.timestamp + 5 minutes, 0);
    }

    function test_valor_revertsIncorrectPayment() public {
        uint256 trialId = _createTrial(challenger);
        uint256 numChances = 10;
        uint256 correctPayment = numChances * FIXED_TICKET_PRICE;

        vm.prank(participant);
        vm.expectRevert("Incorrect total payment for chances");
        colasseum.valor{value: correctPayment + 1}(trialId, 0x123, block.timestamp + 5 minutes, numChances);
    }

    function test_valor_revertsTargetTooFar() public {
        uint256 trialId = _createTrial(challenger);

        vm.prank(participant);
        vm.expectRevert("Target too far");
        colasseum.valor{value: FIXED_TICKET_PRICE}(trialId, 0x123, block.timestamp + 25 hours, 1);
    }

    function test_valor_multipleParticipants() public {
        uint256 trialId = _createTrial(challenger);
        uint256 targetTimestamp = block.timestamp + 5 minutes;

        vm.prank(participant);
        colasseum.valor{value: FIXED_TICKET_PRICE * 5}(trialId, 0x111, targetTimestamp, 5);

        vm.prank(participant2);
        colasseum.valor{value: FIXED_TICKET_PRICE * 10}(trialId, 0x222, targetTimestamp, 10);

        (,,,,, uint256 ethPool,,,,) = colasseum.trials(trialId);
        assertEq(ethPool, FIXED_TICKET_PRICE * 15);
    }

    // =========================================================================
    // victory() Tests
    // =========================================================================

    function test_victory_claimsPrize() public {
        uint256 trialId = _createTrial(challenger);
        uint256 commitment = 0x123456;
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 chanceId = _enterTrial(participant, trialId, commitment, targetTimestamp, 10);

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

        // Check trial is no longer active
        (,,,,,,,,, uint8 status) = colasseum.trials(trialId);
        assertEq(status & 1, 0); // TRIAL_ACTIVE bit is cleared

        // Check chance is claimed
        (,,,,, uint8 chanceStatus) = colasseum.chances(chanceId);
        assertEq(chanceStatus & 1, 1); // CHANCE_CLAIMED bit is set

        // Check NFT transferred to winner
        assertEq(nft.ownerOf(1), participant);
    }

    function test_victory_emitsVictorEvent() public {
        uint256 trialId = _createTrial(challenger);
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 chanceId = _enterTrial(participant, trialId, 0x123, targetTimestamp, 10);

        verifier.setAlwaysPass(true);
        vm.warp(targetTimestamp + SAFETY_DELAY + 1);

        (,,, uint256 appraisal, uint256 difficulty, uint256 ethPool,,,,) = colasseum.trials(trialId);
        uint256 expectedCharity = (ethPool * 1000) / BPS_DENOMINATOR;
        uint256 expectedChallenger = ethPool - expectedCharity;

        vm.prank(participant);
        vm.expectEmit(true, true, true, true);
        emit Victor(trialId, chanceId, participant, appraisal, difficulty, expectedCharity, expectedChallenger);
        colasseum.victory(
            chanceId,
            targetTimestamp,
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );
    }

    function test_victory_refundsDeposit() public {
        uint256 trialId = _createTrial(challenger);
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 chanceId = _enterTrial(participant, trialId, 0x123, targetTimestamp, 10);

        verifier.setAlwaysPass(true);
        vm.warp(targetTimestamp + SAFETY_DELAY + 1);

        uint256 challengerBalanceBefore = challenger.balance;

        vm.prank(participant);
        colasseum.victory(
            chanceId,
            targetTimestamp,
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );

        assertGt(challenger.balance, challengerBalanceBefore);
    }

    function test_victory_revertsNotOwner() public {
        uint256 trialId = _createTrial(challenger);
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 chanceId = _enterTrial(participant, trialId, 0x123, targetTimestamp, 10);

        verifier.setAlwaysPass(true);
        vm.warp(targetTimestamp + SAFETY_DELAY + 1);

        vm.prank(participant2); // Wrong owner
        vm.expectRevert("Not chance owner");
        colasseum.victory(
            chanceId,
            targetTimestamp,
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );
    }

    function test_victory_revertsAlreadyClaimed() public {
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

        vm.prank(participant);
        vm.expectRevert("Trial already ended");
        colasseum.victory(
            chanceId,
            targetTimestamp,
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );
    }

    function test_victory_revertsInvalidProof() public {
        uint256 trialId = _createTrial(challenger);
        uint256 targetTimestamp = block.timestamp + 5 minutes;
        uint256 chanceId = _enterTrial(participant, trialId, 0x123, targetTimestamp, 10);

        verifier.setAlwaysFail(true);
        vm.warp(targetTimestamp + SAFETY_DELAY + 1);

        vm.prank(participant);
        vm.expectRevert("Invalid ZK Proof");
        colasseum.victory(
            chanceId,
            targetTimestamp,
            [uint256(0), uint256(0)],
            [[uint256(0), uint256(0)], [uint256(0), uint256(0)]],
            [uint256(0), uint256(0)]
        );
    }

    // =========================================================================
    // cowardice() Tests
    // =========================================================================

    function test_cowardice_cancelsTrial() public {
        uint256 trialId = _createTrial(challenger);

        vm.prank(challenger);
        colasseum.cowardice(trialId);

        (,,,,,,,,, uint8 status) = colasseum.trials(trialId);
        assertEq(status & 1, 0); // TRIAL_ACTIVE cleared
        assertEq(status & 2, 2); // TRIAL_CANCELLED set
    }

    function test_cowardice_returnsNFT() public {
        uint256 trialId = _createTrial(challenger);

        assertEq(nft.ownerOf(1), address(colasseum));

        vm.prank(challenger);
        colasseum.cowardice(trialId);

        assertEq(nft.ownerOf(1), challenger);
    }

    function test_cowardice_forfeitsDeposit() public {
        uint256 trialId = _createTrial(challenger);

        uint256 charityBalanceBefore = charity.balance;
        (,,,,,, uint256 deposit,,,) = colasseum.trials(trialId);

        vm.prank(challenger);
        colasseum.cowardice(trialId);

        assertEq(charity.balance, charityBalanceBefore + deposit);
    }

    function test_cowardice_emitsSurrender() public {
        uint256 trialId = _createTrial(challenger);

        vm.prank(challenger);
        vm.expectEmit(true, false, false, false);
        emit Surrender(trialId);
        colasseum.cowardice(trialId);
    }

    function test_cowardice_revertsNotChallenger() public {
        uint256 trialId = _createTrial(challenger);

        vm.prank(participant);
        vm.expectRevert("Not the challenger");
        colasseum.cowardice(trialId);
    }

    function test_cowardice_revertsAlreadyCancelled() public {
        uint256 trialId = _createTrial(challenger);

        vm.prank(challenger);
        colasseum.cowardice(trialId);

        vm.prank(challenger);
        vm.expectRevert("Trial not active");
        colasseum.cowardice(trialId);
    }

    // =========================================================================
    // perseverance() Tests (batch refund)
    // =========================================================================

    function test_perseverance_refundsChances() public {
        uint256 trialId = _createTrial(challenger);
        uint256 numChances = 10;
        uint256 chanceId = _enterTrial(participant, trialId, 0x123, block.timestamp + 5 minutes, numChances);

        vm.prank(challenger);
        colasseum.cowardice(trialId);

        uint256 balanceBefore = participant.balance;
        uint256 expectedRefund = numChances * FIXED_TICKET_PRICE;

        uint256[] memory chanceIds = new uint256[](1);
        chanceIds[0] = chanceId;

        vm.prank(participant);
        colasseum.perseverance(chanceIds);

        assertEq(participant.balance, balanceBefore + expectedRefund);
    }

    function test_perseverance_marksChanceRefunded() public {
        uint256 trialId = _createTrial(challenger);
        uint256 chanceId = _enterTrial(participant, trialId, 0x123, block.timestamp + 5 minutes, 10);

        vm.prank(challenger);
        colasseum.cowardice(trialId);

        uint256[] memory chanceIds = new uint256[](1);
        chanceIds[0] = chanceId;

        vm.prank(participant);
        colasseum.perseverance(chanceIds);

        (,,,,, uint8 status) = colasseum.chances(chanceId);
        assertEq(status & 2, 2); // CHANCE_REFUNDED set
    }

    function test_perseverance_emitsJustice() public {
        uint256 trialId = _createTrial(challenger);
        uint256 numChances = 10;
        uint256 chanceId = _enterTrial(participant, trialId, 0x123, block.timestamp + 5 minutes, numChances);

        vm.prank(challenger);
        colasseum.cowardice(trialId);

        uint256 expectedRefund = numChances * FIXED_TICKET_PRICE;

        uint256[] memory chanceIds = new uint256[](1);
        chanceIds[0] = chanceId;

        vm.prank(participant);
        vm.expectEmit(true, true, true, true);
        emit Justice(trialId, chanceId, participant, expectedRefund, numChances);
        colasseum.perseverance(chanceIds);
    }

    function test_perseverance_batchRefunds() public {
        uint256 trialId = _createTrial(challenger);
        uint256 chanceId1 = _enterTrial(participant, trialId, 0x111, block.timestamp + 5 minutes, 5);
        uint256 chanceId2 = _enterTrial(participant, trialId, 0x222, block.timestamp + 6 minutes, 10);

        vm.prank(challenger);
        colasseum.cowardice(trialId);

        uint256 balanceBefore = participant.balance;
        uint256 expectedRefund = 15 * FIXED_TICKET_PRICE;

        uint256[] memory chanceIds = new uint256[](2);
        chanceIds[0] = chanceId1;
        chanceIds[1] = chanceId2;

        vm.prank(participant);
        colasseum.perseverance(chanceIds);

        assertEq(participant.balance, balanceBefore + expectedRefund);
    }

    function test_perseverance_skipsNotOwned() public {
        uint256 trialId = _createTrial(challenger);
        uint256 chanceId = _enterTrial(participant, trialId, 0x111, block.timestamp + 5 minutes, 5);

        vm.prank(challenger);
        colasseum.cowardice(trialId);

        uint256[] memory chanceIds = new uint256[](1);
        chanceIds[0] = chanceId;

        uint256 balanceBefore = participant2.balance;

        // participant2 tries to claim participant's chance - should skip silently
        vm.prank(participant2);
        colasseum.perseverance(chanceIds);

        assertEq(participant2.balance, balanceBefore);
    }

    function test_perseverance_skipsNotCancelled() public {
        uint256 trialId = _createTrial(challenger);
        uint256 chanceId = _enterTrial(participant, trialId, 0x111, block.timestamp + 5 minutes, 5);

        // Trial not cancelled

        uint256[] memory chanceIds = new uint256[](1);
        chanceIds[0] = chanceId;

        uint256 balanceBefore = participant.balance;

        vm.prank(participant);
        colasseum.perseverance(chanceIds);

        assertEq(participant.balance, balanceBefore); // No refund
    }

    function test_perseverance_skipsAlreadyRefunded() public {
        uint256 trialId = _createTrial(challenger);
        uint256 chanceId = _enterTrial(participant, trialId, 0x111, block.timestamp + 5 minutes, 5);

        vm.prank(challenger);
        colasseum.cowardice(trialId);

        uint256[] memory chanceIds = new uint256[](1);
        chanceIds[0] = chanceId;

        vm.prank(participant);
        colasseum.perseverance(chanceIds);

        uint256 balanceAfterFirst = participant.balance;

        // Try again - should skip
        vm.prank(participant);
        colasseum.perseverance(chanceIds);

        assertEq(participant.balance, balanceAfterFirst);
    }

    // =========================================================================
    // onERC721Received Tests
    // =========================================================================

    function test_onERC721Received_returnsSelector() public view {
        bytes4 selector = colasseum.onERC721Received(address(0), address(0), 0, "");
        assertEq(selector, bytes4(keccak256("onERC721Received(address,address,uint256,bytes)")));
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
        // ChallengeAccepted(uint256 indexed trialId, uint256 indexed chanceId, ...)
        // topic[0] = event signature, topic[1] = trialId, topic[2] = chanceId
        uint256 chanceId = uint256(logs[0].topics[2]);

        return chanceId;
    }
}
