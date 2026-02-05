// src/services/NftMetadataService.js

import { ethers } from 'ethers';
import { IpfsService } from '@monygroupcorp/micro-web3';

const {
  isIpfsUri,
  resolveUrl,
  fetchJsonWithIpfsSupport,
  configureGatewayManager,
  setCustomGateway
} = IpfsService;

// Configure IPFS gateway settings for better reliability
// Use longer timeout since IPFS content can be slow to retrieve
// corsGatewaysFirst: true ensures CORS-friendly gateways are prioritized in dev
configureGatewayManager({
  timeout: 30000,  // 30 seconds (up from default 5s)
  maxRetries: 2,
  corsGatewaysFirst: true,
});

// Use w3s.link as preferred - it's CORS-friendly and reliable
setCustomGateway('https://w3s.link/ipfs/');

// Minimal ERC721 ABI for tokenURI
const ERC721_ABI = [
  'function tokenURI(uint256 tokenId) view returns (string)'
];

// Collections with locally mirrored metadata (to avoid CORS issues)
// Maps contract address (lowercase) to local path
const LOCAL_METADATA_COLLECTIONS = {
  '0x5af0d9827e0c53e4799bb226655a1de152a425a5': 'milady',      // Milady Maker
  '0xd3d9ddd0cf0a5f0bfb8f7fceae075df687eaebab': 'remilio',     // Redacted Remilio Babies
};

/**
 * NftMetadataService - Fetches and caches NFT metadata.
 *
 * Handles:
 * - tokenURI fetching from ERC721 contracts
 * - IPFS gateway conversion
 * - Base64 data URI parsing
 * - In-memory caching
 */
class NftMetadataService {
  constructor() {
    this.cache = new Map();
    this.provider = null;
    this.pendingFetches = new Map();
  }

  /**
   * Initialize with a provider.
   * @param {ethers.providers.Provider} provider
   */
  setProvider(provider) {
    this.provider = provider;
    // Note: Gateway discovery is disabled because HEAD requests cause CORS errors
    // in browser environments. The gateway manager will use w3s.link (custom) +
    // default gateways in priority order, with automatic failover on errors.
  }

  /**
   * Get cache key for contract+tokenId combo.
   */
  _getCacheKey(contractAddress, tokenId) {
    return `${contractAddress.toLowerCase()}-${tokenId}`;
  }

  /**
   * Normalize image URI - converts gateway URLs back to ipfs:// for IpfsImage gateway rotation.
   * @param {string} uri - Original URI
   * @returns {string} Normalized URI (ipfs:// format for IPFS content)
   */
  _normalizeImageUri(uri) {
    if (!uri) return null;

    // Data URI - return as-is
    if (uri.startsWith('data:')) {
      return uri;
    }

    // IPFS URI - keep as ipfs:// for IpfsImage to handle gateway rotation
    if (uri.startsWith('ipfs://')) {
      return uri;
    }

    // IPFS hash without protocol - normalize to ipfs:// format
    if (uri.startsWith('Qm') || uri.startsWith('bafy')) {
      return 'ipfs://' + uri;
    }

    // Check for HTTP gateway URLs and convert back to ipfs://
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      const ipfsPath = this._extractIpfsPath(uri);
      if (ipfsPath) {
        return 'ipfs://' + ipfsPath;
      }
      // Non-IPFS HTTP URL - return as-is
      return uri;
    }

