// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IBeaconRoots
 * @dev Interface for the EIP-4788 System Contract.
 * Address: 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02
 */
interface IBeaconRoots {
    /// @dev Query the parent beacon block root for a given timestamp.
    /// @notice Timestamps must be non-zero and within the ring buffer (~24 hours).
    function timestampToBeaconRoot(
        uint256 timestamp
    ) external view returns (bytes32);
}

/**
 * @title IBeaconRandomness
 * @dev External interface for the Randomness Engine.
 */
interface IBeaconRandomness {
    error FutureTimestamp();
    error NotFinalized(uint256 target, uint256 current);
    error RandomnessExpired(uint256 timestamp);
    error ZeroRandomness();

    function getRandomness(
        uint256 targetTimestamp
    ) external view returns (bytes32);
    function verifyRandomness(
        uint256 targetTimestamp,
        bytes32 expectedRoot
    ) external view returns (bool);
    function isRandomnessAvailable(
        uint256 targetTimestamp
    ) external view returns (bool);
}

/**
 * @title BeaconRandomnessOracle
 * @author Fortress Protocol V3.4
 * @notice A stateless wrapper around EIP-4788 to standardize randomness retrieval.
 * @dev Enforces the "Deep Bake" safety gap and handles the Ring Buffer limitations.
 */
contract BeaconRandomnessOracle is IBeaconRandomness {
    // -------------------------------------------------------------------------
    // Constants & Config
    // -------------------------------------------------------------------------

    // The EIP-4788 System Contract Address
    address public constant BEACON_ROOTS_ADDRESS = 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02;

    // Beacon Chain Specs
    uint256 public constant SECONDS_PER_SLOT = 12;
    uint256 public constant SLOTS_PER_EPOCH = 32;

    // The "Deep Bake" Requirement (V3.4 Spec)
    // We wait 2 full epochs to ensure finality and prevent reorg attacks.
    // 2 Epochs = 64 slots * 12 seconds = 768 seconds (~12.8 minutes)
    uint256 public constant SAFETY_DELAY = 2 * SLOTS_PER_EPOCH * SECONDS_PER_SLOT;

    // The Ring Buffer Limit (EIP-4788 Standard)
    // 8191 roots are stored. 8191 * 12 seconds ~= 27.3 hours.
    // We use a conservative check to warn if we are nearing the edge.
    uint256 public constant BUFFER_LIMIT_SECONDS = 8191 * SECONDS_PER_SLOT;

    // -------------------------------------------------------------------------
    // Core Logic
    // -------------------------------------------------------------------------

    /**
     * @notice Retrieves the canonical randomness (Beacon Root) for a specific timestamp.
     * @dev This follows the "Just-in-Time" pattern.
     * @param targetTimestamp The Unix timestamp of the target block/slot.
     * @return randomness The 32-byte Beacon Block Root.
     */
    function getRandomness(
        uint256 targetTimestamp
    ) public view override returns (bytes32) {
        // 1. Sanity Check: Cannot query the future
        if (targetTimestamp > block.timestamp) {
            revert FutureTimestamp();
        }

        // 2. The "Deep Bake" Check: Ensure enough time has passed for finality
        if (block.timestamp < targetTimestamp + SAFETY_DELAY) {
            revert NotFinalized(targetTimestamp + SAFETY_DELAY, block.timestamp);
        }

        // 3. The "Hard Stop" Check: Ensure we haven't fallen out of the Ring Buffer
        // Note: EIP-4788 might return 0 or revert if out of bounds, but we check explicitly
        // to provide a clear error message conforming to the "Fortress" philosophy.
        if (block.timestamp > targetTimestamp + BUFFER_LIMIT_SECONDS) {
            revert RandomnessExpired(targetTimestamp);
        }

        // 4. Query the System Contract (Atomic Call)
        // EIP-4788 uses RAW calldata: just the timestamp as 32 bytes, no function selector
        (bool success, bytes memory data) = BEACON_ROOTS_ADDRESS.staticcall(abi.encode(targetTimestamp));

        // 5. Validation
        if (!success || data.length != 32) {
            revert ZeroRandomness();
        }

        bytes32 root = abi.decode(data, (bytes32));

        // If the slot was skipped or the buffer overwritten, root might be 0.
        if (root == bytes32(0)) {
            revert ZeroRandomness();
        }

        return root;
    }

    /**
     * @notice Verifies if a provided root matches the canonical chain truth.
     * @dev Used by the Colasseum contract to validate the ZK Proof public inputs.
     * @param targetTimestamp The timestamp the ZK proof claims to be valid for.
     * @param expectedRoot The root used inside the ZK proof generation.
     */
    function verifyRandomness(
        uint256 targetTimestamp,
        bytes32 expectedRoot
    ) external view override returns (bool) {
        bytes32 canonicalRoot = getRandomness(targetTimestamp);
        return canonicalRoot == expectedRoot;
    }

    /**
     * @notice Helper to check if randomness is currently claimable.
     * @dev Useful for UI frontends to know if the "Claim" button should be enabled.
     */
    function isRandomnessAvailable(
        uint256 targetTimestamp
    ) external view override returns (bool) {
        // Must be in the past
        if (targetTimestamp > block.timestamp) return false;

        // Must be finalized (Deep Bake)
        if (block.timestamp < targetTimestamp + SAFETY_DELAY) return false;

        // Must be within Ring Buffer (Hard Stop)
        if (block.timestamp > targetTimestamp + BUFFER_LIMIT_SECONDS) return false;

        return true;
    }
}

