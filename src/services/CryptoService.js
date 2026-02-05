/**
 * CryptoService - ZK cryptography utilities for Colasseum
 * Handles Poseidon hashing, commitment generation, win evaluation, and proof generation
 */

import { ethers } from 'ethers';

// BN128 field prime (same as contracts)
const MAX_HASH = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

class CryptoService {
  constructor() {
    this.poseidon = null;
    this.buildPoseidon = null;
    this.wasmBuffer = null;
    this.zkeyBuffer = null;
    this.assetsLoaded = false;
  }

  /**
   * Initialize Poseidon hasher
   * Uses ESM.sh CDN to avoid Node.js polyfill issues in browser
   */
  async ensurePoseidon() {
    if (!this.poseidon) {
      // Dynamic import from ESM.sh to avoid Node.js polyfill issues
      if (!this.buildPoseidon) {
        const circomlibjs = await import('https://esm.sh/circomlibjs@0.1.7');
        this.buildPoseidon = circomlibjs.buildPoseidon;
      }
      this.poseidon = await this.buildPoseidon();
    }
    return this.poseidon;
  }

  /**
   * Pre-fetch circuit assets for proof generation
   */
  async loadCircuitAssets() {
    if (this.assetsLoaded) return;

    try {
      const wasmUrl = document.getElementById('url-wasm')?.value || '/challenge.wasm';
      const zkeyUrl = document.getElementById('url-zkey')?.value || '/challenge_final.zkey';

      console.log('[CryptoService] Pre-fetching circuit assets...');
      const [wasmResp, zkeyResp] = await Promise.all([
        fetch(wasmUrl),
        fetch(zkeyUrl)
      ]);

      if (!wasmResp.ok || !zkeyResp.ok) {
        throw new Error('Failed to fetch circuit assets');
      }

      this.wasmBuffer = await wasmResp.arrayBuffer();
      this.zkeyBuffer = await zkeyResp.arrayBuffer();
      this.assetsLoaded = true;
      console.log('[CryptoService] Circuit assets loaded');
    } catch (error) {
      console.error('[CryptoService] Failed to load circuit assets:', error);
      throw error;
    }
  }

  /**
   * Convert a passphrase string to a field element
   * Uses keccak256 hash reduced to BN128 field
   */
  passphraseToField(passphrase) {
    const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(passphrase));
    return BigInt(hash);
  }

  /**
   * Convert an address to a field element
   */
  addressToField(address) {
    return BigInt(address);
  }

  /**
   * Generate a Poseidon commitment from passphrase and owner address
   * commitment = Poseidon(passphrase_field, owner_field)
   */
  async generateCommitment(passphrase, ownerAddress) {
    const poseidon = await this.ensurePoseidon();
    const passphraseField = this.passphraseToField(passphrase);
    const ownerField = this.addressToField(ownerAddress);

    const commitmentBytes = poseidon([passphraseField, ownerField]);
    const commitment = poseidon.F.toObject(commitmentBytes);

    return commitment.toString();
  }

  /**
   * Verify a commitment matches expected passphrase and owner
   */
  async verifyCommitment(passphrase, ownerAddress, expectedCommitment) {
    const commitment = await this.generateCommitment(passphrase, ownerAddress);
    return commitment === expectedCommitment.toString();
  }

  /**
   * Evaluate win condition using beacon randomness
   * Returns { isWinner, randomnessHash }
   */
  async evaluateWinCondition(passphrase, beaconRoot, difficulty, numChances) {
    const poseidon = await this.ensurePoseidon();
    const passphraseField = this.passphraseToField(passphrase);

    // Split beacon root into high/low 128-bit parts
    const rootBigInt = BigInt(beaconRoot);
    const rootHigh = rootBigInt >> 128n;
    const rootLow = rootBigInt & ((1n << 128n) - 1n);

    // randomnessHash = Poseidon(passphrase, rootHigh, rootLow)
    const randomnessField = poseidon([passphraseField, rootHigh, rootLow]);
    const randomnessHash = poseidon.F.toObject(randomnessField);

    // Win condition: randomnessHash < (difficulty * numChances)
    const difficultyBigInt = BigInt(difficulty.toString());
    const chancesBigInt = BigInt(numChances.toString());
    const threshold = difficultyBigInt * chancesBigInt;
    const isWinner = randomnessHash < threshold;

    return {
      isWinner,
      randomnessHash: randomnessHash.toString(),
      threshold: threshold.toString(),
      rootHigh: rootHigh.toString(),
      rootLow: rootLow.toString(),
    };
  }

  /**
   * Generate a ZK proof for claiming a prize
   * Returns { proof, publicSignals, solidityProof }
   */
  async generateProof(passphrase, ownerAddress, beaconRoot, commitment, difficulty, numChances) {
    console.log('[CryptoService] generateProof called');

    console.log('[CryptoService] Ensuring Poseidon...');
    await this.ensurePoseidon();
    console.log('[CryptoService] Poseidon ready');

    console.log('[CryptoService] Loading circuit assets...');
    await this.loadCircuitAssets();
    console.log('[CryptoService] Circuit assets loaded');

    if (!this.wasmBuffer || !this.zkeyBuffer) {
      throw new Error('Circuit assets not loaded');
    }

    if (typeof window.snarkjs === 'undefined') {
      throw new Error('snarkjs not loaded - ensure CDN script is included');
    }
    console.log('[CryptoService] snarkjs available');

    const passphraseField = this.passphraseToField(passphrase);
    const ownerField = this.addressToField(ownerAddress);

    // Split beacon root into high/low 128-bit parts
    const rootBigInt = BigInt(beaconRoot);
    const rootHigh = rootBigInt >> 128n;
    const rootLow = rootBigInt & ((1n << 128n) - 1n);

    // Circuit inputs
    const input = {
      passphrase: passphraseField.toString(),
      ownerAddress: ownerField.toString(),
      rootHigh: rootHigh.toString(),
      rootLow: rootLow.toString(),
      ticketHash: commitment.toString(),
      difficulty: difficulty.toString(),
      chances: numChances.toString(),
    };

    console.log('[CryptoService] Generating ZK proof with inputs:', {
      rootHigh: input.rootHigh,
      rootLow: input.rootLow,
      ticketHash: input.ticketHash,
      difficulty: input.difficulty,
      chances: input.chances,
    });

    // Generate proof using snarkjs
    const { proof, publicSignals } = await window.snarkjs.groth16.fullProve(
      input,
      new Uint8Array(this.wasmBuffer),
      new Uint8Array(this.zkeyBuffer)
    );

    console.log('[CryptoService] Proof generated, public signals:', publicSignals);

    // Convert to Solidity format
    // Groth16 emits G2 points as [[bx0, bx1], ...], but Solidity verifier expects them flipped
    const solidityPiA = proof.pi_a.slice(0, 2).map((x) => x.toString());
    const solidityPiB = [
      [proof.pi_b[0][1].toString(), proof.pi_b[0][0].toString()],
      [proof.pi_b[1][1].toString(), proof.pi_b[1][0].toString()],
    ];
    const solidityPiC = proof.pi_c.slice(0, 2).map((x) => x.toString());

    return {
      proof,
      publicSignals,
      solidityProof: {
        pA: solidityPiA,
        pB: solidityPiB,
        pC: solidityPiC,
      },
    };
  }
}

// Singleton instance
const cryptoService = new CryptoService();
export default cryptoService;
