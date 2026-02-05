/**
 * DevService - Development-only utilities for Anvil chain operation
 *
 * Auto-detects dev mode by checking if oracle address is NOT the real
 * EIP-4788 beacon roots precompile. No manual configuration needed.
 *
 * Features:
 * - Time warp: Advance Anvil chain time for testing beacon randomness
 * - Seeded root derivation: Local beacon root calculation matching mock oracle
 *
 * Production behavior:
 * - If oracle is the real beacon roots address → all dev features disabled (no-op)
 * - If oracle is anything else → dev features enabled automatically
 */

import { ethers } from 'ethers';

// EIP-4788 beacon roots precompile address (same on all EVM chains)
const MAINNET_BEACON_ROOTS = '0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02'.toLowerCase();

class DevService {
  constructor(config = {}) {
    this.timeWarpUrl = config.timeWarpUrl || null;
    this.oracleSeed = config.oracleSeed || null;
    this.oracleAddress = config.oracleAddress?.toLowerCase() || null;

    // Auto-detect dev mode: enabled if oracle is NOT the real beacon roots contract
    this.enabled = this.oracleAddress && this.oracleAddress !== MAINNET_BEACON_ROOTS;

    if (this.enabled) {
      console.log('[DevService] Dev mode detected (mock oracle). Features enabled:', {
        timeWarp: !!this.timeWarpUrl,
        seededRoot: !!this.oracleSeed,
      });
    } else if (this.oracleAddress === MAINNET_BEACON_ROOTS) {
      console.log('[DevService] Production mode (real beacon oracle). Dev features disabled.');
    }
  }

  /**
   * Check if dev features are available
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Advance Anvil chain time to target timestamp
   * Required for beacon randomness to become available in dev mode
   *
   * @param {number} targetTimestamp - Unix timestamp to warp to
   * @returns {Promise<boolean>} - true if warp succeeded, false if not configured
   */
  async warpChainTime(targetTimestamp) {
    if (!this.timeWarpUrl) {
      console.warn('[DevService] Time warp not configured - skipping');
      return false;
    }

    try {
      const response = await fetch(this.timeWarpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: targetTimestamp }),
      });

      if (!response.ok) {
        console.error('[DevService] Time warp failed:', response.statusText);
        return false;
      }

      const result = await response.json();
      console.log('[DevService] Chain time warped to:', targetTimestamp, result);
      return true;
    } catch (error) {
      console.error('[DevService] Time warp error:', error);
      return false;
    }
  }

  /**
   * Sync chain time to current wall clock time
   * Useful before any operation that needs current time
   *
   * @param {number} offsetSeconds - Optional offset from current time
   * @returns {Promise<boolean>}
   */
  async syncChainTimeToNow(offsetSeconds = 0) {
    const target = Math.floor(Date.now() / 1000) + offsetSeconds;
    return this.warpChainTime(target);
  }

  /**
   * Derive beacon root locally using same formula as mock oracle
   * Formula: keccak256(abi.encodePacked(seed, timestamp))
   *
   * This allows client-side win evaluation without waiting for chain time
   *
   * @param {number} timestamp - Target timestamp
   * @returns {string|null} - Beacon root as hex string, or null if not configured
   */
  deriveSeededRoot(timestamp) {
    if (!this.oracleSeed) {
      return null;
    }

    const ts = typeof timestamp === 'number' ? timestamp : Number(timestamp);
    return ethers.utils.solidityKeccak256(
      ['bytes32', 'uint256'],
      [this.oracleSeed, ts]
    );
  }

  /**
   * Get beacon root - tries local derivation first, falls back to contract
   * This is the recommended method for dev mode
   *
   * @param {number} timestamp - Target timestamp
   * @param {Function} contractFallback - Async function to call oracle contract
   * @returns {Promise<string>} - Beacon root as hex string
   */
  async getBeaconRoot(timestamp, contractFallback) {
    // Try local derivation first (instant, no chain call needed)
    const derivedRoot = this.deriveSeededRoot(timestamp);
    if (derivedRoot) {
      console.log('[DevService] Using locally derived beacon root');
      return derivedRoot;
    }

    // Fall back to contract call
    if (contractFallback) {
      console.log('[DevService] Falling back to contract for beacon root');
      return contractFallback();
    }

    throw new Error('No beacon root available - configure oracleSeed or provide contract fallback');
  }

  /**
   * Prepare for claim: warp time if needed, then get beacon root
   * This is the main entry point for dev-mode claim preparation
   *
   * @param {number} targetTimestamp - Ticket's target timestamp
   * @param {number} safetyDelay - Safety delay in seconds (default 768)
   * @param {Function} contractFallback - Async function to get root from contract
   * @returns {Promise<string>} - Beacon root ready for proof generation
   */
  async prepareForClaim(targetTimestamp, safetyDelay = 768, contractFallback = null) {
    // Calculate when randomness becomes available
    const readyTimestamp = targetTimestamp + safetyDelay + 1;
    const now = Math.floor(Date.now() / 1000);

    // Warp chain time if needed
    if (this.timeWarpUrl && now < readyTimestamp) {
      console.log('[DevService] Warping chain time for claim...');
      await this.warpChainTime(readyTimestamp);
    }

    // Get beacon root (local derivation or contract)
    return this.getBeaconRoot(targetTimestamp, contractFallback);
  }
}

export default DevService;