    return uri;
  }

  /**
   * Extract IPFS CID/path from various gateway URL formats.
   * Handles both path-style and subdomain-style gateways.
   * @param {string} url - Gateway URL
   * @returns {string|null} IPFS path (CID/path) or null if not an IPFS gateway URL
   */
  _extractIpfsPath(url) {
    try {
      const parsed = new URL(url);

      // Path-style: https://gateway.com/ipfs/CID/path
      const pathMatch = parsed.pathname.match(/^\/ipfs\/(.+)$/);
      if (pathMatch) {
        return pathMatch[1];
      }

      // Subdomain-style: https://CID.ipfs.gateway.com/path
      // e.g., https://bafybeig....ipfs.dweb.link/1989.jpg
      const subdomainMatch = parsed.hostname.match(/^(bafy[a-z0-9]+|Qm[a-zA-Z0-9]+)\.ipfs\./);
      if (subdomainMatch) {
        const cid = subdomainMatch[1];
        const path = parsed.pathname === '/' ? '' : parsed.pathname;
        return cid + path;
      }

      // Not an IPFS gateway URL
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Convert IPFS URI to HTTP gateway URL.
   * Uses micro-web3 IpfsService for intelligent gateway selection.
   * @param {string} uri - Original URI (may be ipfs://, https://, or data:)
   * @returns {string} HTTP-accessible URL
   */
  _resolveUri(uri) {
    if (!uri) return null;

    // Already an HTTP URL
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      return uri;
    }

    // Data URI - return as-is
    if (uri.startsWith('data:')) {
      return uri;
    }

    // IPFS URI - use micro-web3 gateway rotation
    if (isIpfsUri(uri)) {
      return resolveUrl(uri);
    }

    // IPFS hash without protocol - add ipfs:// prefix and resolve
    if (uri.startsWith('Qm') || uri.startsWith('bafy')) {
      return resolveUrl('ipfs://' + uri);
    }

    return uri;
  }

  /**
   * Parse base64 data URI to JSON.
   * @param {string} dataUri - data:application/json;base64,... URI
   * @returns {Object|null} Parsed JSON or null
   */
  _parseDataUri(dataUri) {
    try {
      if (!dataUri.startsWith('data:')) return null;

      // Handle base64 encoded JSON
      if (dataUri.includes('base64,')) {
        const base64 = dataUri.split('base64,')[1];
        const json = atob(base64);
        return JSON.parse(json);
      }

      // Handle URL-encoded JSON
      if (dataUri.includes('application/json,')) {
        const json = decodeURIComponent(dataUri.split('application/json,')[1]);
        return JSON.parse(json);
      }

      return null;
    } catch (error) {
      console.warn('[NftMetadataService] Failed to parse data URI:', error);
      return null;
    }
  }

  /**
   * Fetch metadata with IPFS gateway rotation via micro-web3.
   * @param {string} uri - Metadata URI
   * @returns {Promise<Object|null>} Parsed metadata or null
   */
  async _fetchMetadata(uri) {
    if (!uri) return null;

    // Handle data URIs directly
    if (uri.startsWith('data:')) {
      return this._parseDataUri(uri);
    }

    try {
      // Use micro-web3's fetchJsonWithIpfsSupport for intelligent gateway rotation
      // 30s timeout since IPFS content can be slow to retrieve from the network
      const metadata = await fetchJsonWithIpfsSupport(uri, { timeout: 30000 });
      return metadata;
    } catch (error) {
      console.warn('[NftMetadataService] Failed to fetch metadata:', uri, error.message);
      return null;
    }
  }

  /**
   * Get NFT metadata for a contract+tokenId.
   * Returns cached data if available, otherwise fetches.
   *
   * @param {string} contractAddress - NFT contract address
   * @param {string|number} tokenId - Token ID
   * @returns {Promise<Object|null>} Metadata object or null
   */
  async getMetadata(contractAddress, tokenId) {
    if (!this.provider) {
      console.warn('[NftMetadataService] No provider set');
      return null;
    }

    const cacheKey = this._getCacheKey(contractAddress, tokenId);

    // Return cached data
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Deduplicate concurrent fetches for same token
    if (this.pendingFetches.has(cacheKey)) {
      return this.pendingFetches.get(cacheKey);
    }

    const fetchPromise = this._fetchMetadataForToken(contractAddress, tokenId, cacheKey);
    this.pendingFetches.set(cacheKey, fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      this.pendingFetches.delete(cacheKey);
    }
  }

  async _fetchMetadataForToken(contractAddress, tokenId, cacheKey) {
    try {
      // Check if this collection has locally mirrored metadata
      const localCollection = LOCAL_METADATA_COLLECTIONS[contractAddress.toLowerCase()];
      if (localCollection) {
        try {
          const localUrl = `/collections/${localCollection}/${tokenId}.json`;
          const response = await fetch(localUrl);
          if (response.ok) {
            const metadata = await response.json();
            console.log('[NftMetadataService] Using local metadata for', localCollection, tokenId);

            // Normalize image URI
            if (metadata.image) {
              metadata.image = this._normalizeImageUri(metadata.image);
            }
            if (metadata.image_url && !metadata.image) {
              metadata.image = this._normalizeImageUri(metadata.image_url);
            }

            // Cache the result
            this.cache.set(cacheKey, metadata);
            return metadata;
          }
        } catch (localErr) {
          console.log('[NftMetadataService] Local metadata not available, falling back to contract:', localErr.message);
        }
      }

      // Fallback: fetch from contract tokenURI
      const contract = new ethers.Contract(contractAddress, ERC721_ABI, this.provider);
      const tokenUri = await contract.tokenURI(tokenId);

      if (!tokenUri) {
        console.warn('[NftMetadataService] No tokenURI for', contractAddress, tokenId);
        return null;
      }

      // Fetch and parse metadata
      const metadata = await this._fetchMetadata(tokenUri);

      if (metadata) {
        // Normalize image URI - keep IPFS URIs intact for IpfsImage component to handle
        // Only resolve non-IPFS URLs
        if (metadata.image) {
          metadata.image = this._normalizeImageUri(metadata.image);
        }
        if (metadata.image_url && !metadata.image) {
          metadata.image = this._normalizeImageUri(metadata.image_url);
        }

        // Cache the result
        this.cache.set(cacheKey, metadata);
      }

      return metadata;
    } catch (error) {
      console.warn('[NftMetadataService] Failed to get metadata:', contractAddress, tokenId, error.message);
      return null;
    }
  }

  /**
   * Prefetch metadata for multiple NFTs in parallel.
   * Useful for loading marquee data in background.
   *
   * @param {Array<{contractAddress: string, tokenId: string|number}>} tokens
   * @returns {Promise<Map<string, Object>>} Map of cacheKey -> metadata
   */
  async prefetchBatch(tokens) {
    const results = new Map();

    await Promise.all(
      tokens.map(async ({ contractAddress, tokenId }) => {
        const metadata = await this.getMetadata(contractAddress, tokenId);
        if (metadata) {
          const key = this._getCacheKey(contractAddress, tokenId);
          results.set(key, metadata);
        }
      })
    );

    return results;
  }

  /**
   * Clear the cache.
   */
  clearCache() {
    this.cache.clear();
  }
}

// Export singleton instance
const nftMetadataService = new NftMetadataService();
export default nftMetadataService;
