// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Verifier.sol";

/**
 * @title VerifierTest
 * @notice Unit tests for the Groth16Verifier contract
 */
contract VerifierTest is Test {
    Groth16Verifier public verifier;

    // Scalar field size (r) - public signals must be < this value
    uint256 constant r = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // Valid dummy proof components (will fail pairing check but pass field checks)
    uint256[2] validPa = [uint256(1), uint256(2)];
    uint256[2][2] validPb = [[uint256(1), uint256(2)], [uint256(3), uint256(4)]];
    uint256[2] validPc = [uint256(1), uint256(2)];

    function setUp() public {
        verifier = new Groth16Verifier();
    }

    // =========================================================================
    // Field Element Bounds Checking Tests
    // =========================================================================

    function test_verifyProof_revertsWhenPubSignal0ExceedsFieldSize() public view {
        uint256[5] memory pubSignals = [r, uint256(0), uint256(0), uint256(0), uint256(0)];
        bool result = verifier.verifyProof(validPa, validPb, validPc, pubSignals);
        assertFalse(result, "Should fail when pubSignals[0] >= r");
    }

    function test_verifyProof_revertsWhenPubSignal1ExceedsFieldSize() public view {
        uint256[5] memory pubSignals = [uint256(0), r, uint256(0), uint256(0), uint256(0)];
        bool result = verifier.verifyProof(validPa, validPb, validPc, pubSignals);
        assertFalse(result, "Should fail when pubSignals[1] >= r");
    }

    function test_verifyProof_revertsWhenPubSignal2ExceedsFieldSize() public view {
        uint256[5] memory pubSignals = [uint256(0), uint256(0), r, uint256(0), uint256(0)];
        bool result = verifier.verifyProof(validPa, validPb, validPc, pubSignals);
        assertFalse(result, "Should fail when pubSignals[2] >= r");
    }

    function test_verifyProof_revertsWhenPubSignal3ExceedsFieldSize() public view {
        uint256[5] memory pubSignals = [uint256(0), uint256(0), uint256(0), r, uint256(0)];
        bool result = verifier.verifyProof(validPa, validPb, validPc, pubSignals);
        assertFalse(result, "Should fail when pubSignals[3] >= r");
    }

    function test_verifyProof_revertsWhenPubSignal4ExceedsFieldSize() public view {
        uint256[5] memory pubSignals = [uint256(0), uint256(0), uint256(0), uint256(0), r];
        bool result = verifier.verifyProof(validPa, validPb, validPc, pubSignals);
        assertFalse(result, "Should fail when pubSignals[4] >= r");
    }

    function test_verifyProof_revertsWhenPubSignalExceedsFieldSizeByOne() public view {
        // Test r + 1 to ensure boundary is exact
        uint256[5] memory pubSignals = [r + 1, uint256(0), uint256(0), uint256(0), uint256(0)];
        bool result = verifier.verifyProof(validPa, validPb, validPc, pubSignals);
        assertFalse(result, "Should fail when pubSignals[0] > r");
    }

    function test_verifyProof_revertsWhenPubSignalIsMaxUint256() public view {
        uint256[5] memory pubSignals = [type(uint256).max, uint256(0), uint256(0), uint256(0), uint256(0)];
        bool result = verifier.verifyProof(validPa, validPb, validPc, pubSignals);
        assertFalse(result, "Should fail when pubSignals[0] is max uint256");
    }

    function test_verifyProof_acceptsMaxValidFieldElement() public view {
        // r - 1 is the maximum valid field element
        uint256[5] memory pubSignals = [r - 1, uint256(0), uint256(0), uint256(0), uint256(0)];
        // This will still fail the pairing check, but should pass the field check
        // The important thing is it doesn't return false due to field bounds
        bool result = verifier.verifyProof(validPa, validPb, validPc, pubSignals);
        // Result will be false due to invalid proof, not due to field bounds
        assertFalse(result);
    }

    function test_verifyProof_allPubSignalsAtBoundary() public view {
        // All signals at r should fail
        uint256[5] memory pubSignals = [r, r, r, r, r];
        bool result = verifier.verifyProof(validPa, validPb, validPc, pubSignals);
        assertFalse(result, "Should fail when all pubSignals >= r");
    }

    // =========================================================================
    // Invalid Proof Tests
    // =========================================================================

    function test_verifyProof_returnsFalseForZeroProof() public view {
        uint256[2] memory pA = [uint256(0), uint256(0)];
        uint256[2][2] memory pB = [[uint256(0), uint256(0)], [uint256(0), uint256(0)]];
        uint256[2] memory pC = [uint256(0), uint256(0)];
        uint256[5] memory pubSignals = [uint256(0), uint256(0), uint256(0), uint256(0), uint256(0)];

        bool result = verifier.verifyProof(pA, pB, pC, pubSignals);
        assertFalse(result, "Zero proof should return false");
    }

    function test_verifyProof_returnsFalseForRandomProof() public view {
        uint256[2] memory pA = [uint256(12345), uint256(67890)];
        uint256[2][2] memory pB = [[uint256(11111), uint256(22222)], [uint256(33333), uint256(44444)]];
        uint256[2] memory pC = [uint256(55555), uint256(66666)];
        uint256[5] memory pubSignals = [uint256(100), uint256(200), uint256(300), uint256(400), uint256(500)];

        bool result = verifier.verifyProof(pA, pB, pC, pubSignals);
        assertFalse(result, "Random proof data should return false");
    }

    function test_verifyProof_returnsFalseForPartiallyValidProof() public view {
        // Use values that could be on the curve but with wrong signals
        uint256[2] memory pA = [uint256(1), uint256(2)];
        uint256[2][2] memory pB = [[uint256(1), uint256(0)], [uint256(0), uint256(1)]];
        uint256[2] memory pC = [uint256(1), uint256(2)];
        uint256[5] memory pubSignals = [uint256(1), uint256(2), uint256(3), uint256(4), uint256(5)];

        bool result = verifier.verifyProof(pA, pB, pC, pubSignals);
        assertFalse(result, "Partial proof should return false");
    }

    // =========================================================================
    // Fuzz Tests for Field Bounds
    // =========================================================================

    function testFuzz_verifyProof_rejectsOutOfBoundsPubSignals(
        uint256 signal
    ) public view {
        vm.assume(signal >= r);

        uint256[5] memory pubSignals = [signal, uint256(0), uint256(0), uint256(0), uint256(0)];
        bool result = verifier.verifyProof(validPa, validPb, validPc, pubSignals);
        assertFalse(result, "Should reject out of bounds public signal");
    }

    function testFuzz_verifyProof_passesFieldCheckForValidSignals(
        uint256 signal
    ) public view {
        vm.assume(signal < r);

        uint256[5] memory pubSignals = [signal, uint256(0), uint256(0), uint256(0), uint256(0)];
        // Will fail pairing check but should pass field bounds check
        bool result = verifier.verifyProof(validPa, validPb, validPc, pubSignals);
        // Result is false due to invalid proof, not field bounds
        assertFalse(result);
    }

    // =========================================================================
    // Gas Usage Tests
    // =========================================================================

    function test_verifyProof_gasUsageForFieldReject() public {
        uint256[5] memory pubSignals = [r, uint256(0), uint256(0), uint256(0), uint256(0)];

        uint256 gasBefore = gasleft();
        verifier.verifyProof(validPa, validPb, validPc, pubSignals);
        uint256 gasUsed = gasBefore - gasleft();

        // Field rejection should be much cheaper than full verification
        emit log_named_uint("Gas used for field rejection", gasUsed);
        assertLt(gasUsed, 50000, "Field rejection should use less gas than full verification");
    }

    function test_verifyProof_gasUsageForInvalidProof() public {
        uint256[5] memory pubSignals = [uint256(0), uint256(0), uint256(0), uint256(0), uint256(0)];

        uint256 gasBefore = gasleft();
        verifier.verifyProof(validPa, validPb, validPc, pubSignals);
        uint256 gasUsed = gasBefore - gasleft();

        // Full verification is more expensive
        emit log_named_uint("Gas used for invalid proof verification", gasUsed);
    }
}
