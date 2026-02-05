import { ethers } from 'ethers';

// Status bit constants (match Colasseum.sol)
const TRIAL_ACTIVE = 1;
const TRIAL_CANCELLED = 2;
const CHANCE_CLAIMED = 1;
const CHANCE_REFUNDED = 2;

const isTrialActive = (status) => (Number(status) & TRIAL_ACTIVE) !== 0;
const isTrialCancelled = (status) => (Number(status) & TRIAL_CANCELLED) !== 0;
const isChanceClaimed = (status) => (Number(status) & CHANCE_CLAIMED) !== 0;
const isChanceRefunded = (status) => (Number(status) & CHANCE_REFUNDED) !== 0;

/**
 * ContractService - handles all contract interactions
 *
 * Provides methods for reading and writing to the Colasseum contract.
 * Uses eventBus to notify UI of state changes.
 */
class ContractService {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.provider = null;
    this.signer = null;
    this.contracts = null;
    this.config = null;
    this.initialized = false;
  }

  /**
   * Initialize the service with contract config
   * @param {Object} config - Contract configuration from generated/contracts.json
   */
  async initialize(config) {
    this.config = config;

    // Connect to provider
    this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);

    // Initialize contract instances (read-only until signer is set)
    // Note: nft contract is optional (only present in local dev config)
    this.contracts = {
      colasseum: new ethers.Contract(
        config.contracts.colasseum.address,
        config.contracts.colasseum.abi,
        this.provider
      ),
      oracle: new ethers.Contract(
        config.contracts.oracle.address,
        config.contracts.oracle.abi,
        this.provider
      ),
    };

    // Dev NFT contract is optional (only for local testing)
    if (config.contracts.nft) {
      this.contracts.nft = new ethers.Contract(
        config.contracts.nft.address,
        config.contracts.nft.abi,
        this.provider
      );
    }

    this.initialized = true;
    console.log('[ContractService] Initialized with colasseum at:', config.contracts.colasseum.address);
  }

  /**
   * Set the signer for write operations
   * @param {ethers.Signer} signer
   */
  setSigner(signer) {
    this.signer = signer;

    // Reconnect contracts with signer for write operations
    if (this.contracts && this.config) {
      this.contracts.colasseum = new ethers.Contract(
        this.config.contracts.colasseum.address,
        this.config.contracts.colasseum.abi,
        signer
      );
      // Dev NFT contract is optional
      if (this.config.contracts.nft) {
        this.contracts.nft = new ethers.Contract(
          this.config.contracts.nft.address,
          this.config.contracts.nft.abi,
          signer
        );
      }
    }
  }

  /**
   * Clear signer (on disconnect)
   */
  clearSigner() {
    this.signer = null;

    // Reconnect contracts with provider only
    if (this.contracts && this.config) {
      this.contracts.colasseum = new ethers.Contract(
        this.config.contracts.colasseum.address,
        this.config.contracts.colasseum.abi,
        this.provider
      );
      // Dev NFT contract is optional
      if (this.config.contracts.nft) {
        this.contracts.nft = new ethers.Contract(
          this.config.contracts.nft.address,
          this.config.contracts.nft.abi,
          this.provider
        );
      }
    }
  }

  // =========================================================================
  // READ METHODS
  // =========================================================================

  /**
   * Get trial details by ID (fetches current on-chain state)
   * @param {number} trialId
   * @returns {Promise<Object>}
   */
  async getTrial(trialId) {
    if (!this.initialized) throw new Error('ContractService not initialized');

    const trial = await this.contracts.colasseum.trials(trialId);
    const lore = await this.contracts.colasseum.lore(trialId);
    const FIXED_CHANCE_PRICE = ethers.BigNumber.from('1000000000'); // 1 gwei

    return {
      id: trialId,
      creator: trial.challenger,
      nftContract: trial.nftContract,
      nftId: trial.nftId.toNumber(),
      chancePrice: ethers.utils.formatEther(FIXED_CHANCE_PRICE),
      difficulty: trial.difficulty.toString(),
      ethPool: ethers.utils.formatEther(trial.ethPool),
      active: isTrialActive(trial.status),
      cancelled: isTrialCancelled(trial.status),
      creationTime: Number(trial.creationTime),
      lore,
    };
  }

  /**
   * Get multiple trials by IDs
   * @param {number[]} trialIds
   * @returns {Promise<Object[]>}
   */
  async getTrials(trialIds) {
    return Promise.all(trialIds.map(id => this.getTrial(id)));
  }

  /**
   * Get chance details by ID (fetches current on-chain state)
   * @param {number} chanceId
   * @returns {Promise<Object>}
   */
  async getChance(chanceId) {
    if (!this.initialized) throw new Error('ContractService not initialized');

    const chance = await this.contracts.colasseum.chances(chanceId);

    return {
      id: chanceId,
      owner: chance.owner,
      trialId: chance.trialId.toNumber(),
      commitment: chance.commitment.toString(),
      targetTimestamp: chance.targetTimestamp.toNumber(),
      numChances: chance.numChances.toNumber(),
      claimed: isChanceClaimed(chance.status),
      refunded: isChanceRefunded(chance.status),
    };
  }

  /**
   * Get multiple chances by IDs
   * @param {number[]} chanceIds
   * @returns {Promise<Object[]>}
   */
  async getChances(chanceIds) {
    return Promise.all(chanceIds.map(id => this.getChance(id)));
  }

  /**
   * Check if randomness is available for a timestamp
   * @param {number} targetTimestamp
   * @returns {Promise<boolean>}
   */
  async isRandomnessAvailable(targetTimestamp) {
    if (!this.initialized) throw new Error('ContractService not initialized');
    return this.contracts.oracle.isRandomnessAvailable(targetTimestamp);
  }

  /**
   * Get beacon root (randomness) for a timestamp
   * @param {number} targetTimestamp
   * @returns {Promise<string>} Beacon root as hex string
   */
  async getBeaconRoot(targetTimestamp) {
    if (!this.initialized) throw new Error('ContractService not initialized');
    const root = await this.contracts.oracle.getRandomness(targetTimestamp);
    return root;
  }

  /**
   * Find the canonical beacon timestamp by searching actual blocks.
   *
   * This searches by block number to find real block timestamps, rather than
   * guessing at 12-second intervals. The contract validates that the provided
   * timestamp is within [targetTimestamp, targetTimestamp + 144].
   *
   * Algorithm:
   * 1. Start from the latest block
   * 2. Binary search backward to find the first block with timestamp >= targetTimestamp
   * 3. Verify the timestamp is within the contract's allowed window
   * 4. Verify we can actually get a beacon root for that timestamp
   *
   * @param {number} targetTimestamp - The original target timestamp from the ticket
   * @returns {Promise<{timestamp: number, root: string}>} The canonical timestamp and beacon root
   * @throws {Error} If no valid block found within the allowed window
   */
  async findCanonicalBeaconRoot(targetTimestamp) {
    if (!this.initialized) throw new Error('ContractService not initialized');

    const MAX_WINDOW = 144; // 12 slots * 12 seconds
    const maxAllowedTimestamp = targetTimestamp + MAX_WINDOW;

    console.log(`[ContractService] Searching for beacon root. Target: ${targetTimestamp}, max allowed: ${maxAllowedTimestamp}`);

    // Get the latest block
    const latestBlock = await this.provider.getBlock('latest');
    console.log(`[ContractService] Latest block: ${latestBlock.number}, timestamp: ${latestBlock.timestamp}`);

    // The beacon timestamp must be finalized (past safety delay), so we need a block
    // that has timestamp >= targetTimestamp AND that timestamp is old enough
    // However, the *claim* is what needs to be after safety delay, not necessarily
    // the beacon block itself. We just need any block with timestamp in the valid range.

    // Binary search to find the first block with timestamp >= targetTimestamp
    let low = latestBlock.number - 10000; // Search back ~1 day worth of blocks
    let high = latestBlock.number;
    let candidateBlock = null;

    // First, check if latest block is even past the target
    if (latestBlock.timestamp < targetTimestamp) {
      throw new Error(`Target timestamp ${targetTimestamp} is in the future (current: ${latestBlock.timestamp})`);
    }

    // Binary search for the first block with timestamp >= targetTimestamp
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const block = await this.provider.getBlock(mid);

      if (!block) {
        low = mid + 1;
        continue;
      }

      if (block.timestamp >= targetTimestamp) {
        candidateBlock = block;
        high = mid - 1; // Keep searching for earlier block
      } else {
        low = mid + 1;
      }
    }

    if (!candidateBlock) {
      throw new Error(`Could not find any block with timestamp >= ${targetTimestamp}`);
    }

    console.log(`[ContractService] Found candidate block: ${candidateBlock.number}, timestamp: ${candidateBlock.timestamp}`);

    // Verify the timestamp is within the allowed window
    if (candidateBlock.timestamp > maxAllowedTimestamp) {
      throw new Error(`First valid block (${candidateBlock.timestamp}) is beyond allowed window (max: ${maxAllowedTimestamp})`);
    }

    // Try to get the beacon root for this timestamp
    try {
      const root = await this.contracts.oracle.getRandomness(candidateBlock.timestamp);
      if (root && root !== '0x' + '0'.repeat(64)) {
        console.log(`[ContractService] Found canonical beacon root at block ${candidateBlock.number}, timestamp ${candidateBlock.timestamp}`);
        return { timestamp: candidateBlock.timestamp, root };
      }
    } catch (error) {
      console.log(`[ContractService] Block ${candidateBlock.number} timestamp ${candidateBlock.timestamp} failed oracle query:`, error.message);
    }

    // If the exact candidate failed, search forward through subsequent blocks within the window
    let blockNum = candidateBlock.number + 1;
    const maxBlocksToCheck = 20;

    for (let i = 0; i < maxBlocksToCheck; i++) {
      const block = await this.provider.getBlock(blockNum + i);
      if (!block || block.timestamp > maxAllowedTimestamp) {
        break;
      }

      try {
        const root = await this.contracts.oracle.getRandomness(block.timestamp);
        if (root && root !== '0x' + '0'.repeat(64)) {
          console.log(`[ContractService] Found canonical beacon root at block ${block.number}, timestamp ${block.timestamp}`);
          return { timestamp: block.timestamp, root };
        }
      } catch (error) {
        console.log(`[ContractService] Block ${block.number} failed, trying next...`);
      }
    }

    throw new Error(`No valid beacon root found within allowed window [${targetTimestamp}, ${maxAllowedTimestamp}]`);
  }

  /**
   * Get NFT token URI
   * @param {string} nftContract
   * @param {number} tokenId
   * @returns {Promise<string>}
   */
  async getNftTokenUri(nftContract, tokenId) {
    const nft = new ethers.Contract(
      nftContract,
      ['function tokenURI(uint256 tokenId) view returns (string)'],
      this.provider
    );
    return nft.tokenURI(tokenId);
  }

  /**
   * Get NFT owner
   * @param {string} nftContract
   * @param {number} tokenId
   * @returns {Promise<string>}
   */
  async getNftOwner(nftContract, tokenId) {
    const nft = new ethers.Contract(
      nftContract,
      ['function ownerOf(uint256 tokenId) view returns (address)'],
      this.provider
    );
    return nft.ownerOf(tokenId);
  }

  /**
   * Check if colasseum is approved for NFT
   * @param {string} nftContract
   * @param {number} tokenId
   * @returns {Promise<boolean>}
   */
  async isNftApproved(nftContract, tokenId) {
    const nft = new ethers.Contract(
      nftContract,
      ['function getApproved(uint256 tokenId) view returns (address)'],
      this.provider
    );
    const approved = await nft.getApproved(tokenId);
    return approved.toLowerCase() === this.config.contracts.colasseum.address.toLowerCase();
  }

  // =========================================================================
  // WRITE METHODS
  // =========================================================================

  /**
   * Approve NFT for colasseum contract
   * @param {string} nftContract
   * @param {number} tokenId
   * @returns {Promise<ethers.ContractReceipt>}
   */
  async approveNft(nftContract, tokenId) {
    if (!this.signer) throw new Error('No signer connected');

    const nft = new ethers.Contract(
      nftContract,
      ['function approve(address to, uint256 tokenId)'],
      this.signer
    );

    const tx = await nft.approve(this.config.contracts.colasseum.address, tokenId);
    return tx.wait();
  }

  /**
   * Create a new trial (challenge)
   * @param {string} nftContract
   * @param {number} nftId
   * @param {string} appraisalEth - Appraisal value in ETH (string)
   * @param {string} lore - Optional description
   * @returns {Promise<{receipt: ethers.ContractReceipt, trialId: number}>}
   */
  async challenge(nftContract, nftId, appraisalEth, lore = '') {
    if (!this.signer) throw new Error('No signer connected');

    const appraisal = ethers.utils.parseEther(appraisalEth);
    const deposit = appraisal.mul(5).div(100); // 5% deposit

    const tx = await this.contracts.colasseum.challenge(
      nftContract,
      nftId,
      appraisal,
      lore,
      { value: deposit }
    );

    const receipt = await tx.wait();

    // Parse Gauntlet event to get trialId
    const event = receipt.events?.find(e => e.event === 'Gauntlet');
    const trialId = event?.args?.trialId?.toNumber();

    this.eventBus.emit('contract:gauntlet', { trialId, receipt });

    return { receipt, trialId };
  }

  /**
   * Enter a trial (buy chance/bottle)
   * @param {number} trialId
   * @param {string} commitment - Poseidon hash of passphrase + owner
   * @param {number} targetTimestamp
   * @param {number} numChances
   * @returns {Promise<{receipt: ethers.ContractReceipt, chanceId: number}>}
   */
  async valor(trialId, commitment, targetTimestamp, numChances) {
    if (!this.signer) throw new Error('No signer connected');

    // Fixed chance price from contract: 1 gwei per chance
    const FIXED_CHANCE_PRICE = ethers.BigNumber.from('1000000000'); // 1 gwei in wei
    const numChancesBN = ethers.BigNumber.from(numChances);
    const totalPrice = FIXED_CHANCE_PRICE.mul(numChancesBN);

    // Debug: Check contract state before transaction
    try {
      const trial = await this.contracts.colasseum.trials(trialId);
      const trialState = { active: isTrialActive(trial.status), creator: trial.challenger };
      const signerAddress = await this.signer.getAddress();
      const signerNetwork = await this.signer.provider.getNetwork();
      const signerBalance = await this.signer.getBalance();
      const signerNonce = await this.signer.getTransactionCount();

      console.log('[ContractService] valor debug:', {
        trialId,
        commitment,
        targetTimestamp,
        numChances,
        value: totalPrice.toString(),
        colasseumAddress: this.contracts.colasseum.address,
        signerAddress,
        signerChainId: signerNetwork.chainId,
        signerBalance: signerBalance.toString(),
        signerNonce,
        trialActive: trialState.active,
        trialCreator: trialState.creator,
      });

      // Also check via the read-only provider to compare
      const providerNetwork = await this.provider.getNetwork();
      const providerBalance = await this.provider.getBalance(signerAddress);
      console.log('[ContractService] Provider comparison:', {
        providerChainId: providerNetwork.chainId,
        providerBalance: providerBalance.toString(),
        chainIdMatch: signerNetwork.chainId === providerNetwork.chainId,
        balanceMatch: signerBalance.toString() === providerBalance.toString(),
      });
    } catch (debugError) {
      console.error('[ContractService] Debug read failed:', debugError);
    }

    // Try to estimate gas first to get better error messages
    try {
      await this.contracts.colasseum.estimateGas.valor(
        trialId,
        commitment,
        targetTimestamp,
        numChances,
        { value: totalPrice }
      );
    } catch (estimateError) {
      console.error('[ContractService] Gas estimation failed:', estimateError);
      // Try to decode the revert reason
      if (estimateError.error?.data?.message) {
        throw new Error(estimateError.error.data.message);
      }
      if (estimateError.reason) {
        throw new Error(estimateError.reason);
      }
      throw estimateError;
    }

    let tx;
    try {
      tx = await this.contracts.colasseum.valor(
        trialId,
        commitment,
        targetTimestamp,
        numChances,
        { value: totalPrice }
      );
    } catch (sendError) {
      console.error('[ContractService] Transaction send failed:', sendError);
      // Try to extract useful error info
      const errorData = sendError.error?.data || sendError.data;
      if (errorData) {
        console.error('[ContractService] Error data:', errorData);
      }
      // Check for common error patterns
      if (sendError.code === -32603) {
        // Internal JSON-RPC error - try to get more details
        const innerError = sendError.error?.message || sendError.message;
        console.error('[ContractService] Inner error:', innerError);
        throw new Error(`Transaction failed: ${innerError}`);
      }
      throw sendError;
    }

    const receipt = await tx.wait();

    // Parse ChallengeAccepted event to get chanceId
    const event = receipt.events?.find(e => e.event === 'ChallengeAccepted');
    const chanceId = event?.args?.chanceId?.toNumber();

    this.eventBus.emit('contract:challengeAccepted', { trialId, chanceId, receipt });

    return { receipt, chanceId };
  }

  /**
   * Claim prize with ZK proof (victory)
   * @param {number} chanceId
   * @param {number} beaconTimestamp - The actual block timestamp used for beacon root lookup
   * @param {Object} proof - ZK proof { pA, pB, pC }
   * @returns {Promise<ethers.ContractReceipt>}
   */
  async victory(chanceId, beaconTimestamp, proof) {
    if (!this.signer) throw new Error('No signer connected');

    const tx = await this.contracts.colasseum.victory(
      chanceId,
      beaconTimestamp,
      proof.pA,
      proof.pB,
      proof.pC
    );

    const receipt = await tx.wait();

    this.eventBus.emit('contract:victor', { chanceId, receipt });

    return receipt;
  }

  /**
   * Cancel a trial (only creator) - cowardice
   * @param {number} trialId
   * @returns {Promise<ethers.ContractReceipt>}
   */
  async cowardice(trialId) {
    if (!this.signer) throw new Error('No signer connected');

    const tx = await this.contracts.colasseum.cowardice(trialId);
    const receipt = await tx.wait();

    this.eventBus.emit('contract:surrender', { trialId, receipt });

    return receipt;
  }

  /**
   * Refund multiple chances in one transaction (if trial was cancelled) - perseverance
   * @param {number[]} chanceIds - Array of chance IDs to refund
   * @returns {Promise<ethers.ContractReceipt>}
   */
  async perseverance(chanceIds) {
    if (!this.signer) throw new Error('No signer connected');

    const tx = await this.contracts.colasseum.perseverance(chanceIds);
    const receipt = await tx.wait();

    this.eventBus.emit('contract:justice', { chanceIds, receipt });

    return receipt;
  }

  // =========================================================================
  // UTILITY METHODS
  // =========================================================================

  /**
   * Get the colasseum contract address
   * @returns {string}
   */
  getColasseumAddress() {
    return this.config?.contracts?.colasseum?.address;
  }

  /**
   * Get the NFT contract address (mock for testing)
   * @returns {string}
   */
  getNftAddress() {
    return this.config?.contracts?.nft?.address;
  }

  /**
   * Format a trial for UI consumption
   * @param {Object} trial
   * @returns {Object}
   */
  formatTrialForUI(trial) {
    return {
      id: trial.id,
      title: `Challenge #${trial.id}`,
      nftContract: trial.nftContract,
      tokenId: trial.nftId,
      appraisalEth: ethers.utils.formatEther(
        ethers.BigNumber.from(trial.difficulty)
          .mul(ethers.utils.parseEther('0.000000001'))
          .div(ethers.BigNumber.from('21888242871839275222246405745257275088548364400416034343698204186575808495617'))
      ),
      ethPool: trial.ethPool,
      active: trial.active,
      lore: trial.lore || '',
      creationTime: trial.creationTime,
    };
  }
}

export default ContractService;
