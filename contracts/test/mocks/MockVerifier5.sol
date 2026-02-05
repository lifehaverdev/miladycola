// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockVerifier5
 * @notice Mock verifier for testing Colasseum with 5 public signals
 * @dev Matches the Groth16Verifier interface used by miladycola4.sol
 */
contract MockVerifier5 {
    // Control flags for testing
    bool public alwaysPass;
    bool public alwaysFail;

    // Track expected values for precise verification
    mapping(bytes32 => bool) public validProofHashes;

    function setAlwaysPass(
        bool _pass
    ) external {
        alwaysPass = _pass;
        if (_pass) alwaysFail = false;
    }

    function setAlwaysFail(
        bool _fail
    ) external {
        alwaysFail = _fail;
        if (_fail) alwaysPass = false;
    }

    function setValidProof(
        uint256 rootHigh,
        uint256 rootLow,
        uint256 commitment,
        uint256 difficulty,
        uint256 numChances
    ) external {
        bytes32 hash = keccak256(abi.encodePacked(rootHigh, rootLow, commitment, difficulty, numChances));
        validProofHashes[hash] = true;
    }

    function clearValidProof(
        uint256 rootHigh,
        uint256 rootLow,
        uint256 commitment,
        uint256 difficulty,
        uint256 numChances
    ) external {
        bytes32 hash = keccak256(abi.encodePacked(rootHigh, rootLow, commitment, difficulty, numChances));
        validProofHashes[hash] = false;
    }

    function verifyProof(
        uint256[2] calldata, /* _pA */
        uint256[2][2] calldata, /* _pB */
        uint256[2] calldata, /* _pC */
        uint256[5] calldata _pubSignals
    ) external view returns (bool) {
        if (alwaysFail) {
            return false;
        }
        if (alwaysPass) {
            return true;
        }

        uint256 rootHigh = _pubSignals[0];
        uint256 rootLow = _pubSignals[1];
        uint256 commitment = _pubSignals[2];
        uint256 difficulty = _pubSignals[3];
        uint256 numChances = _pubSignals[4];

        bytes32 hash = keccak256(abi.encodePacked(rootHigh, rootLow, commitment, difficulty, numChances));
        return validProofHashes[hash];
    }
}