/**
 * @title MockBeaconOracle
 * @dev FOR TESTING ONLY. Deploy this instead of the real Oracle on local chains.
 */
contract MockBeaconOracle is IBeaconRandomness {
    bytes32 public seed;
    uint256 public constant SAFETY_DELAY = 768; // 12.8 mins
    uint256 public constant BUFFER_LIMIT_SECONDS = 98292; // ~27h

    mapping(uint256 => bytes32) public manualRoots;
    mapping(uint256 => bool) public missedSlots; // Simulates missed beacon slots

    function setSeed(
        bytes32 newSeed
    ) external {
        require(newSeed != bytes32(0), "SeedZero");
        seed = newSeed;
    }

    function setMockRootOverride(
        uint256 timestamp,
        bytes32 root
    ) external {
        manualRoots[timestamp] = root;
    }

    function clearMockRootOverride(
        uint256 timestamp
    ) external {
        delete manualRoots[timestamp];
    }

    function setMissedSlot(
        uint256 timestamp,
        bool missed
    ) external {
        missedSlots[timestamp] = missed;
    }

    function setMissedSlotRange(
        uint256 startTimestamp,
        uint256 count
    ) external {
        for (uint256 i = 0; i < count; i++) {
            missedSlots[startTimestamp + (i * 12)] = true;
        }
    }

    function clearMissedSlot(
        uint256 timestamp
    ) external {
        delete missedSlots[timestamp];
    }

    function getRandomness(
        uint256 targetTimestamp
    ) public view returns (bytes32) {
        if (targetTimestamp > block.timestamp) revert("Future");
        if (block.timestamp < targetTimestamp + SAFETY_DELAY) revert("Not Finalized");
        if (block.timestamp > targetTimestamp + BUFFER_LIMIT_SECONDS) revert("Expired");
        if (missedSlots[targetTimestamp]) revert("Zero Randomness"); // Simulate missed slot
        bytes32 manual = manualRoots[targetTimestamp];
        if (manual != bytes32(0)) return manual;
        if (seed == bytes32(0)) revert("SeedZero");
        bytes32 derived = keccak256(abi.encodePacked(seed, targetTimestamp));
        if (derived == bytes32(0)) revert("Zero Randomness");
        return derived;
    }

    function verifyRandomness(
        uint256 targetTimestamp,
        bytes32 expectedRoot
    ) external view returns (bool) {
        return getRandomness(targetTimestamp) == expectedRoot;
    }

    function isRandomnessAvailable(
        uint256 targetTimestamp
    ) external view returns (bool) {
        if (targetTimestamp > block.timestamp) return false;
        if (block.timestamp < targetTimestamp + SAFETY_DELAY) return false;
        if (block.timestamp > targetTimestamp + BUFFER_LIMIT_SECONDS) return false;
        if (manualRoots[targetTimestamp] != bytes32(0)) return true;
        return seed != bytes32(0);
    }
}
