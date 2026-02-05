// src/services/ColasseumIndexer.js

import { EventIndexer } from '@monygroupcorp/micro-web3';
import { ethers } from 'ethers';

/**
 * ColasseumIndexer - Event indexing service for Colasseum dApp.
 *
 * Provides high-level methods for:
 * - Getting prize winners
 * - Finding refundable chances for users
 * - Activity history
 * - Leaderboards
 */
class ColasseumIndexer {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.indexer = null;
    this.initialized = false;
    this.config = null;
  }

  /**
   * Initialize the indexer with contract config.
   * @param {Object} config - Contract configuration from contracts.json
   */
  async initialize(config) {
    this.config = config;

    try {
      // Detect chain restart / redeployment by comparing contract address
      this._clearStaleDataIfRedeployed(config);

      // Create provider
      const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);

      // Create EventIndexer instance
      this.indexer = new EventIndexer(this.eventBus);

      try {
        await this._initializeIndexer(config, provider);
      } catch (error) {
        // If schema mismatch, clear IndexedDB and retry
        if (error.message?.includes('object stores was not found') ||
            error.message?.includes('NotFoundError')) {
          console.warn('[ColasseumIndexer] Schema mismatch detected, clearing database and retrying...');
          await this._clearIndexedDB(config.chainId);
          await this._initializeIndexer(config, provider);
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('[ColasseumIndexer] Initialization failed:', error);
      // Don't throw - allow app to continue without indexer
      this.initialized = false;
    }
  }

  /**
   * Detect chain restart by comparing the stored contract address with the
   * current config. On a fresh deploy the address changes, so we wipe stale
   * IndexedDB events and localStorage bottle state.
   */
  _clearStaleDataIfRedeployed(config) {
    const FINGERPRINT_KEY = 'miladycola_deploy_address';
    try {
      const currentAddress = config.contracts?.colasseum?.address;
      const storedAddress = localStorage.getItem(FINGERPRINT_KEY);

      if (storedAddress !== currentAddress) {
        console.log('[ColasseumIndexer] Contract address changed — clearing stale caches');

        // Clear IndexedDB (fire-and-forget, _initializeIndexer will wait if needed)
        this._clearIndexedDB(config.chainId);

        // Clear stale localStorage keys from previous deployment
        const prefixes = ['miladycola_passphrase_', 'miladycola_reveal_seen_', 'miladycola_win_result_'];
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (prefixes.some(p => key.startsWith(p))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        if (keysToRemove.length > 0) {
          console.log(`[ColasseumIndexer] Cleared ${keysToRemove.length} stale localStorage entries`);
        }
      }

      // Store current address for next comparison
      if (currentAddress) {
        localStorage.setItem(FINGERPRINT_KEY, currentAddress);
      }
    } catch (e) {
      console.warn('[ColasseumIndexer] Failed to check deploy fingerprint:', e);
    }
  }

  async _clearIndexedDB(chainId) {
    // Check if IndexedDB is available
    if (typeof indexedDB === 'undefined') {
      console.warn('[ColasseumIndexer] IndexedDB not available');
      return;
    }

    const dbName = `colasseum-${chainId}`;
    return new Promise((resolve) => {
      try {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => {
          console.log('[ColasseumIndexer] Database cleared');
          resolve();
        };
        request.onerror = () => {
          console.warn('[ColasseumIndexer] Failed to clear database:', request.error);
          resolve(); // Don't block on error
        };
        request.onblocked = () => {
          console.warn('[ColasseumIndexer] Database delete blocked, continuing...');
          resolve();
        };
      } catch (err) {
        console.warn('[ColasseumIndexer] Error clearing database:', err);
        resolve();
      }
    });
  }

  async _initializeIndexer(config, provider) {
    // Get deploy block from config, or detect it
    let deployBlock = config.deployBlock;
    if (deployBlock !== undefined && deployBlock !== null) {
      console.log(`[ColasseumIndexer] Using deployBlock from config: ${deployBlock}`);
    } else {
      // For forked chains, use current block minus a reasonable buffer
      // This ensures we capture events from the dev session
      const currentBlock = await provider.getBlockNumber();
      // Look back 50000 blocks (~7 days on mainnet, plenty for dev sessions)
      deployBlock = Math.max(0, currentBlock - 50000);
      console.log(`[ColasseumIndexer] No deployBlock in config, using ${deployBlock} (currentBlock: ${currentBlock})`);
    }

    await this.indexer.initialize({
      contract: {
        address: config.contracts.colasseum.address,
        abi: config.contracts.colasseum.abi,
        deployBlock
      },

      provider,

      // Define entities for domain-level queries
      entities: {
        Trial: {
          source: 'Gauntlet',
          key: 'trialId',
          status: {
            won: (trial, events) => events.has('Victor', { trialId: trial.trialId }),
            cancelled: (trial, events) => events.has('Surrender', { trialId: trial.trialId }),
            default: 'active'
          }
        },

        Chance: {
          source: 'ChallengeAccepted',
          key: 'chanceId',
          relations: {
            trial: { entity: 'Trial', foreignKey: 'trialId' }
          },
          status: {
            claimed: (chance, events) => events.has('Victor', { chanceId: chance.chanceId }),
            refunded: (chance, events) => events.has('Justice', { chanceId: chance.chanceId }),
            default: 'pending'
          }
        }
      },

      persistence: {
        type: 'indexeddb',
        dbName: `colasseum-${config.chainId}`,
        version: 4  // Bumped to force resync with larger lookback
      },

      sync: {
        batchSize: 2000,
        confirmations: 0,  // No confirmations needed for local dev
        realTimeEnabled: true,
        pollInterval: 3000  // Poll every 3 seconds for local dev
      }
    });

    this.initialized = true;
    console.log('[ColasseumIndexer] Initialized');

    // Emit our own ready event (after initialized flag is set)
    this.eventBus.emit('colasseum:indexerReady', {});
  }

  // =========================================================================
  // HIGH-LEVEL API
  // =========================================================================

  /**
   * Get all prize winners.
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results (default: 50)
   * @param {number} options.offset - Skip N results (default: 0)
   * @returns {Promise<{winners: Array, total: number, hasMore: boolean}>}
   */
  async getWinners(options = {}) {
    this._checkInitialized();

    const result = await this.indexer.events.query('Victor', {
      orderBy: 'blockNumber',
      order: 'desc',
      limit: options.limit || 50,
      offset: options.offset || 0
    });

    // Enrich with formatted data
    const winners = result.events.map(event => ({
      trialId: event.indexed.trialId || event.data.trialId,
      chanceId: event.indexed.chanceId || event.data.chanceId,
      winner: event.indexed.winner || event.data.winner,
      appraisal: event.data.appraisal,
      difficulty: event.data.difficulty,
      charityDonation: event.data.charityDonation,
      challengerShare: event.data.challengerShare,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash
    }));

    return {
      winners,
      total: result.total,
      hasMore: result.hasMore
    };
  }

  /**
   * Get refundable chances for a user.
   * These are chances where:
   * - User is the participant
   * - Trial was cancelled (Surrender event exists)
   * - User hasn't already been refunded (no Justice event)
   *
   * @param {string} userAddress - User's wallet address
   * @returns {Promise<Array>} Refundable chance events
   */
  async getRefundableChances(userAddress) {
    this._checkInitialized();

    const normalizedAddress = userAddress.toLowerCase();

    // Use the patterns API for this common query
    const refundable = await this.indexer.patterns.refundable({
      itemEvent: 'ChallengeAccepted',
      itemKey: 'chanceId',
      parentKey: 'trialId',
      cancelEvent: 'Surrender',
      claimEvent: 'Justice',  // Justice = refund already processed
      userField: 'participant',
      user: normalizedAddress
    });

    // Format results
    return refundable.map(event => ({
      chanceId: event.indexed.chanceId || event.data.chanceId,
      trialId: event.indexed.trialId || event.data.trialId,
      participant: event.indexed.participant || event.data.participant,
      numChances: event.data.numChances,
      appraisal: event.data.appraisal,
      difficulty: event.data.difficulty,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash
    }));
  }

  /**
   * Get user's activity history.
   * @param {string} userAddress - User's wallet address
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results (default: 50)
   * @returns {Promise<Array>} Activity items sorted by block number
   */
  async getUserActivity(userAddress, options = {}) {
    this._checkInitialized();

    const activity = await this.indexer.patterns.userActivity(userAddress, {
      events: ['ChallengeAccepted', 'Victor', 'Justice'],
      limit: options.limit || 50
    });

    // Enrich with activity type labels
    return activity.map(item => {
      let activityType = 'unknown';
      let description = '';

      switch (item.type) {
        case 'ChallengeAccepted':
          activityType = 'entered';
          description = `Entered trial #${item.data.trialId} with ${item.data.numChances} chances`;
          break;
        case 'Victor':
          activityType = 'won';
          description = `Won trial #${item.data.trialId}`;
          break;
        case 'Justice':
          activityType = 'refunded';
          description = `Refunded from trial #${item.data.trialId}`;
          break;
      }

      return {
        ...item,
        activityType,
        description
      };
    });
  }

  /**
   * Get winners leaderboard.
   * @param {number} limit - Max results (default: 10)
   * @returns {Promise<Array>} Leaderboard entries
   */
  async getLeaderboard(limit = 10) {
    this._checkInitialized();

    return this.indexer.patterns.leaderboard({
      event: 'Victor',
      groupBy: 'winner',
      aggregate: 'count',
      limit
    });
  }

  /**
   * Get cancelled trials.
   * @returns {Promise<Array>} List of cancelled trial IDs
   */
  async getCancelledTrials() {
    this._checkInitialized();

    const result = await this.indexer.events.query('Surrender', {
      orderBy: 'blockNumber',
      order: 'desc',
      limit: 1000
    });

    return result.events.map(event => ({
      trialId: event.indexed.trialId || event.data.trialId,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash
    }));
  }

  /**
   * Get all active trials (trials that haven't been won or cancelled).
   * @returns {Promise<Array>} Active trial events with full data
   */
  async getActiveTrials() {
    this._checkInitialized();

    // Get all created trials
    const created = await this.indexer.events.query('Gauntlet', {
      orderBy: 'blockNumber',
      order: 'desc',
      limit: 1000
    });

    // Get all ended trials (won or cancelled)
    const [won, cancelled] = await Promise.all([
      this.indexer.events.query('Victor', { limit: 1000 }),
      this.indexer.events.query('Surrender', { limit: 1000 })
    ]);

    // Build set of ended trial IDs
    const endedTrialIds = new Set();
    for (const e of won.events) {
      endedTrialIds.add(String(e.indexed?.trialId || e.data?.trialId));
    }
    for (const e of cancelled.events) {
      endedTrialIds.add(String(e.indexed?.trialId || e.data?.trialId));
    }

    // Filter to active only
    const active = created.events.filter(event => {
      const trialId = String(event.indexed?.trialId || event.data?.trialId);
      return !endedTrialIds.has(trialId);
    });

    return active.map(event => ({
      trialId: event.indexed?.trialId || event.data?.trialId,
      challenger: event.indexed?.challenger || event.data?.challenger,
      nftContract: event.data?.nftContract,
      nftId: event.data?.nftId,
      appraisal: event.data?.appraisal,
      difficulty: event.data?.difficulty,
      lore: event.data?.lore,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash
    }));
  }

  /**
   * Get user's chances.
   * @param {string} userAddress - User's wallet address
   * @param {Object} options
   * @param {boolean} options.includeClaimed - Include claimed (won) chances (default: false)
   * @returns {Promise<Array>} User's chances
   */
  async getUserChances(userAddress, options = {}) {
    this._checkInitialized();

    const normalizedAddress = userAddress.toLowerCase();

    // Get ALL ChallengeAccepted events (participant is indexed, where clause may not work)
    const allEntries = await this.indexer.events.query('ChallengeAccepted', {
      orderBy: 'blockNumber',
      order: 'desc',
      limit: 1000
    });

    // Filter to user's entries by comparing indexed participant address
    const entries = allEntries.events.filter(event => {
      const participant = (event.indexed?.participant || event.data?.participant || '').toLowerCase();
      return participant === normalizedAddress;
    });

    // Get claimed and refunded tickets
    const [claimed, refunded] = await Promise.all([
      this.indexer.events.query('Victor', { limit: 1000 }),
      this.indexer.events.query('Justice', { limit: 1000 })
    ]);

    // Build sets of processed chance IDs
    const claimedChanceIds = new Set();
    for (const e of claimed.events) {
      claimedChanceIds.add(String(e.indexed?.chanceId || e.data?.chanceId));
    }

    const refundedChanceIds = new Set();
    for (const e of refunded.events) {
      refundedChanceIds.add(String(e.indexed?.chanceId || e.data?.chanceId));
    }

    // Filter out refunded; optionally keep claimed
    const filtered = entries.filter(event => {
      const chanceId = String(event.indexed?.chanceId || event.data?.chanceId);
      if (refundedChanceIds.has(chanceId)) return false;
      if (!options.includeClaimed && claimedChanceIds.has(chanceId)) return false;
      return true;
    });

    console.log('[ColasseumIndexer] User chances:', filtered.length, '(includeClaimed:', !!options.includeClaimed, ')');

    return filtered.map(event => ({
      chanceId: event.indexed?.chanceId || event.data?.chanceId,
      trialId: event.indexed?.trialId || event.data?.trialId,
      participant: event.indexed?.participant || event.data?.participant,
      numChances: event.data?.numChances,
      appraisal: event.data?.appraisal,
      difficulty: event.data?.difficulty,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash
    }));
  }

  /**
   * Check if a specific trial has been won.
   * @param {number|string} trialId - Trial ID
   * @returns {Promise<Object|null>} Victor event or null
   */
  async getTrialWinner(trialId) {
    this._checkInitialized();

    const result = await this.indexer.events.query('Victor', {
      where: { trialId: String(trialId) },
      limit: 1
    });

    if (result.events.length === 0) return null;

    const event = result.events[0];
    return {
      trialId: event.indexed.trialId || event.data.trialId,
      chanceId: event.indexed.chanceId || event.data.chanceId,
      winner: event.indexed.winner || event.data.winner,
      appraisal: event.data.appraisal,
      difficulty: event.data.difficulty,
      charityDonation: event.data.charityDonation,
      challengerShare: event.data.challengerShare
    };
  }

  /**
   * Check if a specific trial was cancelled.
   * @param {number|string} trialId - Trial ID
   * @returns {Promise<boolean>}
   */
  async isTrialCancelled(trialId) {
    this._checkInitialized();

    const count = await this.indexer.events.count('Surrender', {
      trialId: String(trialId)
    });

    return count > 0;
  }

  // =========================================================================
  // SYNC STATUS
  // =========================================================================

  /**
   * Get sync status.
   * @returns {Object} Sync status
   */
  getSyncStatus() {
    if (!this.indexer) {
      return { state: 'not_initialized', progress: 0 };
    }
    return this.indexer.sync.getStatus();
  }

  /**
   * Subscribe to new events.
   * @param {string|string[]} eventTypes - Event type(s) to subscribe to
   * @param {Function} callback - Called with new events
   * @returns {Function} Unsubscribe function
   */
  subscribe(eventTypes, callback) {
    this._checkInitialized();
    return this.indexer.events.subscribe(eventTypes, callback);
  }

  // =========================================================================
  // INTERNAL
  // =========================================================================

  _checkInitialized() {
    if (!this.initialized) {
      throw new Error('ColasseumIndexer not initialized. Call initialize() first.');
    }
  }

  /**
   * Clean up resources.
   */
  async destroy() {
    if (this.indexer) {
      await this.indexer.destroy();
    }
    this.initialized = false;
  }
}

export default ColasseumIndexer;
