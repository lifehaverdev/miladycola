#!/usr/bin/env node
/**
 * Verify a winning transaction is legitimate
 * Tests that the verifier correctly validates the proof
 */

import { ethers } from 'ethers';

// Transaction data from the win
const txData = {
  chanceId: 1n,
  beaconTimestamp: BigInt('0x698697bf'), // 1769932735
  pA: [
    '0x248dc990529cbc457c369aa05a376c1dcb7860c0be5270ffa6d0e130142348e6',
    '0x2ce27bc90f38a873e4cdf5b22bc3c616e77a0c75b0868a356940195d8e68c910'
  ],
  pB: [
    [
      '0x1dd45382537126916658c9cfde11f7adaeef32529c1349a8dc3ef39f1044540d',
      '0x293997aa8aa1a8560b5d8e31c3031f2255337a4b6c603eb3435b7492c9f12e39'
    ],
    [
      '0x1800cc93d937022f1fcd337248a45f147830f30ca3fcb7ac5c25c5da81265c56',
      '0x29d80d34b15c153d25599a5f6b6dc318e1fd0ff1d66b7bba57cab379f687c889'
    ]
  ],
  pC: [
    '0x0284d157514753fbada59e7fac8be709d57e4467204972ae0f9fb9e2249f37d2',
    '0x0b8fc4c66b0611042a964da2878a2f4f176f951a1c8995dbfc72443d56ab9c51'
  ]
};

const VERIFIER_ADDRESS = '0x6451e5027EC265c117FbDA85579B337F459D3837';
const COLASSEUM_ADDRESS = '0xEBB82461b745d4be95C95beCa7095f0EC6c530AC';

const VERIFIER_ABI = [
  'function verifyProof(uint256[2] calldata _pA, uint256[2][2] calldata _pB, uint256[2] calldata _pC, uint256[5] calldata _pubSignals) external view returns (bool)'
];

const COLASSEUM_ABI = [
  'function chances(uint256) external view returns (uint256 trialId, address participant, uint256 commitment, uint256 targetTimestamp, uint256 numChances, uint8 status)',
  'function trials(uint256) external view returns (address challenger, address nftContract, uint256 nftId, uint256 appraisal, uint256 deposit, uint256 difficulty, uint256 pot, uint256 createdAt, uint16 charityBps, uint8 status)'
];

async function main() {
  console.log('='.repeat(80));
  console.log('VERIFYING WINNING TRANSACTION');
  console.log('='.repeat(80));

  const provider = new ethers.providers.JsonRpcProvider('https://eth.llamarpc.com');
  const verifier = new ethers.Contract(VERIFIER_ADDRESS, VERIFIER_ABI, provider);
  const colasseum = new ethers.Contract(COLASSEUM_ADDRESS, COLASSEUM_ABI, provider);

  // Get chance data
  console.log('\n📋 Fetching chance data...');
  const chance = await colasseum.chances(txData.chanceId);
  console.log('Chance ID:', txData.chanceId.toString());
  console.log('Trial ID:', chance.trialId.toString());
  console.log('Participant:', chance.participant);
  console.log('Commitment:', chance.commitment.toString());
  console.log('Target Timestamp:', chance.targetTimestamp.toString());
  console.log('Num Chances:', chance.numChances.toString());

  // Get trial data
  console.log('\n🏛️  Fetching trial data...');
  const trial = await colasseum.trials(chance.trialId);
  console.log('Difficulty:', trial.difficulty.toString());
  console.log('Appraisal:', ethers.utils.formatEther(trial.appraisal), 'ETH');

  // Calculate public signals (what the verifier checks)
  console.log('\n🔐 Reconstructing public signals...');

  // Get beacon root at timestamp
  const BEACON_ROOTS = '0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02';
  const beaconRootsContract = new ethers.Contract(
    BEACON_ROOTS,
    ['function get(uint256 timestamp) external view returns (bytes32)'],
    provider
  );

  let beaconRoot;
  try {
    beaconRoot = await beaconRootsContract.get(txData.beaconTimestamp);
    console.log('Beacon Root:', beaconRoot);
  } catch (e) {
    console.log('⚠️  Could not fetch beacon root (may be expired), using placeholder');
    beaconRoot = ethers.constants.HashZero;
  }

  // Split beacon root into high/low
  const rootBigInt = BigInt(beaconRoot);
  const rootHigh = rootBigInt >> 128n;
  const rootLow = rootBigInt & ((1n << 128n) - 1n);

  const publicSignals = [
    rootHigh.toString(),
    rootLow.toString(),
    chance.commitment.toString(),
    trial.difficulty.toString(),
    chance.numChances.toString()
  ];

  console.log('\nPublic Signals:');
  console.log('  rootHigh:', publicSignals[0]);
  console.log('  rootLow:', publicSignals[1]);
  console.log('  commitment:', publicSignals[2]);
  console.log('  difficulty:', publicSignals[3]);
  console.log('  numChances:', publicSignals[4]);

  // Verify the proof
  console.log('\n✅ Calling verifier.verifyProof()...');
  try {
    const isValid = await verifier.verifyProof(
      txData.pA,
      txData.pB,
      txData.pC,
      publicSignals
    );

    if (isValid) {
      console.log('✅ PROOF IS VALID - Verifier correctly accepted this proof');
    } else {
      console.log('❌ PROOF IS INVALID - This should not have been accepted!');
    }
  } catch (error) {
    console.log('❌ Verification failed:', error.message);
  }

  console.log('\n' + '='.repeat(80));
  console.log('NEXT: Test that invalid proofs are REJECTED');
  console.log('Run: npm test -- --match-test "test_victory_revertsInvalidProof"');
  console.log('='.repeat(80));
}

main().catch(console.error);
