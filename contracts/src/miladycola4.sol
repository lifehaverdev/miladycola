// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ranmilio.sol";
import "./Verifier.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";

interface IERC721 {
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) external;
}

/**
 * @title Colasseum
 * @notice A multi-tenant challenge protocol.
 * @dev Allows users to create provably fair trials with variable difficulty using ZK-SNARKs.
 *      Frontend uses event indexing for queries - contract is lean and clean.
 */
contract Colasseum is ReentrancyGuard {
    // -------------------------------------------------------------------------
    // 1. Immutable Infrastructure
    // -------------------------------------------------------------------------
    IBeaconRandomness immutable randomnessOracle;
    Groth16Verifier immutable zkVerifier;

    /// @notice Maximum time window for beacon timestamp (12 slots = 144 seconds)
    uint256 constant MAX_MISSED_SLOTS = 12;
    /// @notice Beacon chain slot interval in seconds
    uint256 constant SECONDS_PER_SLOT = 12;

    struct NonProfit {
        address donations;
        uint256 generosity; // basis points for the nonprofit's share out of ten thousand
    }

    NonProfit public charity;
    NonProfit private pendingHonor;
    address public witness;

    uint8 private constant TRIAL_ACTIVE = 1 << 0;
    uint8 private constant TRIAL_CANCELLED = 1 << 1;
    uint8 private constant CHANCE_CLAIMED = 1 << 0;
    uint8 private constant CHANCE_REFUNDED = 1 << 1;

    modifier byVirtue() {
        require(msg.sender == charity.donations, "Not Worthy");
        _;
    }

    modifier byReason() {
        require(msg.sender == witness, "Not Witness");
        _;
    }

    // -------------------------------------------------------------------------
    // 2. Data Structures
    // -------------------------------------------------------------------------

    struct Trial {
        address payable challenger;
        address nftContract;
        uint256 nftId;
        uint256 appraisal;
        uint256 difficulty;
        uint256 ethPool;
        uint256 depositEscrow;
        uint64 creationTime;
        uint16 charityBps; // locked at creation to prevent rug
        uint8 status;
    }

    struct Chance {
        address owner;
        uint256 trialId;
        uint256 commitment;
        uint256 targetTimestamp;
        uint256 numChances;
        uint8 status;
    }

    uint256 private nextTrialId;
    mapping(uint256 => Trial) public trials;
    mapping(uint256 => string) public lore;

    uint256 private nextChanceId;
    mapping(uint256 => Chance) public chances;

    // -------------------------------------------------------------------------
    // 3. Events (frontend indexes these for queries)
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // 4. Constants
    // -------------------------------------------------------------------------
    uint256 constant MAX_HASH = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 constant FIXED_TICKET_PRICE = 0.000000001 ether;

    // -------------------------------------------------------------------------
    // 5. Constructor & Admin
    // -------------------------------------------------------------------------
    constructor(
        address _oracle,
        address _verifier,
        address _charity,
        uint256 _generosity,
        address _witness
    ) {
        randomnessOracle = IBeaconRandomness(_oracle);
        zkVerifier = Groth16Verifier(_verifier);
        require(_charity != address(0), "Invalid charity");
        require(_generosity <= 10_000, "Rate too high");
        require(_witness != address(0), "Invalid witness");
        charity = NonProfit({donations: _charity, generosity: _generosity});
        witness = _witness;
    }

    function honor(
        address _donations,
        uint256 _generosity
    ) external byVirtue {
        require(_donations != address(0), "Invalid charity");
        require(_generosity <= 10_000, "Rate too high");
        pendingHonor = NonProfit({donations: _donations, generosity: _generosity});
        emit HonorPending(_donations, _generosity);
    }

    function affirm() external byReason {
        require(pendingHonor.donations != address(0), "No pending proposal");
        charity = pendingHonor;
        emit HonorAffirmed(pendingHonor.donations, pendingHonor.generosity);
        delete pendingHonor;
    }

    function trust(
        address _witness
    ) external byReason {
        require(_witness != address(0), "Invalid witness");
        emit TrustBestowed(witness, _witness);
        witness = _witness;
    }

    // -------------------------------------------------------------------------
    // 6. Trial Creation
    // -------------------------------------------------------------------------
    function challenge(
        address _nftContract,
        uint256 _nftId,
        uint256 _appraisal,
        string memory _lore
    ) public payable returns (uint256) {
        require(_appraisal > 0, "Appraisal must be > 0");

        uint256 difficulty = (MAX_HASH / _appraisal) * FIXED_TICKET_PRICE;
        require(difficulty > 0, "Appraisal is too high, results in zero difficulty");
        uint256 depositRequired = (_appraisal * 5) / 100;
        require(msg.value >= depositRequired, "Deposit below 5% appraisal");

        IERC721(_nftContract).transferFrom(msg.sender, address(this), _nftId);

        uint256 trialId = nextTrialId++;

        trials[trialId] = Trial({
            challenger: payable(msg.sender),
            nftContract: _nftContract,
            nftId: _nftId,
            appraisal: _appraisal,
            difficulty: difficulty,
            ethPool: 0,
            depositEscrow: msg.value,
            creationTime: uint64(block.timestamp),
            charityBps: uint16(charity.generosity), // lock at creation
            status: TRIAL_ACTIVE
        });

        lore[trialId] = _lore;

        emit Gauntlet(trialId, msg.sender, _nftContract, _nftId, _appraisal, difficulty, _lore);
        return trialId;
    }

    // -------------------------------------------------------------------------
    // 7. Entry Logic
    // -------------------------------------------------------------------------
    function valor(
        uint256 _trialId,
        uint256 _commitment,
        uint256 _targetTimestamp,
        uint256 _numChances
    ) public payable virtual {
        Trial storage trial = trials[_trialId];
        require(_isTrialActive(trial), "Trial not active");
        require(_numChances > 0, "Must buy at least one chance");
        require(msg.value == _numChances * FIXED_TICKET_PRICE, "Incorrect total payment for chances");
        require(_targetTimestamp >= block.timestamp, "Target must be in future");
        require(_targetTimestamp < block.timestamp + 24 hours, "Target too far");

        uint256 chanceId = nextChanceId++;

        chances[chanceId] = Chance({
            owner: msg.sender,
            trialId: _trialId,
            commitment: _commitment,
            targetTimestamp: _targetTimestamp,
            numChances: _numChances,
            status: 0
        });

        trial.ethPool += msg.value;

        emit ChallengeAccepted(_trialId, chanceId, msg.sender, _numChances, trial.appraisal, trial.difficulty);
    }

    // -------------------------------------------------------------------------
    // 8. Settlement
    // -------------------------------------------------------------------------

    /**
     * @notice Claim victory with a ZK proof.
     * @dev Caller must provide the actual block timestamp used for beacon root lookup.
     *      This timestamp must be >= targetTimestamp and within MAX_MISSED_SLOTS * 12 seconds.
     *      The frontend finds this by searching actual blocks, not by guessing timestamps.
     *
     * @param _chanceId The ID of the chance being claimed
     * @param _beaconTimestamp The actual block timestamp to use for beacon root lookup
     * @param _pA ZK proof component A
     * @param _pB ZK proof component B
     * @param _pC ZK proof component C
     */
    function victory(
        uint256 _chanceId,
        uint256 _beaconTimestamp,
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC
    ) public nonReentrant {
        Chance storage chance = chances[_chanceId];
        Trial storage trial = trials[chance.trialId];

        require(chance.owner == msg.sender, "Not chance owner");
        require(_isTrialActive(trial), "Trial already ended");
        require(!_isChanceClaimed(chance), "Prize already claimed for this chance");

        // Validate beaconTimestamp is in acceptable range
        require(_beaconTimestamp >= chance.targetTimestamp, "Beacon timestamp too early");
        require(
            _beaconTimestamp <= chance.targetTimestamp + MAX_MISSED_SLOTS * SECONDS_PER_SLOT,
            "Beacon timestamp too late"
        );

        // Query oracle directly with the provided timestamp (no search loop)
        bytes32 canonicalRoot = randomnessOracle.getRandomness(_beaconTimestamp);
        uint128 rootHigh = uint128(uint256(canonicalRoot) >> 128);
        uint128 rootLow = uint128(uint256(canonicalRoot));

        uint256[5] memory actualSignals =
            [uint256(rootHigh), uint256(rootLow), chance.commitment, trial.difficulty, chance.numChances];

        require(zkVerifier.verifyProof(_pA, _pB, _pC, actualSignals), "Invalid ZK Proof");

        // Settlement
        trial.status &= ~TRIAL_ACTIVE;
        chance.status |= CHANCE_CLAIMED;

        IERC721(trial.nftContract).transferFrom(address(this), msg.sender, trial.nftId);

        uint256 charityDonation;
        uint256 challengerShare;
        if (trial.ethPool > 0) {
            uint256 pot = trial.ethPool;
            trial.ethPool = 0;
            (charityDonation, challengerShare) = _donateToCharity(pot, trial.challenger, trial.charityBps);
        }
        if (trial.depositEscrow > 0) {
            uint256 depositToReturn = trial.depositEscrow;
            trial.depositEscrow = 0;
            (bool refundOk,) = trial.challenger.call{value: depositToReturn}("");
            require(refundOk, "Deposit refund failed");
        }

        emit Victor(
            chance.trialId, _chanceId, msg.sender, trial.appraisal, trial.difficulty, charityDonation, challengerShare
        );
    }

    function cowardice(
        uint256 _trialId
    ) public nonReentrant {
        Trial storage trial = trials[_trialId];
        require(msg.sender == trial.challenger, "Not the challenger");
        require(_isTrialActive(trial), "Trial not active");

        trial.status &= ~TRIAL_ACTIVE;
        trial.status |= TRIAL_CANCELLED;

        IERC721(trial.nftContract).transferFrom(address(this), trial.challenger, trial.nftId);
        if (trial.depositEscrow > 0) {
            uint256 forfeitedDeposit = trial.depositEscrow;
            trial.depositEscrow = 0;
            (bool donationOk,) = charity.donations.call{value: forfeitedDeposit}("");
            require(donationOk, "Deposit donation failed");
        }

        emit Surrender(_trialId);
    }

    function perseverance(
        uint256[] calldata _chanceIds
    ) public nonReentrant {
        for (uint256 i = 0; i < _chanceIds.length; i++) {
            uint256 chanceId = _chanceIds[i];
            Chance storage chance = chances[chanceId];
            Trial storage trial = trials[chance.trialId];

            if (chance.owner != msg.sender) continue;
            if (!_isTrialCancelled(trial)) continue;
            if (_isChanceClaimed(chance)) continue;
            if (_isChanceRefunded(chance)) continue;

            chance.status |= CHANCE_REFUNDED;

            uint256 totalRefundAmount = chance.numChances * FIXED_TICKET_PRICE;

            (bool success,) = payable(msg.sender).call{value: totalRefundAmount}("");
            if (!success) continue;

            emit Justice(chance.trialId, chanceId, msg.sender, totalRefundAmount, chance.numChances);
        }
    }

    // -------------------------------------------------------------------------
    // 9. ERC721 Receiver
    // -------------------------------------------------------------------------
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // -------------------------------------------------------------------------
    // 10. Internal Helpers
    // -------------------------------------------------------------------------

    function _isTrialActive(
        Trial storage trial
    ) internal view returns (bool) {
        return (trial.status & TRIAL_ACTIVE) != 0;
    }

    function _isTrialCancelled(
        Trial storage trial
    ) internal view returns (bool) {
        return (trial.status & TRIAL_CANCELLED) != 0;
    }

    function _isChanceClaimed(
        Chance storage chance
    ) internal view returns (bool) {
        return (chance.status & CHANCE_CLAIMED) != 0;
    }

    function _isChanceRefunded(
        Chance storage chance
    ) internal view returns (bool) {
        return (chance.status & CHANCE_REFUNDED) != 0;
    }

    function _donateToCharity(
        uint256 pot,
        address payable challenger,
        uint256 lockedBps
    ) private returns (uint256 donation, uint256 remainder) {
        donation = (pot * lockedBps) / 10_000;
        remainder = pot - donation;

        if (donation > 0) {
            (bool donationOk,) = charity.donations.call{value: donation}("");
            require(donationOk, "Donation failed");
        }

        if (remainder > 0) {
            (bool challengerOk,) = challenger.call{value: remainder}("");
            require(challengerOk, "Challenger transfer failed");
        }
    }
}
