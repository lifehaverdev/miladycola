// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Verifier.sol";

/**
 * @title VerifyRealWin
 * @notice Verifies a REAL winning proof from mainnet using actual beacon data
 */
contract VerifyRealWin is Test {
    Groth16Verifier public verifier;

    function setUp() public {
        verifier = new Groth16Verifier();
    }

    function test_verifyRealWinningProof() public {
        // =====================================================================
        // REAL DATA FROM MAINNET
        // =====================================================================

        // Beacon root from getRandomness(1770428351)
        bytes32 beaconRoot = 0x7bdc5fff0246d9ca8b22368d9ea366aed5e6f5a7ba126cf31a20ebd26bc55808;

        // Split into high/low 128-bit parts (exactly how victory() does it)
        uint128 rootHigh = uint128(uint256(beaconRoot) >> 128);
        uint128 rootLow = uint128(uint256(beaconRoot));

        // From chances(1)
        uint256 commitment = 10117544964956295001663774200624729814665918637592321218554397598511534901079;
        uint256 numChances = 3900001;

        // From trials(1) - 5th field is difficulty
        uint256 difficulty = 56123699671382756980118989090403269457816318975425729086405000000000;

        // Public signals in the order the circuit expects
        uint256[5] memory pubSignals = [
            uint256(rootHigh),
            uint256(rootLow),
            commitment,
            difficulty,
            numChances
        ];

        // Log the signals for inspection
        emit log_named_uint("rootHigh", uint256(rootHigh));
        emit log_named_uint("rootLow", uint256(rootLow));
        emit log_named_uint("commitment", commitment);
        emit log_named_uint("difficulty", difficulty);
        emit log_named_uint("numChances", numChances);

        // Real proof from victory tx 0x943f65e0...
        uint256[2] memory pA = [
            0x248dc990529cbc457c369aa05a376c1dcb7860c0be5270ffa6d0e130142348e6,
            0x2ce27bc90f38a873e4cdf5b22bc3c616e77a0c75b0868a356940195d8e68c910
        ];

        uint256[2][2] memory pB = [
            [
                0x1dd45382537126916658c9cfde11f7adaeef32529c1349a8dc3ef39f1044540d,
                0x293997aa8aa1a8560b5d8e31c3031f2255337a4b6c603eb3435b7492c9f12e39
            ],
            [
                0x1800cc93d937022f1fcd337248a45f147830f30ca3fcb7ac5c25c5da81265c56,
                0x29d80d34b15c153d25599a5f6b6dc318e1fd0ff1d66b7bba57cab379f687c889
            ]
        ];

        uint256[2] memory pC = [
            0x0284d157514753fbada59e7fac8be709d57e4467204972ae0f9fb9e2249f37d2,
            0x0b8fc4c66b0611042a964da2878a2f4f176f951a1c8995dbfc72443d56ab9c51
        ];

        // =====================================================================
        // THE VERIFICATION
        // =====================================================================
        bool isValid = verifier.verifyProof(pA, pB, pC, pubSignals);

        assertTrue(isValid, "REAL WINNING PROOF MUST BE VALID");
        emit log("PROOF VERIFIED: The winning proof is cryptographically valid!");
    }

    function test_realProofFailsWithWrongBeaconRoot() public view {
        // Same proof but with a DIFFERENT beacon root
        bytes32 fakeRoot = 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef;
        uint128 rootHigh = uint128(uint256(fakeRoot) >> 128);
        uint128 rootLow = uint128(uint256(fakeRoot));

        uint256 commitment = 10117544964956295001663774200624729814665918637592321218554397598511534901079;
        uint256 numChances = 3900001;
        uint256 difficulty = 56123699671382756980118989090403269457816318975425729086405000000000;

        uint256[5] memory pubSignals = [
            uint256(rootHigh),
            uint256(rootLow),
            commitment,
            difficulty,
            numChances
        ];

        uint256[2] memory pA = [
            0x248dc990529cbc457c369aa05a376c1dcb7860c0be5270ffa6d0e130142348e6,
            0x2ce27bc90f38a873e4cdf5b22bc3c616e77a0c75b0868a356940195d8e68c910
        ];

        uint256[2][2] memory pB = [
            [
                0x1dd45382537126916658c9cfde11f7adaeef32529c1349a8dc3ef39f1044540d,
                0x293997aa8aa1a8560b5d8e31c3031f2255337a4b6c603eb3435b7492c9f12e39
            ],
            [
                0x1800cc93d937022f1fcd337248a45f147830f30ca3fcb7ac5c25c5da81265c56,
                0x29d80d34b15c153d25599a5f6b6dc318e1fd0ff1d66b7bba57cab379f687c889
            ]
        ];

        uint256[2] memory pC = [
            0x0284d157514753fbada59e7fac8be709d57e4467204972ae0f9fb9e2249f37d2,
            0x0b8fc4c66b0611042a964da2878a2f4f176f951a1c8995dbfc72443d56ab9c51
        ];

        bool isValid = verifier.verifyProof(pA, pB, pC, pubSignals);
        assertFalse(isValid, "Proof MUST fail with wrong beacon root");
    }

    function test_realProofFailsWithWrongDifficulty() public view {
        bytes32 beaconRoot = 0x7bdc5fff0246d9ca8b22368d9ea366aed5e6f5a7ba126cf31a20ebd26bc55808;
        uint128 rootHigh = uint128(uint256(beaconRoot) >> 128);
        uint128 rootLow = uint128(uint256(beaconRoot));

        uint256 commitment = 10117544964956295001663774200624729814665918637592321218554397598511534901079;
        uint256 numChances = 3900001;
        // Double the difficulty (easier to win - an attacker would want this)
        uint256 difficulty = 56123699671382756980118989090403269457816318975425729086405000000000 * 2;

        uint256[5] memory pubSignals = [
            uint256(rootHigh),
            uint256(rootLow),
            commitment,
            difficulty,
            numChances
        ];

        uint256[2] memory pA = [
            0x248dc990529cbc457c369aa05a376c1dcb7860c0be5270ffa6d0e130142348e6,
            0x2ce27bc90f38a873e4cdf5b22bc3c616e77a0c75b0868a356940195d8e68c910
        ];

        uint256[2][2] memory pB = [
            [
                0x1dd45382537126916658c9cfde11f7adaeef32529c1349a8dc3ef39f1044540d,
                0x293997aa8aa1a8560b5d8e31c3031f2255337a4b6c603eb3435b7492c9f12e39
            ],
            [
                0x1800cc93d937022f1fcd337248a45f147830f30ca3fcb7ac5c25c5da81265c56,
                0x29d80d34b15c153d25599a5f6b6dc318e1fd0ff1d66b7bba57cab379f687c889
            ]
        ];

        uint256[2] memory pC = [
            0x0284d157514753fbada59e7fac8be709d57e4467204972ae0f9fb9e2249f37d2,
            0x0b8fc4c66b0611042a964da2878a2f4f176f951a1c8995dbfc72443d56ab9c51
        ];

        bool isValid = verifier.verifyProof(pA, pB, pC, pubSignals);
        assertFalse(isValid, "Proof MUST fail with inflated difficulty");
    }
}
