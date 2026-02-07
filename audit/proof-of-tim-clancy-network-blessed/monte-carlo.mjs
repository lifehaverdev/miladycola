#!/usr/bin/env node
/**
 * MONTE CARLO SIMULATION: Actual vs Claimed Win Rates
 *
 * Simulates the circuit's win condition using random Poseidon-like hashes
 * to prove the statistical deviation from claimed probability.
 *
 * Since we can't run Poseidon in pure Node without dependencies, we simulate
 * with uniformly random field elements (which is what Poseidon outputs approximate).
 */

import { randomBytes } from 'crypto';

const p = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const FIXED_TICKET_PRICE = 1000000000n;

function randomFieldElement() {
  // Generate a uniform random element in [0, p-1]
  // Use rejection sampling from 256-bit randoms
  while (true) {
    const bytes = randomBytes(32);
    const val = BigInt('0x' + bytes.toString('hex'));
    if (val < p) return val;
  }
}

function simulateWinRate(difficulty, numChances, trials) {
  // What the circuit actually computes (field arithmetic)
  const circuitThreshold = (difficulty * numChances) % p;
  // What the math SHOULD compute (unlimited precision)
  const correctThreshold = difficulty * numChances;

  let circuitWins = 0;
  let correctWins = 0;

  for (let i = 0; i < trials; i++) {
    const randomHash = randomFieldElement();

    // Circuit evaluation (field arithmetic)
    if (randomHash < circuitThreshold) circuitWins++;

    // Correct evaluation (unlimited precision)
    if (randomHash < correctThreshold && correctThreshold <= p) correctWins++;
    else if (correctThreshold > p) correctWins++; // Guaranteed win
  }

  return {
    circuitRate: circuitWins / trials,
    correctRate: correctWins / trials,
    claimedProb: Number(correctThreshold * 10000n / p) / 10000,
    actualProb: Number(circuitThreshold * 10000n / p) / 10000,
  };
}

console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║  MONTE CARLO: Actual vs Claimed Win Rates                          ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');

const appraisal = 390000000000000000n; // 0.39 ETH
const difficulty = (p / appraisal) * FIXED_TICKET_PRICE;
const TRIALS = 100_000;

console.log(`\nAppraisal: 0.39 ETH`);
console.log(`Difficulty: ${difficulty}`);
console.log(`Simulations per test: ${TRIALS.toLocaleString()}\n`);

const testCases = [
  { label: 'Normal (1% odds)',        numChances: 3_900_001n },
  { label: 'Heavy (50% odds)',        numChances: 195_000_000n },
  { label: 'Near-max (99% odds)',     numChances: 386_100_000n },
  { label: 'AT overflow boundary',    numChances: p / difficulty + 1n },
  { label: 'Past overflow (150%)',    numChances: 585_000_000n },
  { label: 'Double overflow (200%)',  numChances: 780_000_000n },
];

console.log('Scenario               | Claimed P(win) | Circuit P(win) | Monte Carlo  | Deviation');
console.log('-'.repeat(95));

for (const { label, numChances } of testCases) {
  const result = simulateWinRate(difficulty, numChances, TRIALS);
  const deviation = Math.abs(result.circuitRate - result.claimedProb);
  const deviationPct = (deviation * 100).toFixed(2);

  let flag = '';
  if (deviation > 0.1) flag = ' *** BROKEN ***';
  else if (deviation > 0.01) flag = ' * DRIFT *';

  console.log(
    `${label.padEnd(23)}| ` +
    `${(result.claimedProb * 100).toFixed(2).padStart(13)}% | ` +
    `${(result.actualProb * 100).toFixed(2).padStart(13)}% | ` +
    `${(result.circuitRate * 100).toFixed(2).padStart(11)}% | ` +
    `${deviationPct}%${flag}`
  );
}

console.log('\n' + '='.repeat(70));
console.log('Monte Carlo confirms: normal usage is correct, overflow usage is broken.');
console.log('The circuit threshold wraps mod p, destroying probability guarantees.');
console.log('='.repeat(70));
