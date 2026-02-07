#!/usr/bin/env node
/**
 * PROOF-OF-CONCEPT: Field Overflow in lottery.circom
 *
 * Demonstrates that `difficulty * chances` wraps around mod p in the circuit,
 * causing the probability model to break at the boundary.
 */

const p = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const FIXED_TICKET_PRICE = 1000000000n; // 1 gwei

function analyzeTrial(appraisalEth) {
  const appraisal = BigInt(Math.round(appraisalEth * 1e18));
  const difficulty = (p / appraisal) * FIXED_TICKET_PRICE;

  const overflowAt = p / difficulty + 1n;
  const overflowCostWei = overflowAt * FIXED_TICKET_PRICE;
  const overflowCostEth = Number(overflowCostWei) / 1e18;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`TRIAL: Appraisal = ${appraisalEth} ETH`);
  console.log(`${'='.repeat(70)}`);
  console.log(`  difficulty           = ${difficulty}`);
  console.log(`  overflow at          = ${overflowAt} chances`);
  console.log(`  overflow cost        = ${overflowCostEth.toFixed(6)} ETH`);
  console.log(`  appraisal/overflow   = ${(appraisalEth / overflowCostEth).toFixed(4)} (should be ~1.0)`);
  console.log();

  // Show the sawtooth probability curve
  console.log('  numChances         | Cost (ETH)     | Expected P(win) | Actual P(win) | Status');
  console.log('  ' + '-'.repeat(85));

  const testPoints = [
    overflowAt / 10n,           // 10% of overflow
    overflowAt / 2n,            // 50% of overflow
    overflowAt * 9n / 10n,      // 90% of overflow
    overflowAt - 1n,            // Just before overflow
    overflowAt,                 // AT overflow
    overflowAt + 1n,            // Just after overflow
    overflowAt * 3n / 2n,       // 150% of overflow
    overflowAt * 2n,            // 200% of overflow
  ];

  for (const nc of testPoints) {
    const rawProduct = difficulty * nc;
    const circuitThreshold = rawProduct % p;

    const expectedProb = Number((rawProduct * 10000n) / p) / 10000;
    const actualProb = Number((circuitThreshold * 10000n) / p) / 10000;
    const costEth = Number(nc * FIXED_TICKET_PRICE) / 1e18;

    let status;
    if (Math.abs(expectedProb - actualProb) < 0.001) {
      status = 'OK';
    } else if (actualProb < 0.01 && expectedProb > 0.5) {
      status = 'CATASTROPHIC';
    } else {
      status = 'WRONG';
    }

    console.log(
      `  ${nc.toString().padStart(18)} | ${costEth.toFixed(6).padStart(14)} | ` +
      `${(expectedProb * 100).toFixed(2).padStart(14)}% | ` +
      `${(actualProb * 100).toFixed(2).padStart(12)}% | ${status}`
    );
  }
}

console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║  COLASSEUM RED TEAM: Field Overflow Proof-of-Concept               ║');
console.log('║                                                                    ║');
console.log('║  lottery.circom line 54:                                            ║');
console.log('║    effectiveDifficulty <== difficulty * chances;  // mod p !!!      ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');

// Test across several realistic appraisal values
analyzeTrial(0.01);   // Low-value NFT
analyzeTrial(0.1);    // Mid-range
analyzeTrial(0.39);   // The actual real trial
analyzeTrial(1.0);    // 1 ETH
analyzeTrial(10.0);   // High-value

console.log('\n' + '='.repeat(70));
console.log('CONCLUSION: For ALL appraisal values, spending approximately equal to');
console.log('the appraisal causes the threshold to wrap mod p, dropping win');
console.log('probability from ~100% to ~0%. The sawtooth repeats at multiples.');
console.log('The contract has NO guard against this overflow.');
console.log('='.repeat(70));
