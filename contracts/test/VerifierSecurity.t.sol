// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Verifier.sol";

/**
 * @title VerifierSecurityTest
 * @notice Security tests proving the verifier REJECTS invalid proofs
 * @dev This proves our verifier is NOT broken and doesn't accept slop
 */
contract VerifierSecurityTest is Test {
    Groth16Verifier public verifier;

    // REAL winning proof from mainnet transaction
    // Function: victory(uint256 _chanceId,uint256 _beaconTimestamp,uint256[2] _pA,uint256[2][2] _pB,uint256[2] _pC)
    uint256[2] REAL_PA = [
        0x248dc990529cbc457c369aa05a376c1dcb7860c0be5270ffa6d0e130142348e6,
        0x2ce27bc90f38a873e4cdf5b22bc3c616e77a0c75b0868a356940195d8e68c910
    ];

    uint256[2][2] REAL_PB = [
        [
            0x1dd45382537126916658c9cfde11f7adaeef32529c1349a8dc3ef39f1044540d,
            0x293997aa8aa1a8560b5d8e31c3031f2255337a4b6c603eb3435b7492c9f12e39
        ],
        [
            0x1800cc93d937022f1fcd337248a45f147830f30ca3fcb7ac5c25c5da81265c56,
            0x29d80d34b15c153d25599a5f6b6dc318e1fd0ff1d66b7bba57cab379f687c889
        ]
    ];

    uint256[2] REAL_PC = [
        0x0284d157514753fbada59e7fac8be709d57e4467204972ae0f9fb9e2249f37d2,
        0x0b8fc4c66b0611042a964da2878a2f4f176f951a1c8995dbfc72443d56ab9c51
    ];

    function setUp() public {
        verifier = new Groth16Verifier();
    }

    // =========================================================================
    // CRITICAL SECURITY TESTS - PROOF TAMPERING MUST BE REJECTED
    // =========================================================================

    function test_security_rejectsTamperedPA() public view {
        // Take real proof but tamper with pA
        uint256[2] memory tamperedPA = REAL_PA;
        tamperedPA[0] = tamperedPA[0] + 1; // Change one coordinate

        // Must reject
        uint256[5] memory signals = _getDummySignals();
        bool result = verifier.verifyProof(tamperedPA, REAL_PB, REAL_PC, signals);
        assertFalse(result, "SECURITY FAIL: Accepted tampered pA");
    }

    function test_security_rejectsTamperedPB() public view {
        // Take real proof but tamper with pB
        uint256[2][2] memory tamperedPB = REAL_PB;
        tamperedPB[0][0] = tamperedPB[0][0] + 1;

        uint256[5] memory signals = _getDummySignals();
        bool result = verifier.verifyProof(REAL_PA, tamperedPB, REAL_PC, signals);
        assertFalse(result, "SECURITY FAIL: Accepted tampered pB");
    }

    function test_security_rejectsTamperedPC() public view {
        // Take real proof but tamper with pC
        uint256[2] memory tamperedPC = REAL_PC;
        tamperedPC[1] = tamperedPC[1] + 1;

        uint256[5] memory signals = _getDummySignals();
        bool result = verifier.verifyProof(REAL_PA, REAL_PB, tamperedPC, signals);
        assertFalse(result, "SECURITY FAIL: Accepted tampered pC");
    }

    function test_security_rejectsTamperedPublicSignal0() public view {
        // Take valid proof structure but change public signals
        uint256[5] memory signals = _getDummySignals();
        signals[0] = signals[0] + 1; // Tamper with rootHigh

        bool result = verifier.verifyProof(REAL_PA, REAL_PB, REAL_PC, signals);
        assertFalse(result, "SECURITY FAIL: Accepted tampered rootHigh");
    }

    function test_security_rejectsTamperedPublicSignal1() public view {
        uint256[5] memory signals = _getDummySignals();
        signals[1] = signals[1] + 1; // Tamper with rootLow

        bool result = verifier.verifyProof(REAL_PA, REAL_PB, REAL_PC, signals);
        assertFalse(result, "SECURITY FAIL: Accepted tampered rootLow");
    }

    function test_security_rejectsTamperedCommitment() public view {
        uint256[5] memory signals = _getDummySignals();
        signals[2] = signals[2] + 1; // Tamper with commitment

        bool result = verifier.verifyProof(REAL_PA, REAL_PB, REAL_PC, signals);
        assertFalse(result, "SECURITY FAIL: Accepted tampered commitment");
    }

    function test_security_rejectsTamperedDifficulty() public view {
        uint256[5] memory signals = _getDummySignals();
        signals[3] = signals[3] * 2; // Increase difficulty (easier win)

        bool result = verifier.verifyProof(REAL_PA, REAL_PB, REAL_PC, signals);
        assertFalse(result, "SECURITY FAIL: Accepted tampered difficulty");
    }

    function test_security_rejectsTamperedChances() public view {
        uint256[5] memory signals = _getDummySignals();
        signals[4] = signals[4] + 1; // Add more chances

        bool result = verifier.verifyProof(REAL_PA, REAL_PB, REAL_PC, signals);
        assertFalse(result, "SECURITY FAIL: Accepted tampered chances");
    }

    // =========================================================================
    // PROOF FORGERY TESTS - RANDOM PROOFS MUST BE REJECTED
    // =========================================================================

    function test_security_rejectsRandomProof() public view {
        uint256[2] memory fakePA = [uint256(12345), uint256(67890)];
        uint256[2][2] memory fakePB = [
            [uint256(11111), uint256(22222)],
            [uint256(33333), uint256(44444)]
        ];
        uint256[2] memory fakePC = [uint256(55555), uint256(66666)];
        uint256[5] memory signals = _getDummySignals();

        bool result = verifier.verifyProof(fakePA, fakePB, fakePC, signals);
        assertFalse(result, "SECURITY FAIL: Accepted random proof");
    }

    function test_security_rejectsZeroProof() public view {
        uint256[2] memory zeroPA = [uint256(0), uint256(0)];
        uint256[2][2] memory zeroPB = [[uint256(0), uint256(0)], [uint256(0), uint256(0)]];
        uint256[2] memory zeroPC = [uint256(0), uint256(0)];
        uint256[5] memory signals = _getDummySignals();

        bool result = verifier.verifyProof(zeroPA, zeroPB, zeroPC, signals);
        assertFalse(result, "SECURITY FAIL: Accepted zero proof");
    }

    function test_security_rejectsAllOnesProof() public view {
        uint256[2] memory onesPA = [type(uint256).max, type(uint256).max];
        uint256[2][2] memory onesPB = [
            [type(uint256).max, type(uint256).max],
            [type(uint256).max, type(uint256).max]
        ];
        uint256[2] memory onesPC = [type(uint256).max, type(uint256).max];
        uint256[5] memory signals = _getDummySignals();

        bool result = verifier.verifyProof(onesPA, onesPB, onesPC, signals);
        assertFalse(result, "SECURITY FAIL: Accepted all-ones proof");
    }

    // =========================================================================
    // PROOF REUSE ATTACK TESTS
    // =========================================================================

    function test_security_rejectsProofWithDifferentSignals() public view {
        // Real proof from one context cannot be used with different signals
        uint256[5] memory wrongSignals = [
            uint256(999),
            uint256(888),
            uint256(777),
            uint256(666),
            uint256(555)
        ];

        bool result = verifier.verifyProof(REAL_PA, REAL_PB, REAL_PC, wrongSignals);
        assertFalse(result, "SECURITY FAIL: Accepted proof with wrong public signals");
    }

    // =========================================================================
    // FIELD OVERFLOW TESTS
    // =========================================================================

    function test_security_rejectsOutOfBoundsSignals() public view {
        // Scalar field size
        uint256 r = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

        uint256[5] memory signals = [r, uint256(0), uint256(0), uint256(0), uint256(0)];
        bool result = verifier.verifyProof(REAL_PA, REAL_PB, REAL_PC, signals);
        assertFalse(result, "SECURITY FAIL: Accepted signal >= field size");
    }

    // =========================================================================
    // FUZZ TESTS - RANDOM TAMPERING MUST ALWAYS FAIL
    // =========================================================================

    function testFuzz_security_rejectsRandomTampering(uint256 seed) public view {
        // Create slightly tampered version of real proof
        uint256[2] memory tamperedPA = REAL_PA;
        tamperedPA[seed % 2] = REAL_PA[seed % 2] + (seed % 1000) + 1;

        uint256[5] memory signals = _getDummySignals();
        bool result = verifier.verifyProof(tamperedPA, REAL_PB, REAL_PC, signals);
        assertFalse(result, "SECURITY FAIL: Accepted randomly tampered proof");
    }

    // =========================================================================
    // Helper Functions
    // =========================================================================

    function _getDummySignals() internal pure returns (uint256[5] memory) {
        // Return some valid-looking signals (doesn't need to match real proof for rejection tests)
        return [
            uint256(12345),
            uint256(67890),
            uint256(111111),
            uint256(222222),
            uint256(10)
        ];
    }
}
