#!/usr/bin/env node
/**
 * EDGE CASE ANALYSIS: Boundary conditions and secondary bugs
 */

const p = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const FIXED_TICKET_PRICE = 1000000000n;

console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║  EDGE CASE ANALYSIS                                                ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');

// =========================================================================
// TEST 1: passphraseToField overflow (keccak256 > p)
// =========================================================================
console.log('\n=== TEST 1: passphraseToField mod-p reduction ===\n');

// keccak256 range: [0, 2^256 - 1]
// p ≈ 2^253.6
// Fraction of keccak256 outputs >= p:
const maxKeccak = (1n << 256n) - 1n;
const fractionAboveP = Number((maxKeccak - p) * 10000n / maxKeccak) / 100;
console.log(`keccak256 max: 2^256 - 1`);
console.log(`BN254 field p: ${p}`);
console.log(`Fraction of keccak256 outputs >= p: ${fractionAboveP.toFixed(2)}%`);
console.log(`These get silently reduced mod p by snarkjs.`);
console.log();

// Show collision example
const exampleHash = p + 42n;
const reduced = exampleHash % p;
console.log(`Example: keccak256 output = p + 42 = ${exampleHash}`);
console.log(`         snarkjs reduces to: ${reduced}`);
console.log(`         Same field element as keccak256 output = 42`);
console.log(`         Two different passphrases → same circuit input!`);

// =========================================================================
// TEST 2: Difficulty calculation precision loss
// =========================================================================
console.log('\n=== TEST 2: Solidity integer division truncation ===\n');

const testAppraisals = [
  { label: '0.001 ETH', wei: 1000000000000000n },
  { label: '0.01 ETH',  wei: 10000000000000000n },
  { label: '0.1 ETH',   wei: 100000000000000000n },
  { label: '1 ETH',     wei: 1000000000000000000n },
  { label: '10 ETH',    wei: 10000000000000000000n },
];

console.log('Appraisal     | difficulty                    | P(1 chance)        | Truncation error');
console.log('-'.repeat(95));

for (const { label, wei } of testAppraisals) {
  const difficulty = (p / wei) * FIXED_TICKET_PRICE;
  const exactDifficulty = p * FIXED_TICKET_PRICE / wei; // Higher precision order
  const probPerChance = Number(difficulty * 10000000000n / p) / 10000000000;
  const expectedProb = Number(FIXED_TICKET_PRICE) / Number(wei);
  const truncError = Math.abs(probPerChance - expectedProb) / expectedProb * 100;

  console.log(
    `${label.padEnd(14)}| ${difficulty.toString().padEnd(30)}| ` +
    `${probPerChance.toExponential(6).padEnd(19)}| ${truncError.toFixed(10)}%`
  );
}
console.log('\nTruncation error is negligible for practical appraisal values.');

// =========================================================================
// TEST 3: Exact overflow boundary values
// =========================================================================
console.log('\n=== TEST 3: Exact overflow boundaries per appraisal ===\n');

console.log('Appraisal    | Max safe chances | Max safe cost     | Overflow threshold');
console.log('-'.repeat(80));

for (const { label, wei } of testAppraisals) {
  const difficulty = (p / wei) * FIXED_TICKET_PRICE;
  const maxSafeChances = p / difficulty; // Floor division
  const maxSafeCost = maxSafeChances * FIXED_TICKET_PRICE;
  const maxSafeProbPct = Number(difficulty * maxSafeChances * 10000n / p) / 100;

  console.log(
    `${label.padEnd(13)}| ${maxSafeChances.toString().padEnd(17)}| ` +
    `${(Number(maxSafeCost) / 1e18).toFixed(6).padEnd(18)}ETH | ` +
    `${maxSafeProbPct.toFixed(2)}%`
  );
}

// =========================================================================
// TEST 4: The sawtooth - probability at 1.5x overflow
// =========================================================================
console.log('\n=== TEST 4: Sawtooth probability at 1.5x appraisal cost ===\n');

console.log('Spending 1.5x the appraisal should mean >100% expected win rate.');
console.log('Due to field overflow, actual probability is ~50%:\n');

for (const { label, wei } of testAppraisals) {
  const difficulty = (p / wei) * FIXED_TICKET_PRICE;
  const chancesAt150 = wei * 3n / (2n * FIXED_TICKET_PRICE);
  const rawThreshold = difficulty * chancesAt150;
  const circuitThreshold = rawThreshold % p;
  const actualProb = Number(circuitThreshold * 10000n / p) / 100;
  const costEth = Number(chancesAt150 * FIXED_TICKET_PRICE) / 1e18;

  console.log(
    `${label.padEnd(13)} cost=${costEth.toFixed(4)} ETH → ` +
    `expected=150% actual=${actualProb.toFixed(2)}% ${actualProb < 60 ? '*** BROKEN ***' : ''}`
  );
}

// =========================================================================
// TEST 5: The real winner - was it in the safe zone?
// =========================================================================
console.log('\n=== TEST 5: Real winner analysis ===\n');

const realDifficulty = 56123699671382756980118989090403269457816318975425729086405000000000n;
const realChances = 3900001n;
const realProduct = realDifficulty * realChances;
const realThresholdModP = realProduct % p;

console.log(`Real difficulty: ${realDifficulty}`);
console.log(`Real numChances: ${realChances}`);
console.log(`Product: ${realProduct}`);
console.log(`Product mod p: ${realThresholdModP}`);
console.log(`Product == Product mod p: ${realProduct === realThresholdModP}`);
console.log(`Product < p: ${realProduct < p}`);
console.log(`Ratio product/p: ${Number(realProduct * 10000n / p) / 10000}`);
console.log(`\nThe real winner was at ${(Number(realProduct * 10000n / p) / 100).toFixed(2)}% of the field.`);
console.log(`This is WELL within the safe zone. Normal usage odds are correct.`);

console.log('\n' + '='.repeat(70));
console.log('SUMMARY: The overflow boundary is at spending ≈ appraisal value.');
console.log('Normal play (spending << appraisal) has correct odds.');
console.log('Heavy play (spending ≈ appraisal) has CATASTROPHICALLY wrong odds.');
console.log('The contract needs a guard: require(difficulty * numChances < p)');
console.log('='.repeat(70));
